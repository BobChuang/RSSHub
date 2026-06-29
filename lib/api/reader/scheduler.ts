import { config } from '@/config';
import logger from '@/utils/logger';

import { parseFeedText } from './feed-parser';
import type { ReaderFeed } from './store';
import { claimDueFeeds, ensureSchema, getFeed, hasReaderDatabase, persistDataItems, recordFetchRun, updateFeedFetchState, upsertFeed } from './store';

let schedulerStarted = false;
let schedulerRunning = false;

function getFetchUrl(url: string) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    const baseUrl = config.reader.routeBaseUrl || `http://127.0.0.1:${config.connect.port}`;
    return new URL(url.startsWith('/') ? url : `/${url}`, baseUrl).href;
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
        const itemCount = await persistDataItems(savedFeed, data.item || []);
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

async function tick() {
    if (schedulerRunning || !hasReaderDatabase()) {
        return;
    }
    schedulerRunning = true;
    try {
        await ensureSchema();
        const feeds = await claimDueFeeds(config.reader.schedulerBatchSize, getLockSeconds());
        await Promise.all(
            feeds.map(async (feed) => {
                try {
                    await refreshFeed(feed);
                } catch (error) {
                    logger.warn(`Reader feed refresh failed for ${feed.url}: ${error instanceof Error ? error.message : error}`);
                }
            })
        );
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
