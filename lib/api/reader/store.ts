import { createHash, randomUUID } from 'node:crypto';

import dayjs from 'dayjs';
import timezonePlugin from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
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
    aiSummaryPrompt: string;
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

export type ReaderAiSummaryPushMode = 'summary' | 'realtime' | 'event';
export type ReaderAiSummaryPushCadence = 'daily' | 'weekly';
export type ReaderEventSeverity = 'low' | 'medium' | 'high';
export type ReaderEventStatus = 'open' | 'resolved' | 'falsePositive';

export type ReaderAiSummaryPush = {
    id: string;
    configRevision: number;
    feedIds: string[];
    feedSetKey: string;
    title: string;
    days: number;
    prompt: string;
    webhookUrl: string;
    enabled: boolean;
    mode: ReaderAiSummaryPushMode;
    minimumSeverity: ReaderEventSeverity;
    dedupeMinutes: number;
    cadence: ReaderAiSummaryPushCadence;
    weekday: number;
    sendTime: string;
    timezone: string;
    nextSendAt: string;
    lastItemPubDateMs: number;
    lastSentAt: string;
    lastSentForDate: string;
    lastError: string;
    sendLockedUntil: string;
    sendLockToken: string;
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
    aiSummaryPrompt?: string;
    refreshSeconds?: number;
    serverSyncEnabled?: boolean;
    paused?: boolean;
    lastFetchedAt?: string;
    nextFetchAt?: string;
    lastError?: string;
};

export type ReaderAiSummaryPushInput = {
    id?: string;
    feedIds: string[];
    title?: string;
    days?: number;
    prompt?: string;
    webhookUrl?: string;
    enabled?: boolean;
    mode?: string;
    minimumSeverity?: string;
    dedupeMinutes?: number;
    cadence?: string;
    weekday?: number;
    sendTime?: string;
    timezone?: string;
    nextSendAt?: string;
    lastItemPubDateMs?: number;
};

export type ReaderEventDetectionInput = {
    eventKey: string;
    eventType: string;
    title: string;
    summary: string;
    severity: ReaderEventSeverity;
    confidence: number;
    platform?: string;
    version?: string;
};

export type ReaderEvent = ReaderEventDetectionInput & {
    id: string;
    pushId: string;
    feedId: string;
    itemId: string;
    status: ReaderEventStatus;
    occurrenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    notifiedAt: string;
    sourceTitle: string;
    sourceGroup: string;
    itemTitle: string;
    itemLink: string;
    itemAuthor: string;
    itemPubDate: string;
    itemDescription: string;
    itemSummary: string;
};

export type ReaderFeedPatch = Partial<Omit<ReaderFeedInput, 'id' | 'url'>> & {
    url?: string;
};

export type FetchRunStatus = 'success' | 'error' | 'started';

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const databaseUrl = process.env.READER_DATABASE_URL || process.env.DATABASE_URL;

const pool = databaseUrl
    ? new Pool({
          connectionString: databaseUrl,
      })
    : null;
const multiAiSummaryPromptSettingKey = 'multi_ai_summary_prompt';

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

function normalizeSummaryPushDays(value: unknown) {
    return Number(value) === 7 ? 7 : 1;
}

function normalizeSummaryPushFeedIds(feedIds: unknown) {
    if (!Array.isArray(feedIds)) {
        return [];
    }
    return [...new Set(feedIds.map((feedId) => String(feedId || '').trim()).filter(Boolean))].slice(0, 100);
}

function compareStrings(left: string, right: string) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

function normalizeSummaryPushSendTime(value: unknown) {
    const time = String(value || '').trim();
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00';
}

function normalizeSummaryPushMode(value: unknown): ReaderAiSummaryPushMode {
    return value === 'realtime' || value === 'event' ? value : 'summary';
}

export function normalizeReaderEventSeverity(value: unknown): ReaderEventSeverity {
    return value === 'high' || value === 'low' ? value : 'medium';
}

function normalizeReaderEventStatus(value: unknown): ReaderEventStatus {
    return value === 'resolved' || value === 'falsePositive' ? value : 'open';
}

function readerEventStatusToDatabase(value: unknown) {
    return normalizeReaderEventStatus(value) === 'falsePositive' ? 'false_positive' : normalizeReaderEventStatus(value);
}

function normalizeEventDedupeMinutes(value: unknown) {
    const minutes = Number(value);
    return Number.isSafeInteger(minutes) ? Math.min(Math.max(minutes, 1), 24 * 60) : 10;
}

function normalizeEventConfidence(value: unknown) {
    const confidence = Number(value);
    return Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0;
}

function normalizeSummaryPushCadence(value: unknown): ReaderAiSummaryPushCadence {
    return value === 'weekly' ? 'weekly' : 'daily';
}

function normalizeSummaryPushWeekday(value: unknown) {
    const weekday = Number(value);
    return Number.isSafeInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1;
}

function normalizeSummaryPushTimezone(value: unknown) {
    return String(value || '')
        .trim()
        .slice(0, 80);
}

export function isValidAiSummaryPushTimezone(value: unknown) {
    const timezone = normalizeSummaryPushTimezone(value);
    if (!timezone) {
        return true;
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return true;
    } catch {
        return false;
    }
}

export function getDefaultAiSummaryPushTimezone() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone && isValidAiSummaryPushTimezone(timezone) ? timezone : 'UTC';
}

function resolveSummaryPushTimezone(value: unknown) {
    const timezone = normalizeSummaryPushTimezone(value);
    return timezone && isValidAiSummaryPushTimezone(timezone) ? timezone : getDefaultAiSummaryPushTimezone();
}

function normalizeLastItemPubDateMs(value: unknown) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? Math.max(Math.trunc(timestamp), 0) : 0;
}

function normalizeAiSummaryPushConfigRevision(value: unknown) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function toIsoString(value: unknown) {
    if (!value) {
        return '';
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function getNextAiSummaryPushAt(sendTime: string, after: Date | string = new Date(), cadence: ReaderAiSummaryPushCadence = 'daily', weekday = 1, timezone = '') {
    const anchor = after instanceof Date ? after : new Date(after);
    const from = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
    const normalizedCadence = normalizeSummaryPushCadence(cadence);
    const normalizedWeekday = normalizeSummaryPushWeekday(weekday);
    const resolvedTimezone = resolveSummaryPushTimezone(timezone);
    const localFrom = dayjs(from).tz(resolvedTimezone);
    const daysUntilTarget = normalizedCadence === 'weekly' ? (normalizedWeekday - localFrom.day() + 7) % 7 : 0;
    const getCandidate = (daysAfter: number) => dayjs.tz(`${localFrom.add(daysAfter, 'day').format('YYYY-MM-DD')} ${normalizeSummaryPushSendTime(sendTime)}`, resolvedTimezone);
    let next = getCandidate(daysUntilTarget);
    if (next.valueOf() <= from.getTime()) {
        next = getCandidate(daysUntilTarget + (normalizedCadence === 'weekly' ? 7 : 1));
    }
    return next.toISOString();
}

export function getFollowingAiSummaryPushAt(sendTime: string, scheduledAt: Date | string, cadence: ReaderAiSummaryPushCadence = 'daily', timezone = '', periodCount = 1) {
    const anchor = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    const from = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
    const normalizedCadence = normalizeSummaryPushCadence(cadence);
    const normalizedPeriodCount = Number.isSafeInteger(periodCount) && periodCount > 0 ? periodCount : 1;
    const resolvedTimezone = resolveSummaryPushTimezone(timezone);
    const daysAfter = normalizedPeriodCount * (normalizedCadence === 'weekly' ? 7 : 1);
    const localDate = dayjs(from).tz(resolvedTimezone).add(daysAfter, 'day').format('YYYY-MM-DD');
    return dayjs.tz(`${localDate} ${normalizeSummaryPushSendTime(sendTime)}`, resolvedTimezone).toISOString();
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
        aiSummaryPrompt: row.ai_summary_prompt || '',
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

export function rowToAiSummaryPush(row: QueryResultRow): ReaderAiSummaryPush {
    return {
        id: row.id,
        configRevision: normalizeAiSummaryPushConfigRevision(row.config_revision),
        feedIds: normalizeSummaryPushFeedIds(row.feed_ids),
        feedSetKey: row.feed_set_key || '',
        title: row.title || '',
        days: normalizeSummaryPushDays(row.days),
        prompt: row.prompt || '',
        webhookUrl: row.webhook_url || '',
        enabled: row.enabled,
        mode: normalizeSummaryPushMode(row.mode),
        minimumSeverity: normalizeReaderEventSeverity(row.minimum_severity),
        dedupeMinutes: normalizeEventDedupeMinutes(row.dedupe_minutes),
        cadence: normalizeSummaryPushCadence(row.cadence),
        weekday: normalizeSummaryPushWeekday(row.weekday),
        sendTime: normalizeSummaryPushSendTime(row.send_time),
        timezone: normalizeSummaryPushTimezone(row.timezone),
        nextSendAt: toIsoString(row.next_send_at),
        lastItemPubDateMs: normalizeLastItemPubDateMs(row.last_item_pub_date_ms),
        lastSentAt: toIsoString(row.last_sent_at),
        lastSentForDate: row.last_sent_for_date || '',
        lastError: row.last_error || '',
        sendLockedUntil: toIsoString(row.send_locked_until),
        sendLockToken: row.send_lock_token || '',
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
    };
}

export function rowToReaderEvent(row: QueryResultRow): ReaderEvent {
    return {
        id: row.id,
        pushId: row.push_id,
        feedId: row.feed_id,
        itemId: row.item_id,
        eventKey: row.event_key || '',
        eventType: row.event_type || 'productIssue',
        title: row.title || '产品事件',
        summary: row.summary || '',
        severity: normalizeReaderEventSeverity(row.severity),
        confidence: normalizeEventConfidence(row.confidence),
        platform: row.platform || '',
        version: row.version || '',
        status: normalizeReaderEventStatus(row.status === 'false_positive' ? 'falsePositive' : row.status),
        occurrenceCount: Math.max(Number(row.occurrence_count) || 1, 1),
        firstSeenAt: toIsoString(row.first_seen_at),
        lastSeenAt: toIsoString(row.last_seen_at),
        notifiedAt: toIsoString(row.notified_at),
        sourceTitle: row.source_title || '',
        sourceGroup: row.source_group || '',
        itemTitle: row.item_title || '',
        itemLink: row.item_link || '',
        itemAuthor: row.item_author || '',
        itemPubDate: row.item_pub_date || '',
        itemDescription: row.item_description || '',
        itemSummary: row.item_summary || '',
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
        aiSummaryPrompt: current?.aiSummaryPrompt || '',
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
                ai_summary_prompt TEXT NOT NULL DEFAULT '',
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

            ALTER TABLE reader_feeds
            ADD COLUMN IF NOT EXISTS ai_summary_prompt TEXT NOT NULL DEFAULT '';

            CREATE TABLE IF NOT EXISTS reader_ai_summary_pushes (
                id TEXT PRIMARY KEY,
                config_revision BIGINT NOT NULL DEFAULT 0,
                feed_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                feed_set_key TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                days INTEGER NOT NULL DEFAULT 1,
                prompt TEXT NOT NULL DEFAULT '',
                webhook_url TEXT NOT NULL DEFAULT '',
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                mode TEXT NOT NULL DEFAULT 'summary',
                minimum_severity TEXT NOT NULL DEFAULT 'medium',
                dedupe_minutes INTEGER NOT NULL DEFAULT 10,
                cadence TEXT NOT NULL DEFAULT 'daily' CONSTRAINT reader_ai_summary_pushes_cadence_check CHECK (cadence IN ('daily', 'weekly')),
                weekday INTEGER NOT NULL DEFAULT 1 CONSTRAINT reader_ai_summary_pushes_weekday_check CHECK (weekday BETWEEN 0 AND 6),
                send_time TEXT NOT NULL DEFAULT '09:00',
                timezone TEXT NOT NULL DEFAULT '',
                next_send_at TIMESTAMPTZ,
                last_item_pub_date_ms BIGINT NOT NULL DEFAULT 0,
                last_sent_at TIMESTAMPTZ,
                last_sent_for_date TEXT NOT NULL DEFAULT '',
                last_error TEXT NOT NULL DEFAULT '',
                send_locked_until TIMESTAMPTZ,
                send_lock_token TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'summary';

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS minimum_severity TEXT NOT NULL DEFAULT 'medium';

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS dedupe_minutes INTEGER NOT NULL DEFAULT 10;

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS last_item_pub_date_ms BIGINT NOT NULL DEFAULT 0;

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS config_revision BIGINT NOT NULL DEFAULT 0;

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS feed_set_key TEXT NOT NULL DEFAULT '';

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS cadence TEXT NOT NULL DEFAULT 'daily';

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS weekday INTEGER NOT NULL DEFAULT 1;

            ALTER TABLE reader_ai_summary_pushes
            ADD COLUMN IF NOT EXISTS send_lock_token TEXT NOT NULL DEFAULT '';

            UPDATE reader_ai_summary_pushes
            SET minimum_severity = 'medium'
            WHERE minimum_severity NOT IN ('low', 'medium', 'high');

            UPDATE reader_ai_summary_pushes
            SET dedupe_minutes = 10
            WHERE dedupe_minutes < 1 OR dedupe_minutes > 1440;

            UPDATE reader_ai_summary_pushes
            SET cadence = 'daily'
            WHERE cadence NOT IN ('daily', 'weekly');

            UPDATE reader_ai_summary_pushes
            SET weekday = 1
            WHERE weekday < 0 OR weekday > 6;

            DO $reader_schema$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reader_ai_summary_pushes_cadence_check'
                        AND conrelid = 'reader_ai_summary_pushes'::regclass
                ) THEN
                    BEGIN
                        ALTER TABLE reader_ai_summary_pushes
                        ADD CONSTRAINT reader_ai_summary_pushes_cadence_check CHECK (cadence IN ('daily', 'weekly'));
                    EXCEPTION WHEN duplicate_object THEN
                        NULL;
                    END;
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'reader_ai_summary_pushes_weekday_check'
                        AND conrelid = 'reader_ai_summary_pushes'::regclass
                ) THEN
                    BEGIN
                        ALTER TABLE reader_ai_summary_pushes
                        ADD CONSTRAINT reader_ai_summary_pushes_weekday_check CHECK (weekday BETWEEN 0 AND 6);
                    EXCEPTION WHEN duplicate_object THEN
                        NULL;
                    END;
                END IF;
            END;
            $reader_schema$;

            CREATE TABLE IF NOT EXISTS reader_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL DEFAULT '',
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

            CREATE TABLE IF NOT EXISTS reader_events (
                id TEXT PRIMARY KEY,
                push_id TEXT NOT NULL REFERENCES reader_ai_summary_pushes(id) ON DELETE CASCADE,
                feed_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                event_key TEXT NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'productIssue',
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT 'medium',
                confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
                platform TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                occurrence_count INTEGER NOT NULL DEFAULT 1,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                notified_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS reader_event_occurrences (
                event_id TEXT NOT NULL REFERENCES reader_events(id) ON DELETE CASCADE,
                push_id TEXT NOT NULL,
                feed_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (push_id, item_id)
            );

            CREATE INDEX IF NOT EXISTS reader_items_pub_date_ms_idx ON reader_items (pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_feed_pub_date_idx ON reader_items (feed_id, pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_category_pub_date_idx ON reader_items (category, pub_date_ms DESC);
            CREATE INDEX IF NOT EXISTS reader_items_unread_category_idx ON reader_items (is_read, category);
            CREATE INDEX IF NOT EXISTS reader_items_search_idx ON reader_items USING gin (to_tsvector('simple', search_text));
            CREATE INDEX IF NOT EXISTS reader_ai_summary_pushes_next_send_idx ON reader_ai_summary_pushes (enabled, next_send_at);
            CREATE INDEX IF NOT EXISTS reader_ai_summary_pushes_feed_ids_idx ON reader_ai_summary_pushes USING gin (feed_ids);
            CREATE INDEX IF NOT EXISTS reader_ai_summary_pushes_feed_set_key_idx ON reader_ai_summary_pushes (feed_set_key);
            CREATE INDEX IF NOT EXISTS reader_feeds_next_fetch_idx ON reader_feeds (server_sync_enabled, paused, next_fetch_at);
            CREATE INDEX IF NOT EXISTS reader_fetch_runs_feed_started_idx ON reader_fetch_runs (feed_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS reader_events_status_last_seen_idx ON reader_events (status, last_seen_at DESC);
            CREATE INDEX IF NOT EXISTS reader_events_dedupe_idx ON reader_events (push_id, event_key, last_seen_at DESC);
            CREATE INDEX IF NOT EXISTS reader_event_occurrences_event_idx ON reader_event_occurrences (event_id, created_at DESC);

            UPDATE reader_items
            SET category = 'chat', updated_at = NOW()
            WHERE category = 'images';
        `);
            const pushesWithoutFeedSetKey = await getPool().query("SELECT id, feed_ids FROM reader_ai_summary_pushes WHERE feed_set_key = ''");
            await Promise.all(
                pushesWithoutFeedSetKey.rows.map((row) =>
                    getPool().query("UPDATE reader_ai_summary_pushes SET feed_set_key = $2 WHERE id = $1 AND feed_set_key = ''", [row.id, createAiSummaryPushFeedSetKey(normalizeSummaryPushFeedIds(row.feed_ids))])
                )
            );
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

export async function persistDataItemsWithNewItems(feed: Pick<ReaderFeed, 'id' | 'category'>, items: DataItem[] = []) {
    const readerItems = items.map((item) => dataItemToReaderItem(feed, item)).filter((item): item is ReaderItem => item !== null);
    if (!readerItems.length) {
        return { itemCount: 0, newItems: [] };
    }

    const result = await getPool().query('SELECT id FROM reader_items WHERE id = ANY($1::text[])', [readerItems.map((item) => item.id)]);
    const existingIds = new Set(result.rows.map((row) => row.id));
    await upsertItems(readerItems);
    return {
        itemCount: readerItems.length,
        newItems: readerItems.filter((item) => !existingIds.has(item.id)),
    };
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
        String(feed.aiSummaryPrompt || ''),
        normalizeRefreshSeconds(feed.refreshSeconds),
        Boolean(feed.serverSyncEnabled),
        Boolean(feed.paused),
        feed.lastFetchedAt || null,
        feed.nextFetchAt || null,
        feed.lastError || '',
    ];
}

export function createAiSummaryPushId() {
    return randomUUID();
}

export function createAiSummaryPushFeedSetKey(feedIds: string[]) {
    const canonicalFeedIds = normalizeSummaryPushFeedIds(feedIds).toSorted(compareStrings);
    return createSecretHash(JSON.stringify(canonicalFeedIds));
}

function aiSummaryPushValues(push: ReaderAiSummaryPushInput) {
    const feedIds = normalizeSummaryPushFeedIds(push.feedIds);
    const sendTime = normalizeSummaryPushSendTime(push.sendTime);
    const enabled = Boolean(push.enabled);
    const mode = normalizeSummaryPushMode(push.mode);
    const cadence = normalizeSummaryPushCadence(push.cadence);
    const weekday = normalizeSummaryPushWeekday(push.weekday);
    const timezone = normalizeSummaryPushTimezone(push.timezone);
    const nextSendAt = enabled && mode === 'summary' ? toIsoString(push.nextSendAt) || getNextAiSummaryPushAt(sendTime, new Date(), cadence, weekday, timezone) : null;
    return [
        push.id || createAiSummaryPushId(),
        JSON.stringify(feedIds),
        createAiSummaryPushFeedSetKey(feedIds),
        String(push.title || '')
            .trim()
            .slice(0, 160),
        normalizeSummaryPushDays(push.days),
        String(push.prompt || '').trim(),
        String(push.webhookUrl || '').trim(),
        enabled,
        mode,
        normalizeReaderEventSeverity(push.minimumSeverity),
        normalizeEventDedupeMinutes(push.dedupeMinutes),
        cadence,
        weekday,
        sendTime,
        timezone,
        nextSendAt,
        normalizeLastItemPubDateMs(push.lastItemPubDateMs),
    ];
}

export async function upsertFeed(feed: ReaderFeedInput) {
    const result = await getPool().query(
        `
            INSERT INTO reader_feeds (
                id, url, title, home_url, category, group_name, ai_summary_prompt,
                refresh_seconds, server_sync_enabled, paused, last_fetched_at, next_fetch_at,
                last_error
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (url) DO UPDATE SET
                title = EXCLUDED.title,
                home_url = EXCLUDED.home_url,
                category = EXCLUDED.category,
                group_name = EXCLUDED.group_name,
                ai_summary_prompt = COALESCE(NULLIF(EXCLUDED.ai_summary_prompt, ''), reader_feeds.ai_summary_prompt),
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

export async function createAiSummaryPush(push: ReaderAiSummaryPushInput) {
    const result = await getPool().query(
        `
            INSERT INTO reader_ai_summary_pushes (
                id, feed_ids, feed_set_key, title, days, prompt, webhook_url, enabled, mode,
                minimum_severity, dedupe_minutes, cadence, weekday, send_time, timezone,
                next_send_at, last_item_pub_date_ms
            )
            VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
        `,
        aiSummaryPushValues(push)
    );
    return rowToAiSummaryPush(result.rows[0]);
}

export async function updateAiSummaryPush(pushId: string, push: ReaderAiSummaryPushInput, expectedRevision: number) {
    const values = [...aiSummaryPushValues({ ...push, id: pushId }), normalizeAiSummaryPushConfigRevision(expectedRevision)];
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET
                feed_ids = $2::jsonb,
                feed_set_key = $3,
                title = $4,
                days = $5,
                prompt = $6,
                webhook_url = $7,
                enabled = $8,
                mode = $9,
                minimum_severity = $10,
                dedupe_minutes = $11,
                cadence = $12,
                weekday = $13,
                send_time = $14,
                timezone = $15,
                next_send_at = $16,
                last_item_pub_date_ms = $17,
                config_revision = config_revision + 1,
                last_error = '',
                send_locked_until = NULL,
                send_lock_token = '',
                updated_at = NOW()
            WHERE id = $1
                AND config_revision = $18
                AND (send_locked_until IS NULL OR send_locked_until <= NOW())
            RETURNING *
        `,
        values
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
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
        aiSummaryPrompt: patch.aiSummaryPrompt ?? current.aiSummaryPrompt,
        refreshSeconds: patch.refreshSeconds ?? current.refreshSeconds,
        serverSyncEnabled: patch.serverSyncEnabled ?? current.serverSyncEnabled,
        paused: patch.paused ?? current.paused,
        lastFetchedAt: patch.lastFetchedAt ?? current.lastFetchedAt,
        nextFetchAt: patch.nextFetchAt ?? current.nextFetchAt,
        lastError: patch.lastError ?? current.lastError,
    });
}

function normalizeFeedIds(feedIds: string[]) {
    return [...new Set(feedIds.map((feedId) => String(feedId || '').trim()).filter(Boolean))];
}

export async function getFeedsAiSummaryPrompt(feedIds: string[]) {
    const ids = normalizeFeedIds(feedIds);
    if (!ids.length) {
        return '';
    }
    const result = await getPool().query(
        `
            SELECT ai_summary_prompt
            FROM reader_feeds
            WHERE id = ANY($1::text[])
                AND ai_summary_prompt <> ''
            ORDER BY array_position($1::text[], id)
            LIMIT 1
        `,
        [ids]
    );
    return result.rows[0]?.ai_summary_prompt || '';
}

export async function getFeedsLatestItemPubDateMs(feedIds: string[]) {
    const ids = normalizeFeedIds(feedIds);
    if (!ids.length) {
        return 0;
    }
    const result = await getPool().query(
        `
            SELECT COALESCE(MAX(pub_date_ms), 0)::bigint AS latest_pub_date_ms
            FROM reader_items
            WHERE feed_id = ANY($1::text[])
        `,
        [ids]
    );
    return normalizeLastItemPubDateMs(result.rows[0]?.latest_pub_date_ms);
}

export async function updateFeedsAiSummaryPrompt(feedIds: string[], prompt: string) {
    const ids = normalizeFeedIds(feedIds);
    if (!ids.length) {
        return 0;
    }
    const result = await getPool().query(
        `
            UPDATE reader_feeds
            SET ai_summary_prompt = $2,
                updated_at = NOW()
            WHERE id = ANY($1::text[])
        `,
        [ids, prompt]
    );
    return result.rowCount || 0;
}

async function getReaderSetting(settingKey: string) {
    const result = await getPool().query('SELECT setting_value FROM reader_settings WHERE setting_key = $1', [settingKey]);
    return result.rows[0]?.setting_value || '';
}

async function updateReaderSetting(settingKey: string, settingValue: string) {
    const result = await getPool().query(
        `
            INSERT INTO reader_settings (setting_key, setting_value)
            VALUES ($1, $2)
            ON CONFLICT (setting_key) DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                updated_at = NOW()
            RETURNING setting_value
        `,
        [settingKey, settingValue]
    );
    return result.rows[0]?.setting_value || '';
}

export function getMultiAiSummaryPrompt() {
    return getReaderSetting(multiAiSummaryPromptSettingKey);
}

export function updateMultiAiSummaryPrompt(prompt: string) {
    return updateReaderSetting(multiAiSummaryPromptSettingKey, prompt);
}

export async function getAiSummaryPush(pushId: string) {
    const result = await getPool().query('SELECT * FROM reader_ai_summary_pushes WHERE id = $1', [pushId]);
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
}

export async function listAiSummaryPushes() {
    const result = await getPool().query('SELECT * FROM reader_ai_summary_pushes ORDER BY created_at ASC, id ASC');
    return result.rows.map((row) => rowToAiSummaryPush(row));
}

export async function listAiSummaryPushesByFeedIds(feedIds: string[]) {
    const normalizedFeedIds = normalizeSummaryPushFeedIds(feedIds);
    const result = await getPool().query(
        `
            SELECT *
            FROM reader_ai_summary_pushes
            WHERE feed_set_key = $1
                AND feed_ids @> $2::jsonb
                AND feed_ids <@ $2::jsonb
            ORDER BY created_at ASC, id ASC
        `,
        [createAiSummaryPushFeedSetKey(normalizedFeedIds), JSON.stringify(normalizedFeedIds)]
    );
    return result.rows.map((row) => rowToAiSummaryPush(row));
}

export async function deleteAiSummaryPush(pushId: string) {
    const result = await getPool().query('DELETE FROM reader_ai_summary_pushes WHERE id = $1', [pushId]);
    return (result.rowCount || 0) > 0;
}

export async function listRealtimeAiSummaryPushesForFeed(feedId: string) {
    const result = await getPool().query(
        `
            SELECT *
            FROM reader_ai_summary_pushes
            WHERE enabled = TRUE
                AND mode = 'realtime'
                AND webhook_url <> ''
                AND feed_ids ? $1
            ORDER BY created_at ASC
        `,
        [feedId]
    );
    return result.rows.map((row) => rowToAiSummaryPush(row));
}

export async function listEventAiSummaryPushesForFeed(feedId: string) {
    const result = await getPool().query(
        `
            SELECT *
            FROM reader_ai_summary_pushes
            WHERE enabled = TRUE
                AND mode = 'event'
                AND webhook_url <> ''
                AND feed_ids ? $1
            ORDER BY created_at ASC
        `,
        [feedId]
    );
    return result.rows.map((row) => rowToAiSummaryPush(row));
}

function readerEventSeverityRank(value: unknown) {
    return {
        high: 3,
        low: 1,
        medium: 2,
    }[normalizeReaderEventSeverity(value)];
}

const readerEventSelect = `
    SELECT
        event.*,
        feed.title AS source_title,
        feed.group_name AS source_group,
        item.title AS item_title,
        item.link AS item_link,
        item.author AS item_author,
        item.pub_date AS item_pub_date,
        item.description AS item_description,
        item.summary AS item_summary
    FROM reader_events event
    LEFT JOIN reader_feeds feed ON feed.id = event.feed_id
    LEFT JOIN reader_items item ON item.id = event.item_id
`;

export async function createOrUpdateReaderEvent(push: Pick<ReaderAiSummaryPush, 'dedupeMinutes' | 'id'>, feedId: string, itemId: string, detection: ReaderEventDetectionInput) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM reader_ai_summary_pushes WHERE id = $1 FOR UPDATE', [push.id]);

        const existingOccurrence = await client.query(
            `
                ${readerEventSelect}
                JOIN reader_event_occurrences occurrence ON occurrence.event_id = event.id
                WHERE occurrence.push_id = $1
                    AND occurrence.item_id = $2
                LIMIT 1
            `,
            [push.id, itemId]
        );
        if (existingOccurrence.rows[0]) {
            await client.query('COMMIT');
            return { event: rowToReaderEvent(existingOccurrence.rows[0]), isNew: false };
        }

        const eventKey = String(detection.eventKey || detection.title || itemId)
            .trim()
            .slice(0, 200);
        const current = await client.query(
            `
                SELECT *
                FROM reader_events
                WHERE push_id = $1
                    AND event_key = $2
                    AND status = 'open'
                    AND last_seen_at >= NOW() - ($3::text || ' minutes')::interval
                ORDER BY last_seen_at DESC
                LIMIT 1
                FOR UPDATE
            `,
            [push.id, eventKey, normalizeEventDedupeMinutes(push.dedupeMinutes)]
        );

        let eventRow;
        let isNew = false;
        if (current.rows[0]) {
            const currentEvent = current.rows[0];
            const replaceDetails = readerEventSeverityRank(detection.severity) > readerEventSeverityRank(currentEvent.severity) || normalizeEventConfidence(detection.confidence) > normalizeEventConfidence(currentEvent.confidence);
            const updated = await client.query(
                `
                    UPDATE reader_events
                    SET
                        event_type = CASE WHEN $2 THEN $3 ELSE event_type END,
                        title = CASE WHEN $2 THEN $4 ELSE title END,
                        summary = CASE WHEN $2 THEN $5 ELSE summary END,
                        severity = CASE WHEN $6 > $7 THEN $8 ELSE severity END,
                        confidence = GREATEST(confidence, $9),
                        platform = CASE WHEN $2 THEN $10 ELSE platform END,
                        version = CASE WHEN $2 THEN $11 ELSE version END,
                        occurrence_count = occurrence_count + 1,
                        last_seen_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING *
                `,
                [
                    currentEvent.id,
                    replaceDetails,
                    String(detection.eventType || 'productIssue').slice(0, 80),
                    String(detection.title || '产品事件').slice(0, 240),
                    String(detection.summary || '').slice(0, 2000),
                    readerEventSeverityRank(detection.severity),
                    readerEventSeverityRank(currentEvent.severity),
                    normalizeReaderEventSeverity(detection.severity),
                    normalizeEventConfidence(detection.confidence),
                    String(detection.platform || '').slice(0, 120),
                    String(detection.version || '').slice(0, 120),
                ]
            );
            eventRow = updated.rows[0];
        } else {
            const created = await client.query(
                `
                    INSERT INTO reader_events (
                        id, push_id, feed_id, item_id, event_key, event_type, title, summary,
                        severity, confidence, platform, version
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING *
                `,
                [
                    randomUUID(),
                    push.id,
                    feedId,
                    itemId,
                    eventKey,
                    String(detection.eventType || 'productIssue').slice(0, 80),
                    String(detection.title || '产品事件').slice(0, 240),
                    String(detection.summary || '').slice(0, 2000),
                    normalizeReaderEventSeverity(detection.severity),
                    normalizeEventConfidence(detection.confidence),
                    String(detection.platform || '').slice(0, 120),
                    String(detection.version || '').slice(0, 120),
                ]
            );
            eventRow = created.rows[0];
            isNew = true;
        }

        await client.query(
            `
                INSERT INTO reader_event_occurrences (event_id, push_id, feed_id, item_id)
                VALUES ($1, $2, $3, $4)
            `,
            [eventRow.id, push.id, feedId, itemId]
        );
        await client.query('COMMIT');
        return { event: rowToReaderEvent(eventRow), isNew };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function markReaderEventNotified(eventId: string) {
    const result = await getPool().query(
        `
            UPDATE reader_events
            SET notified_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [eventId]
    );
    return result.rows[0] ? rowToReaderEvent(result.rows[0]) : null;
}

export async function listReaderEvents(options: { limit?: number; offset?: number; search?: string; status?: ReaderEventStatus | 'all' } = {}) {
    const where: string[] = [];
    const values: Array<number | string> = [];
    if (options.status && options.status !== 'all') {
        values.push(readerEventStatusToDatabase(options.status));
        where.push(`event.status = $${values.length}`);
    }
    if (options.search) {
        values.push(`%${options.search.toLowerCase()}%`);
        where.push(`LOWER(CONCAT_WS(' ', event.title, event.summary, event.event_type, event.platform, event.version, item.title, item.author, feed.title)) LIKE $${values.length}`);
    }
    const requestedLimit = Math.trunc(Number(options.limit)) || 50;
    const requestedOffset = Math.trunc(Number(options.offset)) || 0;
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const offset = Math.max(requestedOffset, 0);
    values.push(limit + 1);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;
    const result = await getPool().query(
        `
            ${readerEventSelect}
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY event.last_seen_at DESC, event.id DESC
            LIMIT ${limitPlaceholder}
            OFFSET ${offsetPlaceholder}
        `,
        values
    );
    return {
        events: result.rows.slice(0, limit).map((row) => rowToReaderEvent(row)),
        hasMore: result.rows.length > limit,
    };
}

export async function getReaderEvent(eventId: string) {
    const result = await getPool().query(`${readerEventSelect} WHERE event.id = $1`, [eventId]);
    return result.rows[0] ? rowToReaderEvent(result.rows[0]) : null;
}

export async function getOpenReaderEventCount() {
    const result = await getPool().query("SELECT COUNT(*)::int AS count FROM reader_events WHERE status = 'open'");
    return Number(result.rows[0]?.count) || 0;
}

export async function updateReaderEventStatus(eventId: string, status: ReaderEventStatus) {
    const result = await getPool().query(
        `
            UPDATE reader_events
            SET status = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [eventId, readerEventStatusToDatabase(status)]
    );
    if (!result.rows[0]) {
        return null;
    }
    return getReaderEvent(eventId);
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
        await client.query('DELETE FROM reader_ai_summary_pushes WHERE feed_ids ? $1', [feedId]);
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

export async function claimDueAiSummaryPushes(limit = 5, lockSeconds = 300) {
    const sendLockToken = randomUUID();
    const result = await getPool().query(
        `
            WITH due AS (
                SELECT id
                FROM reader_ai_summary_pushes
                WHERE enabled = TRUE
                    AND mode = 'summary'
                    AND webhook_url <> ''
                    AND next_send_at IS NOT NULL
                    AND next_send_at <= NOW()
                    AND (send_locked_until IS NULL OR send_locked_until <= NOW())
                ORDER BY next_send_at ASC, created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE reader_ai_summary_pushes
            SET send_locked_until = NOW() + ($2::text || ' seconds')::interval,
                send_lock_token = $3,
                updated_at = NOW()
            WHERE id IN (SELECT id FROM due)
            RETURNING *
        `,
        [limit, lockSeconds, sendLockToken]
    );
    return result.rows.map((row) => rowToAiSummaryPush(row));
}

export async function renewAiSummaryPushLock(pushId: string, sendLockToken: string, lockSeconds = 300) {
    if (!sendLockToken) {
        return null;
    }
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET send_locked_until = NOW() + ($3::text || ' seconds')::interval,
                updated_at = NOW()
            WHERE id = $1
                AND send_lock_token = $2
            RETURNING *
        `,
        [pushId, sendLockToken, lockSeconds]
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
}

export async function completeAiSummaryPush(pushId: string, sendLockToken: string, nextSendAt: string) {
    if (!sendLockToken) {
        return null;
    }
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET
                last_sent_at = NOW(),
                last_sent_for_date = TO_CHAR(NOW(), 'YYYY-MM-DD'),
                next_send_at = $2,
                last_error = '',
                send_locked_until = NULL,
                send_lock_token = '',
                updated_at = NOW()
            WHERE id = $1
                AND send_lock_token = $3
            RETURNING *
        `,
        [pushId, nextSendAt, sendLockToken]
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
}

export async function failAiSummaryPush(pushId: string, sendLockToken: string, message: string, nextSendAt: string) {
    if (!sendLockToken) {
        return null;
    }
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET
                next_send_at = $2,
                last_error = $3,
                send_locked_until = NULL,
                send_lock_token = '',
                updated_at = NOW()
            WHERE id = $1
                AND send_lock_token = $4
            RETURNING *
        `,
        [pushId, nextSendAt, message, sendLockToken]
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
}

export async function recordRealtimeAiSummaryPushSuccess(pushId: string) {
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET
                last_sent_at = NOW(),
                last_sent_for_date = TO_CHAR(NOW(), 'YYYY-MM-DD'),
                last_error = '',
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [pushId]
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
}

export async function recordRealtimeAiSummaryPushFailure(pushId: string, message: string) {
    const result = await getPool().query(
        `
            UPDATE reader_ai_summary_pushes
            SET
                last_error = $2,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `,
        [pushId, message]
    );
    return result.rows[0] ? rowToAiSummaryPush(result.rows[0]) : null;
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
