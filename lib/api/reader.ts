import { Hono } from 'hono';

import { buildAiSummaryResponse, normalizeSummaryDays, normalizeSummaryFeedIds } from './reader/ai-summary';
import { createAiSummaryJob, getAiSummaryJob } from './reader/ai-summary-jobs';
import { defaultEventMonitorPrompt, detectProductEvents } from './reader/event-detection';
import { refreshFeed } from './reader/scheduler';
import {
    createAiSummaryPush,
    createFeedId,
    deleteAiSummaryPush,
    deleteFeed,
    deleteFeedItems,
    ensureSchema,
    getAiSummaryPush,
    getDefaultAiSummaryPushTimezone,
    getMultiAiSummaryPrompt,
    getNextAiSummaryPushAt,
    getOpenReaderEventCount,
    getPool,
    getReaderEvent,
    isValidAiSummaryPushTimezone,
    listAiSummaryPushes,
    listAiSummaryPushesByFeedIds,
    listFeeds,
    listReaderEvents,
    rowToItem,
    updateAiSummaryPush,
    updateFeed,
    updateFeedItemsCategory,
    updateReaderEventStatus,
    upsertFeed,
    upsertItems,
} from './reader/store';

const app = new Hono();

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

function normalizeAiSummaryPushSendTime(value: unknown) {
    const time = String(value || '').trim();
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00';
}

function normalizeAiSummaryPushMode(value: unknown) {
    return value === 'realtime' || value === 'event' ? value : 'summary';
}

function normalizeReaderEventSeverity(value: unknown) {
    return value === 'low' || value === 'high' ? value : 'medium';
}

function normalizeEventDedupeMinutes(value: unknown) {
    const minutes = Number(value);
    return Number.isSafeInteger(minutes) ? Math.min(Math.max(minutes, 1), 24 * 60) : 10;
}

function normalizeReaderEventStatus(value: unknown) {
    return value === 'resolved' || value === 'falsePositive' ? value : 'open';
}

function normalizeAiSummaryPushCadence(value: unknown) {
    return value === 'weekly' ? 'weekly' : 'daily';
}

function normalizeAiSummaryPushWeekday(value: unknown) {
    return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 6 ? Number(value) : 1;
}

function normalizeAiSummaryWebhookUrl(value: unknown) {
    const webhookUrl = String(value || '').trim();
    if (!webhookUrl) {
        return '';
    }
    try {
        const url = new URL(webhookUrl);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
        return '';
    }
}

function normalizeAiSummaryPushTimezone(value: unknown) {
    const timezone = String(value || '').trim();
    return timezone || getDefaultAiSummaryPushTimezone();
}

function getAiSummaryPushValidationError(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return 'Request body must be a JSON object.';
    }
    if ((!partial || Object.hasOwn(body, 'feedIds')) && (!Array.isArray(body.feedIds) || !normalizeSummaryFeedIds(body.feedIds).length)) {
        return 'feedIds must be a non-empty array of feed IDs.';
    }
    if (Array.isArray(body.feedIds) && body.feedIds.some((feedId) => typeof feedId !== 'string' || !feedId.trim())) {
        return 'feedIds must contain only non-empty strings.';
    }
    if (Array.isArray(body.feedIds) && body.feedIds.length > 100) {
        return 'feedIds must contain at most 100 feed IDs.';
    }
    if (body.mode !== undefined && body.mode !== 'summary' && body.mode !== 'realtime' && body.mode !== 'event') {
        return 'mode must be "summary", "realtime", or "event".';
    }
    if (body.cadence !== undefined && body.cadence !== 'daily' && body.cadence !== 'weekly') {
        return 'cadence must be either "daily" or "weekly".';
    }
    if (body.weekday !== undefined && (!Number.isSafeInteger(body.weekday) || body.weekday < 0 || body.weekday > 6)) {
        return 'weekday must be an integer from 0 (Sunday) through 6 (Saturday).';
    }
    if (body.days !== undefined && body.days !== 1 && body.days !== 7) {
        return 'days must be either 1 or 7.';
    }
    if (body.sendTime !== undefined && (typeof body.sendTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.sendTime.trim()))) {
        return 'sendTime must use 24-hour HH:mm format.';
    }
    if (body.timezone !== undefined && (typeof body.timezone !== 'string' || body.timezone.trim().length > 80 || !isValidAiSummaryPushTimezone(body.timezone))) {
        return 'timezone must be an empty string or a valid IANA timezone, such as "Asia/Shanghai".';
    }
    if (body.webhookUrl !== undefined) {
        if (typeof body.webhookUrl !== 'string') {
            return 'webhookUrl must be a string.';
        }
        if (body.webhookUrl.trim() && !normalizeAiSummaryWebhookUrl(body.webhookUrl)) {
            return 'webhookUrl must be a valid HTTP or HTTPS URL.';
        }
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        return 'enabled must be a boolean.';
    }
    if (body.configRevision !== undefined && (!Number.isSafeInteger(body.configRevision) || body.configRevision < 0)) {
        return 'configRevision must be a non-negative integer.';
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length > 160)) {
        return 'title must be a string no longer than 160 characters.';
    }
    if (body.prompt !== undefined && typeof body.prompt !== 'string') {
        return 'prompt must be a string.';
    }
    if (body.minimumSeverity !== undefined && !['low', 'medium', 'high'].includes(body.minimumSeverity)) {
        return 'minimumSeverity must be "low", "medium", or "high".';
    }
    if (body.dedupeMinutes !== undefined && (!Number.isSafeInteger(body.dedupeMinutes) || body.dedupeMinutes < 1 || body.dedupeMinutes > 1440)) {
        return 'dedupeMinutes must be an integer from 1 through 1440.';
    }
}

function getInitialAiSummaryPushNextSendAt(sendTime: string, cadence: 'daily' | 'weekly', weekday: number, timezone: string, enabled: boolean) {
    if (!enabled) {
        return;
    }
    return getNextAiSummaryPushAt(sendTime, new Date(), cadence, weekday, timezone);
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

app.get('/events', async (ctx) => {
    const statusValue = ctx.req.query('status');
    const status = statusValue === 'all' ? 'all' : normalizeReaderEventStatus(statusValue);
    const limit = normalizeLimit(ctx.req.query('limit'));
    const offset = normalizeOffset(ctx.req.query('offset'));
    return ctx.json(
        await listReaderEvents({
            limit,
            offset,
            search: ctx.req.query('search')?.trim(),
            status,
        })
    );
});

app.get('/events/counts', async (ctx) => ctx.json({ open: await getOpenReaderEventCount() }));

app.post('/events/preview', async (ctx) => {
    const body = await ctx.req.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.feedIds)) {
        return ctx.json({ error: 'feedIds must be an array of feed IDs.' }, 400);
    }
    if (body.feedIds.length > 100 || body.feedIds.some((feedId) => typeof feedId !== 'string' || !feedId.trim())) {
        return ctx.json({ error: 'feedIds must contain from 1 to 100 non-empty feed IDs.' }, 400);
    }
    if (body.prompt !== undefined && typeof body.prompt !== 'string') {
        return ctx.json({ error: 'prompt must be a string.' }, 400);
    }
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    if (!feedIds.length) {
        return ctx.json({ error: 'feedIds must contain at least one feed ID.' }, 400);
    }
    const result = await getPool().query(
        `
            SELECT items.*, feeds.title AS source_title
            FROM reader_items items
            LEFT JOIN reader_feeds feeds ON feeds.id = items.feed_id
            WHERE items.feed_id = ANY($1::text[])
            ORDER BY items.pub_date_ms DESC, items.id DESC
            LIMIT 20
        `,
        [feedIds]
    );
    const items = result.rows.map((row) => rowToItem(row));
    const itemById = new Map(result.rows.map((row, index) => [items[index].id, { item: items[index], sourceTitle: row.source_title || '' }]));
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const detections = await detectProductEvents({ prompt: prompt || defaultEventMonitorPrompt }, items);
    return ctx.json({
        events: detections.map((detection) => {
            const source = itemById.get(detection.itemId);
            return {
                ...detection,
                itemAuthor: source?.item.author || '',
                itemLink: source?.item.link || '',
                itemText: source?.item.summary || source?.item.description || source?.item.title || '',
                sourceTitle: source?.sourceTitle || '',
            };
        }),
        inspectedCount: items.length,
    });
});

app.get('/events/:id', async (ctx) => {
    const event = await getReaderEvent(ctx.req.param('id'));
    if (!event) {
        return ctx.json({ error: 'Reader event not found.' }, 404);
    }
    return ctx.json(event);
});

app.patch('/events/:id', async (ctx) => {
    const body = await ctx.req.json();
    if (!['open', 'resolved', 'falsePositive'].includes(body.status)) {
        return ctx.json({ error: 'status must be "open", "resolved", or "falsePositive".' }, 400);
    }
    const event = await updateReaderEventStatus(ctx.req.param('id'), normalizeReaderEventStatus(body.status));
    if (!event) {
        return ctx.json({ error: 'Reader event not found.' }, 404);
    }
    return ctx.json(event);
});

app.get('/ai-summary-pushes', async (ctx) => ctx.json({ pushes: await listAiSummaryPushes() }));

app.post('/ai-summary-pushes/lookup', async (ctx) => {
    const body = await ctx.req.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.feedIds)) {
        return ctx.json({ error: 'feedIds must be an array of feed IDs.' }, 400);
    }
    if (body.feedIds.length > 100) {
        return ctx.json({ error: 'feedIds must contain at most 100 feed IDs.' }, 400);
    }
    if (body.feedIds.some((feedId) => typeof feedId !== 'string' || !feedId.trim())) {
        return ctx.json({ error: 'feedIds must contain only non-empty strings.' }, 400);
    }
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    if (!feedIds.length) {
        return ctx.json({ pushes: [] });
    }

    return ctx.json({ pushes: await listAiSummaryPushesByFeedIds(feedIds) });
});

app.post('/ai-summary-pushes', async (ctx) => {
    const body = await ctx.req.json();
    const validationError = getAiSummaryPushValidationError(body);
    if (validationError) {
        return ctx.json({ error: validationError }, 400);
    }
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    const enabled = body.enabled === true;
    const mode = normalizeAiSummaryPushMode(body.mode);
    const cadence = normalizeAiSummaryPushCadence(body.cadence);
    if (mode !== 'summary' && cadence === 'weekly') {
        return ctx.json({ error: 'cadence "weekly" is only available for summary pushes.' }, 400);
    }
    const webhookUrl = normalizeAiSummaryWebhookUrl(body.webhookUrl);
    if (enabled && !webhookUrl) {
        return ctx.json({ error: 'A valid webhook URL is required to enable push.' }, 400);
    }

    const sendTime = normalizeAiSummaryPushSendTime(body.sendTime);
    const timezone = normalizeAiSummaryPushTimezone(body.timezone);
    const weekday = normalizeAiSummaryPushWeekday(body.weekday);
    const push = await createAiSummaryPush({
        cadence: mode === 'summary' ? cadence : 'daily',
        days: normalizeSummaryDays(body.days),
        enabled,
        feedIds,
        lastItemPubDateMs: 0,
        minimumSeverity: normalizeReaderEventSeverity(body.minimumSeverity),
        dedupeMinutes: normalizeEventDedupeMinutes(body.dedupeMinutes),
        mode,
        nextSendAt: mode === 'summary' ? getInitialAiSummaryPushNextSendAt(sendTime, cadence, weekday, timezone, enabled) : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        sendTime,
        timezone,
        title: typeof body.title === 'string' ? body.title : '',
        weekday,
        webhookUrl,
    });

    return ctx.json(push, 201);
});

app.patch('/ai-summary-pushes/:id', async (ctx) => {
    const body = await ctx.req.json();
    const validationError = getAiSummaryPushValidationError(body, true);
    if (validationError) {
        return ctx.json({ error: validationError }, 400);
    }
    if (!Object.hasOwn(body, 'configRevision')) {
        return ctx.json({ error: 'configRevision is required. Reload the push task and retry.' }, 400);
    }
    const current = await getAiSummaryPush(ctx.req.param('id'));
    if (!current) {
        return ctx.json({ error: 'AI summary push not found.' }, 404);
    }

    const feedIds = body.feedIds === undefined ? current.feedIds : normalizeSummaryFeedIds(body.feedIds);
    const enabled = body.enabled === undefined ? current.enabled : body.enabled;
    const mode = body.mode === undefined ? current.mode : normalizeAiSummaryPushMode(body.mode);
    const requestedCadence = body.cadence === undefined ? current.cadence : normalizeAiSummaryPushCadence(body.cadence);
    if (mode !== 'summary' && body.cadence === 'weekly') {
        return ctx.json({ error: 'cadence "weekly" is only available for summary pushes.' }, 400);
    }
    const cadence = mode === 'summary' ? requestedCadence : 'daily';
    const weekday = body.weekday === undefined ? current.weekday : normalizeAiSummaryPushWeekday(body.weekday);
    const sendTime = body.sendTime === undefined ? current.sendTime : normalizeAiSummaryPushSendTime(body.sendTime);
    const timezone = body.timezone === undefined ? current.timezone : normalizeAiSummaryPushTimezone(body.timezone);
    const webhookUrl = body.webhookUrl === undefined ? current.webhookUrl : normalizeAiSummaryWebhookUrl(body.webhookUrl);
    if (enabled && !webhookUrl) {
        return ctx.json({ error: 'A valid webhook URL is required to enable push.' }, 400);
    }

    const scheduleChanged = !current.enabled || current.mode !== mode || current.sendTime !== sendTime || current.cadence !== cadence || current.weekday !== weekday || current.timezone !== timezone;
    const nextSendAt = enabled && mode === 'summary' ? (scheduleChanged || !current.nextSendAt ? getInitialAiSummaryPushNextSendAt(sendTime, cadence, weekday, timezone, true) : current.nextSendAt) : undefined;
    const resetRealtimeCursor = enabled && mode === 'realtime' && (!current.enabled || current.mode !== 'realtime' || Object.hasOwn(body, 'feedIds'));
    const push = await updateAiSummaryPush(
        current.id,
        {
            cadence,
            days: body.days === undefined ? current.days : normalizeSummaryDays(body.days),
            enabled,
            feedIds,
            lastItemPubDateMs: mode === 'realtime' && !resetRealtimeCursor ? current.lastItemPubDateMs : 0,
            minimumSeverity: body.minimumSeverity === undefined ? current.minimumSeverity : normalizeReaderEventSeverity(body.minimumSeverity),
            dedupeMinutes: body.dedupeMinutes === undefined ? current.dedupeMinutes : normalizeEventDedupeMinutes(body.dedupeMinutes),
            mode,
            nextSendAt,
            prompt: body.prompt === undefined ? current.prompt : body.prompt,
            sendTime,
            timezone,
            title: body.title === undefined ? current.title : body.title,
            weekday,
            webhookUrl,
        },
        body.configRevision
    );
    if (!push) {
        if (await getAiSummaryPush(current.id)) {
            return ctx.json({ error: 'AI summary push was modified or is currently being sent. Reload it and retry.' }, 409);
        }
        return ctx.json({ error: 'AI summary push not found.' }, 404);
    }
    return ctx.json(push);
});

app.delete('/ai-summary-pushes/:id', async (ctx) => {
    const deleted = await deleteAiSummaryPush(ctx.req.param('id'));
    if (!deleted) {
        return ctx.json({ error: 'AI summary push not found.' }, 404);
    }
    return ctx.json({ ok: true });
});

app.get('/ai-summary-prompt', async (ctx) => ctx.json({ prompt: await getMultiAiSummaryPrompt() }));

app.post('/feeds/:feedId/ai-summary', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const result = await buildAiSummaryResponse([ctx.req.param('feedId')], days, body.prompt, body.savePrompt === true, { forceRefresh: body.forceRefresh === true });

    return ctx.json(result);
});

app.post('/feeds/:feedId/ai-summary/jobs', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const job = createAiSummaryJob([ctx.req.param('feedId')], days, body.prompt, body.savePrompt === true, { forceRefresh: body.forceRefresh === true });

    return ctx.json(job, 202);
});

app.post('/feeds/ai-summary', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    const result = await buildAiSummaryResponse(feedIds, days, body.prompt, body.savePrompt === true, { forceRefresh: body.forceRefresh === true });

    return ctx.json(result);
});

app.post('/feeds/ai-summary/jobs', async (ctx) => {
    const body = await ctx.req.json();
    const days = normalizeSummaryDays(body.days);
    const feedIds = normalizeSummaryFeedIds(body.feedIds);
    const job = createAiSummaryJob(feedIds, days, body.prompt, body.savePrompt === true, { forceRefresh: body.forceRefresh === true });

    return ctx.json(job, 202);
});

app.get('/ai-summary/jobs/:jobId', (ctx) => {
    const job = getAiSummaryJob(ctx.req.param('jobId'));
    if (!job) {
        return ctx.json({ error: 'AI summary job not found.' }, 404);
    }
    return ctx.json(job);
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
