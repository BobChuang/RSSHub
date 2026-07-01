import { Hono } from 'hono';
import MarkdownIt from 'markdown-it';

import { refreshFeed } from './reader/scheduler';
import {
    createFeedId,
    deleteFeed,
    deleteFeedItems,
    ensureSchema,
    getFeedsAiSummaryPrompt,
    getPool,
    listFeeds,
    rowToItem,
    updateFeed,
    updateFeedItemsCategory,
    updateFeedsAiSummaryPrompt,
    upsertFeed,
    upsertItems,
} from './reader/store';

const app = new Hono();
const markdown = MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
});
const defaultAiSummaryPrompt = [
    '请用中文总结这个 RSS 订阅源最近 {{days}} 天的内容。',
    '要求：',
    '1. 先给出 3-6 条核心要点。',
    '2. 再列出主要趋势或重复出现的主题。',
    '3. 最后列出最值得打开阅读的 3-5 篇，并说明理由。',
    '',
    '不总结：',
    '1. 安全提醒与垃圾/诈骗信息信息',
].join('\n');
const defaultMultiAiSummaryPrompt = [
    '请用中文按频道汇总这些 RSS 订阅源最近 {{days}} 天的内容。',
    '要求：',
    '1. 先给出跨频道的 5-8 条核心要点，合并重复信息。',
    '2. 按频道列出各自最重要的进展、讨论或异常信号。',
    '3. 标出跨频道反复出现的趋势、共识、分歧或待跟进事项。',
    '4. 最后列出最值得打开阅读的 3-5 条内容，并说明来自哪个频道和理由。',
    '',
    '不总结：',
    '1. 安全提醒与垃圾/诈骗信息信息',
].join('\n');

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

function normalizeSummaryPrompt(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
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

function stripHtml(value: string) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function limitText(value: string, maxLength: number) {
    return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
}

function buildSummaryItemsText(items) {
    return items
        .slice(0, 80)
        .map((item, index) => {
            const content = limitText(stripHtml(item.summary || item.description || ''), 420);
            const source = [item.feedGroup, item.feedTitle].filter(Boolean).join(' / ');
            return [
                `${index + 1}. ${item.title}`,
                source ? `Source: ${source}` : '',
                item.author ? `Author: ${item.author}` : '',
                item.pubDate ? `Date: ${item.pubDate}` : '',
                item.link ? `Link: ${item.link}` : '',
                content ? `Content: ${content}` : '',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n\n');
}

function replacePromptToken(value: string, token: string, replacement: string) {
    return value.split(token).join(replacement);
}

function renderSummaryPrompt(promptTemplate: string, items, days: number) {
    const itemsText = buildSummaryItemsText(items);
    const hasItemsPlaceholder = promptTemplate.includes('{{items}}');
    const promptWithDays = replacePromptToken(promptTemplate, '{{days}}', String(days));
    const promptWithItemCount = replacePromptToken(promptWithDays, '{{itemCount}}', String(items.length));
    const prompt = replacePromptToken(promptWithItemCount, '{{items}}', itemsText);

    if (hasItemsPlaceholder) {
        return prompt;
    }

    return [prompt, '', `共收集到 ${items.length} 条，以下最多展示 80 条：`, itemsText].join('\n');
}

function renderSummaryMarkdown(value: string) {
    return value ? markdown.render(value) : '';
}

async function getSummaryItems(feedIds: string[], days: number) {
    if (!feedIds.length) {
        return [];
    }

    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = await getPool().query(
        `
            SELECT item.*, feed.title AS feed_title, feed.group_name AS feed_group
            FROM reader_items item
            LEFT JOIN reader_feeds feed ON feed.id = item.feed_id
            WHERE item.feed_id = ANY($1::text[])
                AND item.pub_date_ms >= $2
            ORDER BY item.pub_date_ms DESC, item.id DESC
            LIMIT 200
        `,
        [feedIds, sinceMs]
    );
    return result.rows.map((row) => ({
        ...rowToItem(row),
        feedGroup: row.feed_group || '',
        feedTitle: row.feed_title || '',
    }));
}

async function buildAiSummaryResponse(feedIds: string[], days: number, promptValue?: unknown, savePrompt?: boolean) {
    const submittedPrompt = normalizeSummaryPrompt(promptValue);
    const defaultPrompt = feedIds.length > 1 ? defaultMultiAiSummaryPrompt : defaultAiSummaryPrompt;
    const promptTemplate = submittedPrompt || (await getFeedsAiSummaryPrompt(feedIds)) || defaultPrompt;
    if (savePrompt && submittedPrompt) {
        await updateFeedsAiSummaryPrompt(feedIds, promptTemplate);
    }
    const items = await getSummaryItems(feedIds, days);
    const prompt = renderSummaryPrompt(promptTemplate, items, days);
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
        promptTemplate,
        summaryHtml: renderSummaryMarkdown(aiResult.summary),
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

function getRefreshSeconds(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) {
        return 300;
    }
    return Math.min(Math.max(Math.trunc(seconds), 30), 24 * 60 * 60);
}

function normalizeBodyFeedUrl(value: unknown, requestUrl: string) {
    const url = String(value || '').trim();
    if (!url) {
        return '';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return new URL(url).href;
    }
    return new URL(url.startsWith('/') ? url : `/${url}`, new URL(requestUrl).origin).href;
}

function feedBodyToInput(body, requestUrl?: string) {
    const url = requestUrl && body.url ? normalizeBodyFeedUrl(body.url, requestUrl) : body.url;
    const refreshSeconds = body.refreshSeconds ?? (body.refreshMinutes ? Number(body.refreshMinutes) * 60 : undefined);
    return {
        id: body.id || (url ? createFeedId(url) : undefined),
        url,
        title: body.title,
        homeUrl: body.homeUrl,
        category: body.category,
        group: body.group,
        aiSummaryPrompt: typeof body.aiSummaryPrompt === 'string' ? body.aiSummaryPrompt : undefined,
        refreshSeconds: refreshSeconds === undefined ? undefined : getRefreshSeconds(refreshSeconds),
        serverSyncEnabled: typeof body.serverSyncEnabled === 'boolean' ? body.serverSyncEnabled : undefined,
        paused: typeof body.paused === 'boolean' ? body.paused : undefined,
        lastFetchedAt: body.lastFetchedAt,
        nextFetchAt: body.nextFetchAt,
        lastError: body.lastError,
    };
}

function patchNextFetchAt(patch) {
    if (patch.refreshSeconds !== undefined && patch.nextFetchAt === undefined) {
        patch.nextFetchAt = new Date(Date.now() + patch.refreshSeconds * 1000).toISOString();
    }
    return patch;
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

app.get('/feeds', async (ctx) => ctx.json({ feeds: await listFeeds() }));

app.post('/feeds', async (ctx) => {
    const body = await ctx.req.json();
    if (!body.url) {
        return ctx.json({ error: 'url is required.' }, 400);
    }
    const feed = await upsertFeed({
        ...feedBodyToInput(body, ctx.req.url),
        serverSyncEnabled: typeof body.serverSyncEnabled === 'boolean' ? body.serverSyncEnabled : true,
    });
    return ctx.json(feed);
});

app.patch('/feeds/bulk', async (ctx) => {
    const body = await ctx.req.json();
    const feedIds = Array.isArray(body.feedIds) ? body.feedIds.map((feedId) => String(feedId || '').trim()).filter(Boolean) : [];
    if (!feedIds.length) {
        return ctx.json({ count: 0, feeds: [] });
    }
    const patch = patchNextFetchAt(feedBodyToInput(body, ctx.req.url));
    const feeds = (
        await Promise.all(
            feedIds.map((feedId) =>
                updateFeed(feedId, {
                    category: patch.category,
                    group: patch.group,
                    aiSummaryPrompt: patch.aiSummaryPrompt,
                    nextFetchAt: patch.nextFetchAt,
                    refreshSeconds: patch.refreshSeconds,
                    serverSyncEnabled: patch.serverSyncEnabled,
                    paused: patch.paused,
                })
            )
        )
    ).filter(Boolean);
    return ctx.json({ count: feeds.length, feeds });
});

app.patch('/feeds/:feedId', async (ctx) => {
    const body = await ctx.req.json();
    const feed = await updateFeed(ctx.req.param('feedId'), patchNextFetchAt(feedBodyToInput(body, ctx.req.url)));
    if (!feed) {
        return ctx.json({ error: 'Feed not found.' }, 404);
    }
    if (body.category) {
        await updateFeedItemsCategory(feed.id, feed.category);
    }
    return ctx.json(feed);
});

app.delete('/feeds/:feedId', async (ctx) => {
    const deleted = await deleteFeed(ctx.req.param('feedId'));
    return ctx.json({ ok: deleted });
});

app.post('/feeds/:feedId/refresh', async (ctx) => {
    try {
        return ctx.json(await refreshFeed(ctx.req.param('feedId')));
    } catch (error) {
        return ctx.json({ error: error instanceof Error ? error.message : 'Unable to refresh feed.' }, 500);
    }
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

    return ctx.json({ count: await upsertItems(items) });
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
    const result = await buildAiSummaryResponse([ctx.req.param('feedId')], days, body.prompt, body.savePrompt === true);

    return ctx.json(result);
});

app.post('/feeds/ai-summary', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    const result = await buildAiSummaryResponse(feedIds, days, body.prompt, body.savePrompt === true);

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
    await updateFeed(ctx.req.param('feedId'), { category });
    await updateFeedItemsCategory(ctx.req.param('feedId'), category);
    return ctx.json({ ok: true });
});

app.delete('/feeds/:feedId/items', async (ctx) => {
    await deleteFeedItems(ctx.req.param('feedId'));
    return ctx.json({ ok: true });
});

export default app;
