import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderAiSummaryPush, ReaderEvent, ReaderFeed, ReaderItem } from './store';

const mocks = vi.hoisted(() => ({
    createOrUpdateReaderEvent: vi.fn(),
    markReaderEventNotified: vi.fn(),
    postPushWebhook: vi.fn(),
}));

vi.mock('./ai-summary', () => ({
    postPushWebhook: mocks.postPushWebhook,
}));

vi.mock('./store', () => ({
    createOrUpdateReaderEvent: mocks.createOrUpdateReaderEvent,
    markReaderEventNotified: mocks.markReaderEventNotified,
    normalizeReaderEventSeverity: (value: unknown) => (value === 'high' || value === 'low' ? value : 'medium'),
}));

const originalReaderAiApiKey = process.env.READER_AI_API_KEY;
const originalReaderAiModel = process.env.READER_AI_MODEL;
const originalReaderAiRequestUrl = process.env.READER_AI_REQUEST_URL;

const { processEventMonitorItems } = await import('./event-detection');

function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

function createPush(overrides: Partial<ReaderAiSummaryPush> = {}): ReaderAiSummaryPush {
    return {
        cadence: 'daily',
        configRevision: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        days: 1,
        dedupeMinutes: 10,
        enabled: true,
        feedIds: ['feed-a'],
        feedSetKey: 'feed-set-key',
        id: 'push-1',
        lastError: '',
        lastItemPubDateMs: 0,
        lastSentAt: '',
        lastSentForDate: '',
        minimumSeverity: 'medium',
        mode: 'event',
        nextSendAt: '',
        prompt: 'Monitor wallet errors.',
        sendLockedUntil: '',
        sendLockToken: '',
        sendTime: '09:00',
        timezone: 'UTC',
        title: 'Product monitoring',
        updatedAt: '2026-07-14T00:00:00.000Z',
        webhookUrl: 'https://example.com/webhook',
        weekday: 1,
        ...overrides,
    };
}

function createFeed(): ReaderFeed {
    return {
        aiSummaryPrompt: '',
        category: 'social',
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
        title: 'Social feed',
        updatedAt: '2026-07-14T00:00:00.000Z',
        url: '/example/feed',
    };
}

function createItem(): ReaderItem {
    return {
        author: 'Alice',
        categories: [],
        category: 'social',
        description: 'Wallet balance is wrong after the update.',
        feedId: 'feed-a',
        id: 'item-1',
        isRead: false,
        isStarred: false,
        link: 'https://example.com/item-1',
        pubDate: '2026-07-14T00:00:00.000Z',
        pubDateMs: 1,
        searchText: '',
        summary: 'Wallet balance is wrong after the update.',
        title: 'Wallet balance is wrong',
    };
}

function createEvent(overrides: Partial<ReaderEvent> = {}): ReaderEvent {
    return {
        confidence: 0.94,
        eventKey: 'wallet-balance-mismatch',
        eventType: 'dataMismatch',
        feedId: 'feed-a',
        firstSeenAt: '2026-07-14T00:00:00.000Z',
        id: 'event-1',
        itemAuthor: 'Alice',
        itemDescription: '',
        itemId: 'item-1',
        itemLink: 'https://example.com/item-1',
        itemPubDate: '2026-07-14T00:00:00.000Z',
        itemSummary: 'Wallet balance is wrong after the update.',
        itemTitle: 'Wallet balance is wrong',
        lastSeenAt: '2026-07-14T00:00:00.000Z',
        notifiedAt: '',
        occurrenceCount: 1,
        platform: 'browserExtension',
        pushId: 'push-1',
        severity: 'high',
        sourceGroup: '',
        sourceTitle: 'Social feed',
        status: 'open',
        summary: 'The extension shows an incorrect wallet balance.',
        title: 'Wallet balance mismatch',
        version: '',
        ...overrides,
    };
}

function mockAiResult(results: unknown[]) {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve({
            json: () =>
                Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({ results }),
                            },
                        },
                    ],
                }),
            ok: true,
        } as Response)
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.READER_AI_API_KEY = 'test-key';
    process.env.READER_AI_MODEL = 'test-model';
    process.env.READER_AI_REQUEST_URL = 'https://ai.example.test/chat/completions';
    mocks.markReaderEventNotified.mockResolvedValue(createEvent({ notifiedAt: '2026-07-14T00:01:00.000Z' }));
    mocks.postPushWebhook.mockResolvedValue(undefined);
});

afterEach(() => {
    restoreEnv('READER_AI_API_KEY', originalReaderAiApiKey);
    restoreEnv('READER_AI_MODEL', originalReaderAiModel);
    restoreEnv('READER_AI_REQUEST_URL', originalReaderAiRequestUrl);
    vi.unstubAllGlobals();
});

describe('reader event detection', () => {
    it('stores and pushes a high-confidence event', async () => {
        const push = createPush();
        const feed = createFeed();
        const item = createItem();
        const event = createEvent();
        const fetchMock = mockAiResult([
            {
                confidence: 0.94,
                eventKey: 'wallet-balance-mismatch',
                eventType: 'dataMismatch',
                isEvent: true,
                itemId: item.id,
                platform: 'browserExtension',
                severity: 'high',
                summary: event.summary,
                title: event.title,
            },
        ]);
        mocks.createOrUpdateReaderEvent.mockResolvedValue({ event, isNew: true });

        const result = await processEventMonitorItems(push, feed, [item]);

        expect(result).toEqual({ detectedCount: 1, sentCount: 1 });
        expect(mocks.createOrUpdateReaderEvent).toHaveBeenCalledWith(push, feed.id, item.id, expect.objectContaining({ eventKey: event.eventKey, severity: 'high' }));
        expect(mocks.postPushWebhook).toHaveBeenCalledWith(push, expect.objectContaining({ title: '🚨 HIGH · Wallet balance mismatch' }));
        expect(mocks.markReaderEventNotified).toHaveBeenCalledWith(event.id);
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[1].content).toContain(item.id);
    });

    it('stores a detected event below the configured severity without pushing it', async () => {
        const push = createPush({ minimumSeverity: 'high' });
        const feed = createFeed();
        const item = createItem();
        const event = createEvent({ severity: 'medium' });
        mockAiResult([
            {
                confidence: 0.95,
                eventKey: event.eventKey,
                eventType: event.eventType,
                isEvent: true,
                itemId: item.id,
                severity: 'medium',
                summary: event.summary,
                title: event.title,
            },
        ]);
        mocks.createOrUpdateReaderEvent.mockResolvedValue({ event, isNew: true });

        const result = await processEventMonitorItems(push, feed, [item]);

        expect(result).toEqual({ detectedCount: 1, sentCount: 0 });
        expect(mocks.createOrUpdateReaderEvent).toHaveBeenCalledOnce();
        expect(mocks.postPushWebhook).not.toHaveBeenCalled();
    });

    it('ignores content that the model does not classify as an event', async () => {
        const push = createPush();
        const feed = createFeed();
        const item = createItem();
        mockAiResult([{ isEvent: false, itemId: item.id }]);

        const result = await processEventMonitorItems(push, feed, [item]);

        expect(result).toEqual({ detectedCount: 0, sentCount: 0 });
        expect(mocks.createOrUpdateReaderEvent).not.toHaveBeenCalled();
        expect(mocks.postPushWebhook).not.toHaveBeenCalled();
    });

    it.each(['discord-role:bot', 'telegram-role:bot'])('filters messages with the explicit %s sender marker before AI detection', async (senderCategory) => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const item = createItem();
        item.categories = [senderCategory];

        const result = await processEventMonitorItems(createPush(), createFeed(), [item]);

        expect(result).toEqual({ detectedCount: 0, sentCount: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.createOrUpdateReaderEvent).not.toHaveBeenCalled();
        expect(mocks.postPushWebhook).not.toHaveBeenCalled();
    });
});
