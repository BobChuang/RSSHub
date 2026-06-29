import { createHash } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import type { Data, DataItem } from '@/types';

export type ReaderItem = {
    id: string;
    feedId: string;
    category: string;
    title: string;
    link: string;
    author: string;
    pubDate: string;
    pubDateMs: number;
    description: string;
    summary: string;
    categories: string[];
    isRead: boolean;
    isStarred: boolean;
    searchText: string;
};

export type ReaderFeed = {
    id: string;
    url: string;
    title: string;
    homeUrl: string;
    category: string;
    group: string;
    refreshSeconds: number;
    serverSyncEnabled: boolean;
    paused: boolean;
    lastFetchedAt: string;
    nextFetchAt: string;
    lastError: string;
    syncLockedUntil: string;
    createdAt: string;
    updatedAt: string;
};

export type ReaderFeedInput = {
    id?: string;
    url: string;
    title?: string;
    homeUrl?: string;
    category?: string;
    group?: string;
    refreshSeconds?: number;
    serverSyncEnabled?: boolean;
    paused?: boolean;
    lastFetchedAt?: string;
    nextFetchAt?: string;
    lastError?: string;
};

export type ReaderFeedPatch = Partial<Omit<ReaderFeedInput, 'id' | 'url'>> & {
    url?: string;
};

export type FetchRunStatus = 'success' | 'error' | 'started';

const databaseUrl = process.env.READER_DATABASE_URL || process.env.DATABASE_URL;

const pool = databaseUrl
    ? new Pool({
          connectionString: databaseUrl,
      })
    : null;

let schemaReady: Promise<void> | undefined;

export function hasReaderDatabase() {
    return Boolean(pool);
}

export function getPool() {
    if (!pool) {
        throw new Error('READER_DATABASE_URL or DATABASE_URL is required for the reader Postgres store.');
    }
    return pool;
}

export function createId(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        // oxlint-disable-next-line unicorn/prefer-code-point -- Keep compatibility with the existing reader frontend hash.
        hash = Math.imul(31, hash) + value.charCodeAt(index);
    }
    return Math.abs(hash).toString(36);
}

export function createSecretHash(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

export function normalizeFeedUrl(url: string) {
    const trimmed = String(url || '').trim();
    if (!trimmed) {
        throw new Error('Feed URL is required.');
    }
    return trimmed;
}

export function createFeedId(url: string) {
    return createId(normalizeFeedUrl(url));
}

function normalizeCategory(value: unknown) {
    const category = String(value || '').trim();
    return ['articles', 'chat', 'notifications', 'social', 'videos'].includes(category) ? category : 'articles';
}

function inferCategory(url: string) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/discord/channel/') || lowerUrl.includes('/telegram/topic/')) {
        return 'chat';
    }
    if (['twitter', 'x.com', 'bsky', 'mastodon', 'weibo', 'telegram', 'threads'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'social';
    }
    if (['youtube', 'bilibili', 'douyin', 'tiktok', 'video', 'podcast'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'videos';
    }
    if (['status', 'release', 'security', 'notice', 'notification', 'alert'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'notifications';
    }
    return 'articles';
}

function normalizeRefreshSeconds(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) {
        return 300;
    }
    return Math.min(Math.max(Math.trunc(seconds), 30), 24 * 60 * 60);
}

function toIsoString(value: unknown) {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function getTimestamp(value: unknown) {
    if (!value) {
        return 0;
    }
    const date = value instanceof Date ? value : new Date(value as string | number);
    const time = date.getTime();
    return Number.isNaN(time) ? 0 : time;
}

function stripHtml(value: string) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function stringifyAuthor(author: DataItem['author']) {
    if (Array.isArray(author)) {
        return author
            .map((item) => item.name)
            .filter(Boolean)
            .join(', ');
    }
    return String(author || '');
}

function itemCategories(item: DataItem) {
    if (Array.isArray(item.category)) {
        return item.category.map((category) => String(category || '').trim()).filter(Boolean);
    }
    return [];
}

export function rowToItem(row: QueryResultRow): ReaderItem {
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

export function rowToFeed(row: QueryResultRow): ReaderFeed {
    return {
        id: row.id,
        url: row.url,
        title: row.title || '',
        homeUrl: row.home_url || '',
        category: row.category || 'articles',
        group: row.group_name || '',
        refreshSeconds: Number(row.refresh_seconds) || 300,
        serverSyncEnabled: row.server_sync_enabled,
        paused: row.paused,
        lastFetchedAt: toIsoString(row.last_fetched_at),
        nextFetchAt: toIsoString(row.next_fetch_at),
        lastError: row.last_error || '',
        syncLockedUntil: toIsoString(row.sync_locked_until),
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}

export function readerItemToValues(item: Partial<ReaderItem> & { id: string; feedId: string }) {
    const categories = Array.isArray(item.categories) ? item.categories : [];
    return [
        item.id,
        item.feedId,
        normalizeCategory(item.category),
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

export function dataItemToReaderItem(feed: Pick<ReaderFeed, 'id' | 'category'>, item: DataItem): ReaderItem | null {
    const link = item.link || item.guid || item.id || item.title;
    if (!link) {
        return null;
    }
    const description = item.description || item.content?.html || item.content?.text || '';
    const summary = item.content?.text || stripHtml(description);
    const categories = itemCategories(item);
    const pubDate = item.pubDate || item.updated || '';
    const idSeed = item.guid || item.id || item.link || item.title || link;
    const title = item.title || link || 'Untitled';
    return {
        id: createId(`${feed.id}:${String(idSeed)}`),
        feedId: feed.id,
        category: normalizeCategory(feed.category),
        title,
        link,
        author: stringifyAuthor(item.author),
        pubDate: pubDate ? String(pubDate instanceof Date ? pubDate.toUTCString() : pubDate) : '',
        pubDateMs: getTimestamp(pubDate),
        description,
        summary,
        categories,
        isRead: false,
        isStarred: false,
        searchText: [title, summary, stringifyAuthor(item.author), ...categories].join(' ').toLowerCase(),
    };
}

export function dataToFeedInput(url: string, data: Data, current?: Partial<ReaderFeed>): ReaderFeedInput {
    return {
        id: current?.id || createFeedId(url),
        url,
        title: data.title || current?.title || url,
        homeUrl: data.link || current?.homeUrl || url,
        category: current?.category || inferCategory(url),
        group: current?.group || '',
        refreshSeconds: current?.refreshSeconds || 300,
        serverSyncEnabled: current?.serverSyncEnabled ?? false,
        paused: current?.paused ?? false,
    };
}

export async function ensureSchema() {
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

            CREATE TABLE IF NOT EXISTS reader_feeds (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                home_url TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'articles',
                group_name TEXT NOT NULL DEFAULT '',
                refresh_seconds INTEGER NOT NULL DEFAULT 300,
                server_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                paused BOOLEAN NOT NULL DEFAULT FALSE,
                last_fetched_at TIMESTAMPTZ,
                next_fetch_at TIMESTAMPTZ,
                last_error TEXT NOT NULL DEFAULT '',
                sync_locked_until TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS reader_fetch_runs (
                id BIGSERIAL PRIMARY KEY,
                feed_id TEXT NOT NULL,
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                item_count INTEGER NOT NULL DEFAULT 0,
                error TEXT NOT NULL DEFAULT ''
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
            CREATE INDEX IF NOT EXISTS reader_feeds_next_fetch_idx ON reader_feeds (server_sync_enabled, paused, next_fetch_at);
            CREATE INDEX IF NOT EXISTS reader_fetch_runs_feed_started_idx ON reader_fetch_runs (feed_id, started_at DESC);

            UPDATE reader_items
            SET category = 'chat', updated_at = NOW()
            WHERE category = 'images';
        `);
        })();
    }
    await schemaReady;
}

export async function upsertItems(items: Array<Partial<ReaderItem> & { id: string; feedId: string }>, client?: PoolClient) {
    if (!items.length) {
        return 0;
    }
    const db = client || (await getPool().connect());
    const shouldRelease = !client;
    try {
        if (!client) {
            await db.query('BEGIN');
        }
        await Promise.all(
            items.map((item) =>
                db.query(
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
                    readerItemToValues(item)
                )
            )
        );
        if (!client) {
            await db.query('COMMIT');
        }
        return items.length;
    } catch (error) {
        if (!client) {
            await db.query('ROLLBACK');
        }
        throw error;
    } finally {
        if (shouldRelease) {
            db.release();
        }
    }
}

export function persistDataItems(feed: Pick<ReaderFeed, 'id' | 'category'>, items: DataItem[] = []) {
    return upsertItems(items.map((item) => dataItemToReaderItem(feed, item)).filter((item): item is ReaderItem => item !== null));
}

export async function persistRouteData(url: string, data: Data, options: { category?: string; serverSyncEnabled?: boolean } = {}) {
    if (!data.item?.length) {
        return { feed: null, itemCount: 0 };
    }
    await ensureSchema();
    const existing = await getFeedByUrl(url);
    const category = existing?.category || options.category || inferCategory(url);
    const feed = await upsertFeed({
        ...dataToFeedInput(url, data, existing || { category }),
        category,
        serverSyncEnabled: options.serverSyncEnabled ?? existing?.serverSyncEnabled ?? false,
    });
    const itemCount = await persistDataItems(feed, data.item);
    return { feed, itemCount };
}

export async function listFeeds() {
    const result = await getPool().query('SELECT * FROM reader_feeds ORDER BY updated_at DESC, title ASC, url ASC');
    return result.rows.map((row) => rowToFeed(row));
}

export async function getFeed(feedId: string) {
    const result = await getPool().query('SELECT * FROM reader_feeds WHERE id = $1', [feedId]);
    return result.rows[0] ? rowToFeed(result.rows[0]) : null;
}

export async function getFeedByUrl(url: string) {
    const result = await getPool().query('SELECT * FROM reader_feeds WHERE url = $1', [normalizeFeedUrl(url)]);
    return result.rows[0] ? rowToFeed(result.rows[0]) : null;
}

function feedValues(feed: ReaderFeedInput) {
    const url = normalizeFeedUrl(feed.url);
    const id = feed.id || createFeedId(url);
    return [
        id,
        url,
        feed.title || url,
        feed.homeUrl || url,
        normalizeCategory(feed.category),
        String(feed.group || ''),
        normalizeRefreshSeconds(feed.refreshSeconds),
        Boolean(feed.serverSyncEnabled),
        Boolean(feed.paused),
        feed.lastFetchedAt || null,
        feed.nextFetchAt || null,
        feed.lastError || '',
    ];
}

export async function upsertFeed(feed: ReaderFeedInput) {
    const result = await getPool().query(
        `
            INSERT INTO reader_feeds (
                id, url, title, home_url, category, group_name, refresh_seconds,
                server_sync_enabled, paused, last_fetched_at, next_fetch_at, last_error
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (url) DO UPDATE SET
                title = EXCLUDED.title,
                home_url = EXCLUDED.home_url,
                category = EXCLUDED.category,
                group_name = EXCLUDED.group_name,
                refresh_seconds = EXCLUDED.refresh_seconds,
                server_sync_enabled = EXCLUDED.server_sync_enabled,
                paused = EXCLUDED.paused,
                last_fetched_at = COALESCE(EXCLUDED.last_fetched_at, reader_feeds.last_fetched_at),
                next_fetch_at = COALESCE(EXCLUDED.next_fetch_at, reader_feeds.next_fetch_at),
                last_error = EXCLUDED.last_error,
                updated_at = NOW()
            RETURNING *
        `,
        feedValues(feed)
    );
    return rowToFeed(result.rows[0]);
}

export async function updateFeed(feedId: string, patch: ReaderFeedPatch) {
    const current = await getFeed(feedId);
    if (!current) {
        return null;
    }
    return upsertFeed({
        id: current.id,
        url: patch.url || current.url,
        title: patch.title ?? current.title,
        homeUrl: patch.homeUrl ?? current.homeUrl,
        category: patch.category ?? current.category,
        group: patch.group ?? current.group,
        refreshSeconds: patch.refreshSeconds ?? current.refreshSeconds,
        serverSyncEnabled: patch.serverSyncEnabled ?? current.serverSyncEnabled,
        paused: patch.paused ?? current.paused,
        lastFetchedAt: patch.lastFetchedAt ?? current.lastFetchedAt,
        nextFetchAt: patch.nextFetchAt ?? current.nextFetchAt,
        lastError: patch.lastError ?? current.lastError,
    });
}

export async function updateFeedItemsCategory(feedId: string, category: string) {
    await getPool().query('UPDATE reader_items SET category = $2, updated_at = NOW() WHERE feed_id = $1', [feedId, normalizeCategory(category)]);
}

export async function deleteFeedItems(feedId: string, client?: PoolClient) {
    await (client || getPool()).query('DELETE FROM reader_items WHERE feed_id = $1', [feedId]);
}

export async function deleteFeed(feedId: string) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await deleteFeedItems(feedId, client);
        const result = await client.query('DELETE FROM reader_feeds WHERE id = $1', [feedId]);
        await client.query('COMMIT');
        return (result.rowCount || 0) > 0;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function updateFeedFetchState(feedId: string, state: { title?: string; homeUrl?: string; lastFetchedAt?: string; nextFetchAt?: string; lastError?: string; releaseLock?: boolean }) {
    const result = await getPool().query(
        `
            UPDATE reader_feeds
            SET
                title = COALESCE($2, title),
                home_url = COALESCE($3, home_url),
                last_fetched_at = COALESCE($4, last_fetched_at),
                next_fetch_at = COALESCE($5, next_fetch_at),
                last_error = COALESCE($6, last_error),
                sync_locked_until = CASE WHEN $7 THEN NULL ELSE sync_locked_until END,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [feedId, state.title ?? null, state.homeUrl ?? null, state.lastFetchedAt ?? null, state.nextFetchAt ?? null, state.lastError ?? null, Boolean(state.releaseLock)]
    );
    return result.rows[0] ? rowToFeed(result.rows[0]) : null;
}

export async function claimDueFeeds(limit = 5, lockSeconds = 300) {
    const result = await getPool().query(
        `
            WITH due AS (
                SELECT id
                FROM reader_feeds
                WHERE server_sync_enabled = TRUE
                    AND paused = FALSE
                    AND (next_fetch_at IS NULL OR next_fetch_at <= NOW())
                    AND (sync_locked_until IS NULL OR sync_locked_until <= NOW())
                ORDER BY COALESCE(next_fetch_at, created_at) ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE reader_feeds
            SET sync_locked_until = NOW() + ($2::text || ' seconds')::interval,
                updated_at = NOW()
            WHERE id IN (SELECT id FROM due)
            RETURNING *
        `,
        [limit, lockSeconds]
    );
    return result.rows.map((row) => rowToFeed(row));
}

export async function recordFetchRun(feedId: string, status: FetchRunStatus, itemCount = 0, error = '', startedAt?: string) {
    await getPool().query(
        `
            INSERT INTO reader_fetch_runs (feed_id, started_at, finished_at, status, item_count, error)
            VALUES ($1, COALESCE($2::timestamptz, NOW()), NOW(), $3, $4, $5)
        `,
        [feedId, startedAt || null, status, itemCount, error]
    );
}
