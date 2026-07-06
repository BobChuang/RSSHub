import { config } from '@/config';
import logger from '@/utils/logger';

import { sendAiSummaryPush, sendRealtimeItemsPush } from './ai-summary';
import { parseFeedText } from './feed-parser';
import type { ReaderAiSummaryPush, ReaderFeed, ReaderItem } from './store';
import {
    claimDueAiSummaryPushes,
    claimDueFeeds,
    completeAiSummaryPush,
    ensureSchema,
    failAiSummaryPush,
    getFeed,
    getNextAiSummaryPushAt,
    hasReaderDatabase,
    listRealtimeAiSummaryPushesForFeed,
    persistDataItemsWithNewItems,
    recordFetchRun,
    recordRealtimeAiSummaryPushFailure,
    recordRealtimeAiSummaryPushSuccess,
    updateFeedFetchState,
    upsertFeed,
} from './store';

let schedulerStarted = false;
let schedulerRunning = false;

function getFetchUrl(url: string) {
    const baseUrl = config.reader.routeBaseUrl || `http://127.0.0.1:${config.connect.port}`;
    const fetchUrl = url.startsWith('http://') || url.startsWith('https://') ? new URL(url) : new URL(url.startsWith('/') ? url : `/${url}`, baseUrl);
    if (/\/telegram\/channel\/[^/?#]+/.test(fetchUrl.pathname)) {
        fetchUrl.searchParams.set('force_web', '1');
    }
    return fetchUrl.href;
}

function getNextFetchAt(feed: ReaderFeed) {
    return new Date(Date.now() + feed.refreshSeconds * 1000).toISOString();
}

function getFetchTimeoutMs() {
    return Math.max(Number(config.requestTimeout) || 30000, 1000);
}

function getLockSeconds() {
    return Math.max(Math.ceil(getFetchTimeoutMs() / 1000) + config.reader.schedulerInterval, 30);
}

function getNextPushSendAt(push: ReaderAiSummaryPush) {
    const next = push.nextSendAt ? new Date(push.nextSendAt) : new Date(getNextAiSummaryPushAt(push.sendTime));
    if (Number.isNaN(next.getTime())) {
        return getNextAiSummaryPushAt(push.sendTime);
    }
    do {
        next.setDate(next.getDate() + 1);
    } while (next.getTime() <= Date.now());
    return next.toISOString();
}

async function fetchFeedData(feed: ReaderFeed) {
    const fetchUrl = getFetchUrl(feed.url);
    const controller = new AbortController();
    const timeoutMs = getFetchTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(fetchUrl, {
            headers: {
                'x-rsshub-reader-scheduler': '1',
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Request failed with HTTP ${response.status}.`);
        }
        const text = await response.text();
        return parseFeedText(text, response.headers.get('content-type') || '', fetchUrl);
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms.`, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function sendRealtimePushes(feed: ReaderFeed, newItems: ReaderItem[]) {
    if (!newItems.length) {
        return;
    }
    const pushes = await listRealtimeAiSummaryPushesForFeed(feed.id);
    await Promise.all(
        pushes.map(async (push) => {
            const items = newItems.filter((item) => !push.lastItemPubDateMs || item.pubDateMs > push.lastItemPubDateMs);
            if (!items.length) {
                return;
            }
            try {
                await sendRealtimeItemsPush(push, feed, items);
                await recordRealtimeAiSummaryPushSuccess(push.id);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to send realtime push.';
                await recordRealtimeAiSummaryPushFailure(push.id, message);
                logger.warn(`Reader realtime push failed for ${push.title || push.id}: ${message}`);
            }
        })
    );
}

export async function refreshFeed(feedOrId: ReaderFeed | string) {
    await ensureSchema();
    const feed = typeof feedOrId === 'string' ? await getFeed(feedOrId) : feedOrId;
    if (!feed) {
        throw new Error('Feed not found.');
    }

    const startedAt = new Date().toISOString();
    try {
        const data = await fetchFeedData(feed);
        const savedFeed = await upsertFeed({
            id: feed.id,
            url: feed.url,
            title: data.title || feed.title || feed.url,
            homeUrl: data.link || feed.homeUrl || feed.url,
            category: feed.category,
            group: feed.group,
            refreshSeconds: feed.refreshSeconds,
            serverSyncEnabled: feed.serverSyncEnabled,
            paused: feed.paused,
            lastFetchedAt: startedAt,
            nextFetchAt: getNextFetchAt(feed),
            lastError: '',
        });
        const { itemCount, newItems } = await persistDataItemsWithNewItems(savedFeed, data.item || []);
        await sendRealtimePushes(savedFeed, newItems);
        await updateFeedFetchState(feed.id, {
            lastFetchedAt: startedAt,
            nextFetchAt: savedFeed.nextFetchAt,
            lastError: '',
            releaseLock: true,
        });
        await recordFetchRun(feed.id, 'success', itemCount, '', startedAt);
        return {
            feed: savedFeed,
            itemCount,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to fetch this feed.';
        const nextFetchAt = getNextFetchAt(feed);
        const savedFeed = await updateFeedFetchState(feed.id, {
            nextFetchAt,
            lastError: message,
            releaseLock: true,
        });
        await recordFetchRun(feed.id, 'error', 0, message, startedAt);
        throw Object.assign(new Error(message), { feed: savedFeed });
    }
}

async function sendDueAiSummaryPush(push: ReaderAiSummaryPush) {
    const nextSendAt = getNextPushSendAt(push);
    try {
        await sendAiSummaryPush(push);
        await completeAiSummaryPush(push.id, nextSendAt);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to send AI summary push.';
        await failAiSummaryPush(push.id, message, nextSendAt);
        logger.warn(`Reader AI summary push failed for ${push.title || push.id}: ${message}`);
    }
}

async function tick() {
    if (schedulerRunning || !hasReaderDatabase()) {
        return;
    }
    schedulerRunning = true;
    try {
        await ensureSchema();
        const [feeds, pushes] = await Promise.all([claimDueFeeds(config.reader.schedulerBatchSize, getLockSeconds()), claimDueAiSummaryPushes(config.reader.schedulerBatchSize, getLockSeconds())]);
        await Promise.all([
            ...feeds.map(async (feed) => {
                try {
                    await refreshFeed(feed);
                } catch (error) {
                    logger.warn(`Reader feed refresh failed for ${feed.url}: ${error instanceof Error ? error.message : error}`);
                }
            }),
            ...pushes.map((push) => sendDueAiSummaryPush(push)),
        ]);
    } catch (error) {
        logger.warn(`Reader scheduler tick failed: ${error instanceof Error ? error.message : error}`);
    } finally {
        schedulerRunning = false;
    }
}

export function startReaderScheduler() {
    if (schedulerStarted || !hasReaderDatabase() || process.env.NODE_ENV === 'test') {
        return;
    }
    schedulerStarted = true;
    const intervalMs = Math.max(config.reader.schedulerInterval, 1) * 1000;
    setInterval(() => {
        void tick();
    }, intervalMs).unref?.();
    void tick();
}
