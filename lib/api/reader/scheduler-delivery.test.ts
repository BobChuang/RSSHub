import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderAiSummaryPush, ReaderFeed, ReaderItem } from './store';

const mocks = vi.hoisted(() => ({
    completeAiSummaryPush: vi.fn(),
    failAiSummaryPush: vi.fn(),
    getFollowingAiSummaryPushAt: vi.fn(),
    getNextAiSummaryPushAt: vi.fn(),
    listRealtimeAiSummaryPushesForFeed: vi.fn(),
    recordRealtimeAiSummaryPushFailure: vi.fn(),
    recordRealtimeAiSummaryPushSuccess: vi.fn(),
    renewAiSummaryPushLock: vi.fn(),
    sendAiSummaryPush: vi.fn(),
    sendRealtimeItemsPush: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('@/config', () => ({
    config: {
        connect: { port: 1200 },
        reader: {
            routeBaseUrl: '',
            schedulerBatchSize: 5,
            schedulerInterval: 10,
        },
        requestTimeout: 1000,
    },
}));

vi.mock('@/utils/logger', () => ({
    default: {
        warn: mocks.warn,
    },
}));

vi.mock('./ai-summary', () => ({
    sendAiSummaryPush: mocks.sendAiSummaryPush,
    sendRealtimeItemsPush: mocks.sendRealtimeItemsPush,
}));

vi.mock('./store', () => ({
    claimDueAiSummaryPushes: vi.fn(),
    claimDueFeeds: vi.fn(),
    completeAiSummaryPush: mocks.completeAiSummaryPush,
    ensureSchema: vi.fn(),
    failAiSummaryPush: mocks.failAiSummaryPush,
    getFeed: vi.fn(),
    getFollowingAiSummaryPushAt: mocks.getFollowingAiSummaryPushAt,
    getNextAiSummaryPushAt: mocks.getNextAiSummaryPushAt,
    hasReaderDatabase: vi.fn(() => false),
    listRealtimeAiSummaryPushesForFeed: mocks.listRealtimeAiSummaryPushesForFeed,
    persistDataItemsWithNewItems: vi.fn(),
    recordFetchRun: vi.fn(),
    recordRealtimeAiSummaryPushFailure: mocks.recordRealtimeAiSummaryPushFailure,
    recordRealtimeAiSummaryPushSuccess: mocks.recordRealtimeAiSummaryPushSuccess,
    renewAiSummaryPushLock: mocks.renewAiSummaryPushLock,
    updateFeedFetchState: vi.fn(),
    upsertFeed: vi.fn(),
}));

const { sendDueAiSummaryPush, sendRealtimePushes } = await import('./scheduler');

function createPush(overrides: Partial<ReaderAiSummaryPush> = {}): ReaderAiSummaryPush {
    return {
        cadence: 'daily',
        configRevision: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        days: 1,
        enabled: true,
        feedIds: ['feed-a'],
        feedSetKey: 'feed-set-key',
        id: 'push-1',
        lastError: '',
        lastItemPubDateMs: 0,
        lastSentAt: '',
        lastSentForDate: '',
        mode: 'summary',
        nextSendAt: '2026-07-14T00:00:00.000Z',
        prompt: '',
        sendLockedUntil: '2026-07-14T01:05:00.000Z',
        sendLockToken: 'lease-token',
        sendTime: '09:00',
        timezone: 'UTC',
        title: 'Daily summary',
        updatedAt: '2026-07-14T00:00:00.000Z',
        webhookUrl: 'https://example.com/webhook',
        weekday: 1,
        ...overrides,
    };
}

function createFeed(): ReaderFeed {
    return {
        aiSummaryPrompt: '',
        category: 'articles',
        createdAt: '2026-07-14T00:00:00.000Z',
        group: '',
        homeUrl: 'https://example.com',
        id: 'feed-a',
        lastError: '',
        lastFetchedAt: '',
        nextFetchAt: '',
        paused: false,
        refreshSeconds: 300,
        serverSyncEnabled: true,
        syncLockedUntil: '',
        title: 'Example feed',
        updatedAt: '2026-07-14T00:00:00.000Z',
        url: '/example/feed',
    };
}

function createItem(id: string, pubDateMs: number): ReaderItem {
    return {
        author: '',
        categories: [],
        category: 'articles',
        description: '',
        feedId: 'feed-a',
        id,
        isRead: false,
        isStarred: false,
        link: `https://example.com/${id}`,
        pubDate: '',
        pubDateMs,
        searchText: '',
        summary: '',
        title: id,
    };
}

function deferred<T>() {
    const { promise, reject, resolve } = Promise.withResolvers<T>();
    return { promise, reject, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeAiSummaryPush.mockResolvedValue(createPush());
    mocks.failAiSummaryPush.mockResolvedValue(createPush());
    mocks.getFollowingAiSummaryPushAt.mockReturnValue('2026-07-15T01:00:00.000Z');
    mocks.getNextAiSummaryPushAt.mockReturnValue('2026-07-15T01:00:00.000Z');
    mocks.recordRealtimeAiSummaryPushFailure.mockResolvedValue(undefined);
    mocks.recordRealtimeAiSummaryPushSuccess.mockResolvedValue(undefined);
    mocks.renewAiSummaryPushLock.mockResolvedValue(createPush());
    mocks.sendAiSummaryPush.mockResolvedValue(undefined);
    mocks.sendRealtimeItemsPush.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('reader push delivery', () => {
    it('sends every newly persisted realtime item regardless of its publication date', async () => {
        const feed = createFeed();
        const push = createPush({ lastItemPubDateMs: Date.now(), mode: 'realtime' });
        const newItems = [createItem('without-date', 0), createItem('late-date', 1)];
        mocks.listRealtimeAiSummaryPushesForFeed.mockResolvedValue([push]);

        await sendRealtimePushes(feed, newItems);

        expect(mocks.sendRealtimeItemsPush).toHaveBeenCalledWith(push, feed, newItems);
        expect(mocks.recordRealtimeAiSummaryPushSuccess).toHaveBeenCalledWith(push.id);
    });

    it('renews a long-running send lease without overlapping heartbeats and completes with its token', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-14T01:00:00.000Z'));
        const send = deferred<void>();
        const renewal = deferred<ReaderAiSummaryPush | null>();
        const push = createPush();
        mocks.sendAiSummaryPush.mockReturnValue(send.promise);
        mocks.renewAiSummaryPushLock.mockReturnValue(renewal.promise);

        const delivery = sendDueAiSummaryPush(push);
        await vi.advanceTimersByTimeAsync(300000);

        expect(mocks.renewAiSummaryPushLock).toHaveBeenCalledOnce();
        expect(mocks.renewAiSummaryPushLock).toHaveBeenCalledWith(push.id, push.sendLockToken, 300);

        renewal.resolve(push);
        send.resolve();
        await delivery;

        expect(mocks.completeAiSummaryPush).toHaveBeenCalledWith(push.id, push.sendLockToken, '2026-07-15T01:00:00.000Z');
        expect(mocks.failAiSummaryPush).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not interrupt delivery when a heartbeat errors and reports a lost lease on completion', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-14T01:00:00.000Z'));
        const send = deferred<void>();
        const push = createPush();
        mocks.sendAiSummaryPush.mockReturnValue(send.promise);
        mocks.renewAiSummaryPushLock.mockRejectedValueOnce(new Error('Database unavailable.'));
        mocks.completeAiSummaryPush.mockResolvedValueOnce(null);

        const delivery = sendDueAiSummaryPush(push);
        await vi.advanceTimersByTimeAsync(100000);
        send.resolve();
        await delivery;

        expect(mocks.sendAiSummaryPush).toHaveBeenCalledOnce();
        expect(mocks.completeAiSummaryPush).toHaveBeenCalledWith(push.id, push.sendLockToken, '2026-07-15T01:00:00.000Z');
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('lease renewal failed'));
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('lease was lost before completing'));
    });

    it('records a send failure only with the token that claimed the push', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-14T01:00:00.000Z'));
        const push = createPush();
        mocks.sendAiSummaryPush.mockRejectedValueOnce(new Error('Webhook failed.'));

        await sendDueAiSummaryPush(push);

        expect(mocks.failAiSummaryPush).toHaveBeenCalledWith(push.id, push.sendLockToken, 'Webhook failed.', '2026-07-15T01:00:00.000Z');
        expect(mocks.completeAiSummaryPush).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
