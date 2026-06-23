import { Hono } from 'hono';
import { Pool } from 'pg';

const databaseUrl = process.env.READER_DATABASE_URL || process.env.DATABASE_URL;

const pool = databaseUrl
    ? new Pool({
          connectionString: databaseUrl,
      })
    : null;

const app = new Hono();

let schemaReady: Promise<void> | undefined;

function getPool() {
    if (!pool) {
        throw new Error('READER_DATABASE_URL or DATABASE_URL is required for the reader Postgres store.');
    }
    return pool;
}

async function ensureSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await getPool().query(`
            CREATE TABLE IF NOT EXISTS reader_items (
                id TEXT PRIMARY KEY,
                feed_id TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                link TEXT NOT NULL,
                author TEXT,
                pub_date TEXT,
                pub_date_ms BIGINT NOT NULL DEFAULT 0,
                description TEXT,
                summary TEXT,
                categories JSONB NOT NULL DEFAULT '[]'::jsonb,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                is_starred BOOLEAN NOT NULL DEFAULT FALSE,
                search_text TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS reader_discord_author_roles (
                guild_id TEXT NOT NULL,
                author TEXT NOT NULL,
                role TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (guild_id, author)
            );

            CREATE INDEX IF NOT EXISTS reader_items_pub_date_ms_idx ON reader_items (pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_feed_pub_date_idx ON reader_items (feed_id, pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_category_pub_date_idx ON reader_items (category, pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_unread_category_idx ON reader_items (is_read, category);
            CREATE INDEX IF NOT EXISTS reader_items_search_idx ON reader_items USING gin (to_tsvector('simple', search_text));

            UPDATE reader_items
            SET category = 'chat', updated_at = NOW()
            WHERE category = 'images';
        `);
        })();
    }
    await schemaReady;
}

function normalizeLimit(value: string | undefined) {
    const limit = Number(value);
    if (!Number.isFinite(limit)) {
        return 50;
    }
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeOffset(value: string | undefined) {
    const offset = Number(value);
    if (!Number.isFinite(offset)) {
        return 0;
    }
    return Math.max(Math.trunc(offset), 0);
}

function normalizeSummaryDays(value: unknown) {
    return Number(value) === 7 ? 7 : 1;
}

function normalizeSummaryFeedIds(value: unknown) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map((feedId) => String(feedId || '').trim()).filter(Boolean))].slice(0, 100);
}

function normalizeDiscordRole(value: unknown) {
    const role = String(value || '').trim();
    return ['admin', 'bot', 'user'].includes(role) ? role : 'user';
}

function normalizeDiscordAuthors(value: unknown) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map((author) => String(author || '').trim()).filter(Boolean))].slice(0, 200);
}

function rowToItem(row) {
    return {
        id: row.id,
        feedId: row.feed_id,
        category: row.category,
        title: row.title,
        link: row.link,
        author: row.author || '',
        pubDate: row.pub_date || '',
        pubDateMs: Number(row.pub_date_ms) || 0,
        description: row.description || '',
        summary: row.summary || '',
        categories: row.categories || [],
        isRead: row.is_read,
        isStarred: row.is_starred,
        searchText: row.search_text || '',
    };
}

function itemToValues(item) {
    const categories = Array.isArray(item.categories) ? item.categories : [];
    return [
        item.id,
        item.feedId,
        item.category,
        item.title || item.link || 'Untitled',
        item.link || item.id,
        item.author || '',
        item.pubDate || '',
        Number(item.pubDateMs) || 0,
        item.description || '',
        item.summary || '',
        JSON.stringify(categories),
        Boolean(item.isRead),
        Boolean(item.isStarred),
        item.searchText || [item.title, item.summary, item.author, ...categories].join(' ').toLowerCase(),
    ];
}

function stripHtml(value: string) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function limitText(value: string, maxLength: number) {
    return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
}

function buildSummaryPrompt(items, days: number) {
    const lines = items.slice(0, 80).map((item, index) => {
        const content = limitText(stripHtml(item.summary || item.description || ''), 420);
        return [`${index + 1}. ${item.title}`, item.author ? `Author: ${item.author}` : '', item.pubDate ? `Date: ${item.pubDate}` : '', item.link ? `Link: ${item.link}` : '', content ? `Content: ${content}` : '']
            .filter(Boolean)
            .join('\n');
    });

    return [
        `请用中文总结这个 RSS 订阅源最近 ${days} 天的内容。`,
        '要求：',
        '1. 先给出 3-6 条核心要点。',
        '2. 再列出主要趋势或重复出现的主题。',
        '3. 最后列出最值得打开阅读的 3-5 篇，并说明理由。',
        '',
        `共收集到 ${items.length} 条，以下最多展示 80 条：`,
        lines.join('\n\n'),
    ].join('\n');
}

async function getSummaryItems(feedIds: string[], days: number) {
    if (!feedIds.length) {
        return [];
    }

    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = await getPool().query(
        `
            SELECT *
            FROM reader_items
            WHERE feed_id = ANY($1::text[])
                AND pub_date_ms >= $2
            ORDER BY pub_date_ms DESC, id DESC
            LIMIT 200
        `,
        [feedIds, sinceMs]
    );
    return result.rows.map((row) => rowToItem(row));
}

async function buildAiSummaryResponse(feedIds: string[], days: number) {
    const items = await getSummaryItems(feedIds, days);
    const prompt = buildSummaryPrompt(items, days);
    const aiResult = items.length
        ? await requestAiSummary(prompt)
        : {
              configured: Boolean((process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.READER_AI_MODEL),
              message: '',
              summary: '',
          };

    return {
        ...aiResult,
        days,
        itemCount: items.length,
        prompt,
    };
}

function getAiRequestUrl() {
    const configuredUrl = process.env.READER_AI_REQUEST_URL?.trim();
    const baseUrl = (process.env.READER_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const requestUrl = configuredUrl || `${baseUrl}/chat/completions`;

    if (/\/v1\/?$/.test(requestUrl)) {
        return requestUrl.replace(/\/$/, '') + '/chat/completions';
    }

    return requestUrl;
}

async function requestAiSummary(prompt: string) {
    const apiKey = process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.READER_AI_MODEL;
    const requestUrl = getAiRequestUrl();

    if (!apiKey || !model) {
        return {
            configured: false,
            message: 'AI summary is not configured. Set READER_AI_REQUEST_URL, READER_AI_API_KEY, and READER_AI_MODEL to enable automatic summaries.',
            summary: '',
        };
    }

    const response = await fetch(requestUrl, {
        body: JSON.stringify({
            messages: [
                {
                    content: 'You summarize RSS reader content clearly and concisely in Chinese.',
                    role: 'system',
                },
                {
                    content: prompt,
                    role: 'user',
                },
            ],
            model,
            temperature: 0.2,
        }),
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
        },
        method: 'POST',
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || 'AI summary request failed.');
    }

    return {
        configured: true,
        message: '',
        summary: data?.choices?.[0]?.message?.content || '',
    };
}

function getItemFilters(ctx, options: { unreadOnly?: boolean } = {}) {
    const category = ctx.req.query('category');
    const feedId = ctx.req.query('feedId');
    const read = ctx.req.query('read');
    const search = ctx.req.query('search')?.trim();
    const where: string[] = [];
    const values: Array<number | string> = [];

    if (category && category !== 'all') {
        values.push(category);
        where.push(`category = $${values.length}`);
    }
    if (feedId && feedId !== 'all') {
        values.push(feedId);
        where.push(`feed_id = $${values.length}`);
    }
    if (options.unreadOnly && read === 'read') {
        where.push('FALSE');
    } else if (options.unreadOnly || read === 'unread') {
        where.push('is_read = FALSE');
    }
    if (!options.unreadOnly && read === 'read') {
        where.push('is_read = TRUE');
    }
    if (search) {
        values.push(`%${search.toLowerCase()}%`);
        where.push(`search_text ILIKE $${values.length}`);
    }

    return { values, where };
}

app.use('*', async (ctx, next) => {
    try {
        await ensureSchema();
        await next();
    } catch (error) {
        return ctx.json({ error: error instanceof Error ? error.message : 'Reader database error.' }, 503);
    }
});

app.get('/items', async (ctx) => {
    const limit = normalizeLimit(ctx.req.query('limit'));
    const offset = normalizeOffset(ctx.req.query('offset'));
    const { values, where } = getItemFilters(ctx);

    values.push(limit + 1);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;

    const result = await getPool().query(
        `
            SELECT *
            FROM reader_items
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY pub_date_ms DESC, id DESC
            LIMIT ${limitPlaceholder}
            OFFSET ${offsetPlaceholder}
        `,
        values
    );
    const rows = result.rows.slice(0, limit);
    return ctx.json({
        hasMore: result.rows.length > limit,
        items: rows.map((row) => rowToItem(row)),
    });
});

app.get('/items/counts', async (ctx) => {
    const feedId = ctx.req.query('feedId');
    const search = ctx.req.query('search')?.trim();
    const where = ['is_read = FALSE'];
    const values: string[] = [];

    if (feedId && feedId !== 'all') {
        values.push(feedId);
        where.push(`feed_id = $${values.length}`);
    }
    if (search) {
        values.push(`%${search.toLowerCase()}%`);
        where.push(`search_text ILIKE $${values.length}`);
    }

    const result = await getPool().query(
        `
            SELECT category, COUNT(*)::int AS count
            FROM reader_items
            WHERE ${where.join(' AND ')}
            GROUP BY category
        `,
        values
    );
    const counts = {
        all: 0,
        articles: 0,
        chat: 0,
        notifications: 0,
        social: 0,
        videos: 0,
    };
    for (const row of result.rows) {
        if (Object.hasOwn(counts, row.category)) {
            counts[row.category] = row.count;
        }
        counts.all += row.count;
    }
    return ctx.json(counts);
});

app.get('/feeds/unread-counts', async (ctx) => {
    const result = await getPool().query(
        `
            SELECT feed_id, COUNT(*)::int AS count
            FROM reader_items
            WHERE is_read = FALSE
            GROUP BY feed_id
        `
    );
    return ctx.json({
        counts: Object.fromEntries(result.rows.map((row) => [row.feed_id, row.count])),
    });
});

app.patch('/items/read-all', async (ctx) => {
    const { values, where } = getItemFilters(ctx, { unreadOnly: true });
    const result = await getPool().query(
        `
            UPDATE reader_items
            SET
                is_read = TRUE,
                updated_at = NOW()
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        `,
        values
    );
    return ctx.json({ count: result.rowCount || 0 });
});

app.get('/items/:id', async (ctx) => {
    const result = await getPool().query('SELECT * FROM reader_items WHERE id = $1', [ctx.req.param('id')]);
    if (!result.rows[0]) {
        return ctx.json(null);
    }
    return ctx.json(rowToItem(result.rows[0]));
});

app.post('/items/bulk', async (ctx) => {
    const body = await ctx.req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
        return ctx.json({ count: 0 });
    }

    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await Promise.all(
            items.map((item) =>
                client.query(
                    `
                    INSERT INTO reader_items (
                        id, feed_id, category, title, link, author, pub_date, pub_date_ms,
                        description, summary, categories, is_read, is_starred, search_text
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11::jsonb, $12, $13, $14
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        feed_id = EXCLUDED.feed_id,
                        category = EXCLUDED.category,
                        title = EXCLUDED.title,
                        link = EXCLUDED.link,
                        author = EXCLUDED.author,
                        pub_date = EXCLUDED.pub_date,
                        pub_date_ms = EXCLUDED.pub_date_ms,
                        description = EXCLUDED.description,
                        summary = EXCLUDED.summary,
                        categories = EXCLUDED.categories,
                        is_read = reader_items.is_read OR EXCLUDED.is_read,
                        is_starred = reader_items.is_starred OR EXCLUDED.is_starred,
                        search_text = EXCLUDED.search_text,
                        updated_at = NOW()
                `,
                    itemToValues(item)
                )
            )
        );
        await client.query('COMMIT');
        return ctx.json({ count: items.length });
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
});

app.patch('/items/:id', async (ctx) => {
    const body = await ctx.req.json();
    const result = await getPool().query(
        `
            UPDATE reader_items
            SET
                is_read = COALESCE($2, is_read),
                is_starred = COALESCE($3, is_starred),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [ctx.req.param('id'), typeof body.isRead === 'boolean' ? body.isRead : null, typeof body.isStarred === 'boolean' ? body.isStarred : null]
    );
    return ctx.json(result.rows[0] ? rowToItem(result.rows[0]) : null);
});

app.post('/feeds/:feedId/ai-summary', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const result = await buildAiSummaryResponse([ctx.req.param('feedId')], days);

    return ctx.json(result);
});

app.post('/feeds/ai-summary', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    const result = await buildAiSummaryResponse(feedIds, days);

    return ctx.json(result);
});

app.post('/discord-author-roles/lookup', async (ctx) => {
    const body = await ctx.req.json();
    const guildId = String(body.guildId || '').trim();
    const authors = normalizeDiscordAuthors(body.authors);
    if (!guildId || !authors.length) {
        return ctx.json({ roles: {} });
    }

    const result = await getPool().query(
        `
            SELECT author, role
            FROM reader_discord_author_roles
            WHERE guild_id = $1
                AND author = ANY($2::text[])
        `,
        [guildId, authors]
    );
    return ctx.json({
        roles: Object.fromEntries(result.rows.map((row) => [row.author, normalizeDiscordRole(row.role)])),
    });
});

app.put('/discord-author-roles', async (ctx) => {
    const body = await ctx.req.json();
    const guildId = String(body.guildId || '').trim();
    const author = String(body.author || '').trim();
    const role = normalizeDiscordRole(body.role);
    if (!guildId || !author) {
        return ctx.json({ error: 'guildId and author are required.' }, 400);
    }

    const result = await getPool().query(
        `
            INSERT INTO reader_discord_author_roles (guild_id, author, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, author) DO UPDATE SET
                role = EXCLUDED.role,
                updated_at = NOW()
            RETURNING author, role
        `,
        [guildId, author, role]
    );
    return ctx.json(result.rows[0]);
});

app.patch('/feeds/:feedId/category', async (ctx) => {
    const body = await ctx.req.json();
    const category = body.category;
    await getPool().query('UPDATE reader_items SET category = $2, updated_at = NOW() WHERE feed_id = $1', [ctx.req.param('feedId'), category]);
    return ctx.json({ ok: true });
});

app.delete('/feeds/:feedId/items', async (ctx) => {
    await getPool().query('DELETE FROM reader_items WHERE feed_id = $1', [ctx.req.param('feedId')]);
    return ctx.json({ ok: true });
});

export default app;
