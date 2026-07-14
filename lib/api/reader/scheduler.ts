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
    getFollowingAiSummaryPushAt,
    getNextAiSummaryPushAt,
    hasReaderDatabase,
    listRealtimeAiSummaryPushesForFeed,
    persistDataItemsWithNewItems,
    recordFetchRun,
    recordRealtimeAiSummaryPushFailure,
    recordRealtimeAiSummaryPushSuccess,
    renewAiSummaryPushLock,
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

function getAiSummaryPushLockSeconds() {
    return Math.max(getLockSeconds(), 300);
}

export function getNextPushSendAt(push: ReaderAiSummaryPush, after: Date | string = new Date()) {
    const anchor = after instanceof Date ? after : new Date(after);
    const from = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
    const getNextAt = (scheduledAt: Date | string) => getNextAiSummaryPushAt(push.sendTime, scheduledAt, push.cadence || 'daily', push.weekday, push.timezone);
    const scheduledAt = new Date(push.nextSendAt);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() > from.getTime()) {
        return getNextAt(from);
    }

    const getFollowingAt = (periodCount: number) => getFollowingAiSummaryPushAt(push.sendTime, scheduledAt, push.cadence || 'daily', push.timezone, periodCount);
    const isDue = (nextSendAt: string) => new Date(nextSendAt).getTime() <= from.getTime();
    let lastDuePeriod = 0;
    let nextPeriod = 1;
    while (isDue(getFollowingAt(nextPeriod))) {
        lastDuePeriod = nextPeriod;
        nextPeriod *= 2;
    }
    while (nextPeriod - lastDuePeriod > 1) {
        const candidatePeriod = Math.floor((lastDuePeriod + nextPeriod) / 2);
        if (isDue(getFollowingAt(candidatePeriod))) {
            lastDuePeriod = candidatePeriod;
        } else {
            nextPeriod = candidatePeriod;
        }
    }
    return getFollowingAt(nextPeriod);
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

export async function sendRealtimePushes(feed: ReaderFeed, newItems: ReaderItem[]) {
    if (!newItems.length) {
        return;
    }
    const pushes = await listRealtimeAiSummaryPushesForFeed(feed.id);
    await Promise.all(
        pushes.map(async (push) => {
            try {
                await sendRealtimeItemsPush(push, feed, newItems);
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

function startAiSummaryPushLockHeartbeat(push: ReaderAiSummaryPush, lockSeconds: number) {
    let leaseLost = false;
    let renewalPromise: Promise<void> | null = null;
    let stopped = false;
    const runRenewal = async () => {
        try {
            const renewed = await renewAiSummaryPushLock(push.id, push.sendLockToken, lockSeconds);
            if (!renewed) {
                leaseLost = true;
                logger.warn(`Reader AI summary push lease lost while sending ${push.title || push.id}.`);
            }
        } catch (error) {
            logger.warn(`Reader AI summary push lease renewal failed for ${push.title || push.id}: ${error instanceof Error ? error.message : error}`);
        }
        renewalPromise = null;
    };
    const renew = () => {
        if (stopped || leaseLost || renewalPromise) {
            return;
        }
        renewalPromise = runRenewal();
    };
    const interval = setInterval(renew, Math.max(Math.floor((lockSeconds * 1000) / 3), 1000));
    interval.unref?.();

    return async () => {
        if (!stopped) {
            stopped = true;
            clearInterval(interval);
        }
        await renewalPromise;
        return leaseLost;
    };
}

export async function sendDueAiSummaryPush(push: ReaderAiSummaryPush) {
    if (!push.sendLockToken) {
        logger.warn(`Reader AI summary push ${push.title || push.id} was claimed without a send lock token.`);
        return;
    }
    const nextSendAt = getNextPushSendAt(push);
    const lockSeconds = getAiSummaryPushLockSeconds();
    const stopHeartbeat = startAiSummaryPushLockHeartbeat(push, lockSeconds);
    try {
        await sendAiSummaryPush(push);
        await stopHeartbeat();
        const completed = await completeAiSummaryPush(push.id, push.sendLockToken, nextSendAt);
        if (!completed) {
            logger.warn(`Reader AI summary push lease was lost before completing ${push.title || push.id}.`);
        }
    } catch (error) {
        await stopHeartbeat();
        const message = error instanceof Error ? error.message : 'Unable to send AI summary push.';
        const failed = await failAiSummaryPush(push.id, push.sendLockToken, message, nextSendAt);
        if (!failed) {
            logger.warn(`Reader AI summary push lease was lost before recording failure for ${push.title || push.id}.`);
        }
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
        const [feeds, pushes] = await Promise.all([claimDueFeeds(config.reader.schedulerBatchSize, getLockSeconds()), claimDueAiSummaryPushes(config.reader.schedulerBatchSize, getAiSummaryPushLockSeconds())]);
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
