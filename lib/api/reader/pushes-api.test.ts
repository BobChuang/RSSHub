import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderAiSummaryPush, ReaderAiSummaryPushInput } from './store';

const mocks = vi.hoisted(() => ({
    createAiSummaryPush: vi.fn(),
    deleteAiSummaryPush: vi.fn(),
    ensureSchema: vi.fn(),
    getAiSummaryPush: vi.fn(),
    listAiSummaryPushes: vi.fn(),
    listAiSummaryPushesByFeedIds: vi.fn(),
    updateAiSummaryPush: vi.fn(),
}));

vi.mock('./scheduler', () => ({
    refreshFeed: vi.fn(),
}));

vi.mock('./store', () => ({
    createFeedId: vi.fn((url) => url),
    createAiSummaryPush: mocks.createAiSummaryPush,
    deleteAiSummaryPush: mocks.deleteAiSummaryPush,
    deleteFeed: vi.fn(),
    deleteFeedItems: vi.fn(),
    ensureSchema: mocks.ensureSchema,
    getAiSummaryPush: mocks.getAiSummaryPush,
    getDefaultAiSummaryPushTimezone: vi.fn(() => 'UTC'),
    getFeedsAiSummaryPrompt: vi.fn(),
    getMultiAiSummaryPrompt: vi.fn(),
    getNextAiSummaryPushAt: vi.fn(() => '2026-07-15T01:00:00.000Z'),
    getPool: vi.fn(() => ({ query: vi.fn() })),
    isValidAiSummaryPushTimezone: vi.fn((value) => {
        const timezone = String(value || '').trim();
        if (!timezone) {
            return true;
        }
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
            return true;
        } catch {
            return false;
        }
    }),
    listAiSummaryPushes: mocks.listAiSummaryPushes,
    listAiSummaryPushesByFeedIds: mocks.listAiSummaryPushesByFeedIds,
    listFeeds: vi.fn(),
    rowToItem: vi.fn((row) => row),
    updateAiSummaryPush: mocks.updateAiSummaryPush,
    updateFeed: vi.fn(),
    updateFeedItemsCategory: vi.fn(),
    updateFeedsAiSummaryPrompt: vi.fn(),
    updateMultiAiSummaryPrompt: vi.fn(),
    upsertFeed: vi.fn(),
    upsertItems: vi.fn(),
}));

const { default: app } = await import('../reader');

let pushSequence = 0;
let pushes: ReaderAiSummaryPush[] = [];

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
        nextSendAt: '2026-07-15T01:00:00.000Z',
        prompt: 'Summarize the feeds.',
        sendLockToken: '',
        sendLockedUntil: '',
        sendTime: '09:00',
        timezone: 'Asia/Shanghai',
        title: 'Daily summary',
        updatedAt: '2026-07-14T00:00:00.000Z',
        webhookUrl: 'https://example.com/webhook',
        weekday: 1,
        ...overrides,
    };
}

function pushFromInput(input: ReaderAiSummaryPushInput, id: string, current?: ReaderAiSummaryPush) {
    return createPush({
        ...current,
        cadence: input.cadence === 'weekly' ? 'weekly' : 'daily',
        days: input.days === 7 ? 7 : 1,
        enabled: input.enabled === true,
        feedIds: input.feedIds,
        id,
        lastItemPubDateMs: input.lastItemPubDateMs || 0,
        mode: input.mode === 'realtime' ? 'realtime' : 'summary',
        nextSendAt: input.nextSendAt || '',
        prompt: input.prompt || '',
        sendTime: input.sendTime || '09:00',
        timezone: input.timezone || 'UTC',
        title: input.title || '',
        webhookUrl: input.webhookUrl || '',
        weekday: input.weekday ?? 1,
    });
}

function sameFeedSet(left: string[], right: string[]) {
    return left.length === right.length && left.every((feedId) => right.includes(feedId));
}

function jsonRequest(path: string, method: string, body?: unknown) {
    return app.request(path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        method,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    pushSequence = 0;
    pushes = [];
    mocks.ensureSchema.mockResolvedValue(undefined);
    mocks.listAiSummaryPushes.mockImplementation(() => pushes);
    mocks.listAiSummaryPushesByFeedIds.mockImplementation((feedIds: string[]) => pushes.filter((push) => sameFeedSet(push.feedIds, feedIds)));
    mocks.getAiSummaryPush.mockImplementation((pushId: string) => pushes.find((push) => push.id === pushId) || null);
    mocks.createAiSummaryPush.mockImplementation((input: ReaderAiSummaryPushInput) => {
        const push = pushFromInput(input, `push-${++pushSequence}`);
        pushes.push(push);
        return push;
    });
    mocks.updateAiSummaryPush.mockImplementation((pushId: string, input: ReaderAiSummaryPushInput, expectedRevision: number) => {
        const index = pushes.findIndex((push) => push.id === pushId);
        if (index === -1 || pushes[index].configRevision !== expectedRevision) {
            return null;
        }
        const push = pushFromInput(input, pushId, {
            ...pushes[index],
            configRevision: expectedRevision + 1,
        });
        pushes[index] = push;
        return push;
    });
    mocks.deleteAiSummaryPush.mockImplementation((pushId: string) => {
        const index = pushes.findIndex((push) => push.id === pushId);
        if (index === -1) {
            return false;
        }
        pushes.splice(index, 1);
        return true;
    });
});

describe('reader AI summary push API', () => {
    it('lists every configured push', async () => {
        pushes = [createPush({ id: 'daily' }), createPush({ cadence: 'weekly', days: 7, id: 'weekly' })];

        const response = await jsonRequest('/ai-summary-pushes', 'GET');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ pushes });
        expect(mocks.listAiSummaryPushes).toHaveBeenCalledOnce();
    });

    it('returns every push for the exact feed set', async () => {
        pushes = [createPush({ id: 'daily', feedIds: ['feed-a', 'feed-b'] }), createPush({ cadence: 'weekly', days: 7, id: 'weekly', feedIds: ['feed-b', 'feed-a'] })];

        const response = await jsonRequest('/ai-summary-pushes/lookup', 'POST', { feedIds: ['feed-a', 'feed-b'] });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ pushes });
        expect(mocks.listAiSummaryPushesByFeedIds).toHaveBeenCalledWith(['feed-a', 'feed-b']);
    });

    it('creates independent pushes for repeated feed IDs', async () => {
        const payload = {
            cadence: 'daily',
            days: 1,
            enabled: false,
            feedIds: ['feed-a'],
            mode: 'summary',
            sendTime: '09:00',
            timezone: 'UTC',
            weekday: 1,
        };

        const firstResponse = await jsonRequest('/ai-summary-pushes', 'POST', payload);
        const secondResponse = await jsonRequest('/ai-summary-pushes', 'POST', payload);
        const first = (await firstResponse.json()) as ReaderAiSummaryPush;
        const second = (await secondResponse.json()) as ReaderAiSummaryPush;

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);
        expect(first.id).not.toBe(second.id);
        expect(pushes).toHaveLength(2);
        expect(mocks.createAiSummaryPush).toHaveBeenCalledTimes(2);
    });

    it('preserves the existing configuration when patching only enabled', async () => {
        const current = createPush({
            cadence: 'weekly',
            days: 7,
            enabled: false,
            feedIds: ['feed-a', 'feed-b'],
            id: 'weekly-push',
            nextSendAt: '',
            prompt: 'Weekly prompt',
            sendTime: '18:30',
            title: 'Weekly summary',
            webhookUrl: 'https://example.com/weekly-webhook',
            weekday: 5,
        });
        pushes = [current];

        const response = await jsonRequest('/ai-summary-pushes/weekly-push', 'PATCH', { configRevision: current.configRevision, enabled: true });
        const updated = (await response.json()) as ReaderAiSummaryPush;

        expect(response.status).toBe(200);
        expect(updated).toMatchObject({
            cadence: current.cadence,
            days: current.days,
            enabled: true,
            feedIds: current.feedIds,
            prompt: current.prompt,
            sendTime: current.sendTime,
            title: current.title,
            webhookUrl: current.webhookUrl,
            weekday: current.weekday,
        });
        expect(mocks.updateAiSummaryPush).toHaveBeenCalledWith(
            'weekly-push',
            expect.objectContaining({
                cadence: current.cadence,
                days: current.days,
                enabled: true,
                webhookUrl: current.webhookUrl,
            }),
            current.configRevision
        );
    });

    it('returns 409 when a push changes or becomes send-locked during an update', async () => {
        pushes = [createPush({ configRevision: 4, id: 'contended-push' })];
        mocks.updateAiSummaryPush.mockReturnValueOnce(null);

        const response = await jsonRequest('/ai-summary-pushes/contended-push', 'PATCH', { configRevision: 4, enabled: false });
        const result = (await response.json()) as { error: string };

        expect(response.status).toBe(409);
        expect(result.error).toContain('modified or is currently being sent');
        expect(mocks.updateAiSummaryPush).toHaveBeenCalledWith('contended-push', expect.any(Object), 4);
    });

    it('requires the client revision and preserves the schedule when its values did not change', async () => {
        const current = createPush({ configRevision: 3, id: 'scheduled-push', nextSendAt: '2026-07-20T01:00:00.000Z', timezone: '' });
        pushes = [current];

        const missingRevisionResponse = await jsonRequest('/ai-summary-pushes/scheduled-push', 'PATCH', { prompt: 'Updated prompt' });
        const updateResponse = await jsonRequest('/ai-summary-pushes/scheduled-push', 'PATCH', {
            cadence: current.cadence,
            configRevision: current.configRevision,
            days: current.days,
            enabled: current.enabled,
            feedIds: current.feedIds,
            mode: current.mode,
            prompt: 'Updated prompt',
            sendTime: current.sendTime,
            webhookUrl: current.webhookUrl,
            weekday: current.weekday,
        });

        expect(missingRevisionResponse.status).toBe(400);
        expect((await missingRevisionResponse.json()) as { error: string }).toEqual({ error: 'configRevision is required. Reload the push task and retry.' });
        expect(updateResponse.status).toBe(200);
        expect(mocks.updateAiSummaryPush).toHaveBeenLastCalledWith('scheduled-push', expect.objectContaining({ nextSendAt: current.nextSendAt, prompt: 'Updated prompt', timezone: current.timezone }), current.configRevision);
    });

    it('does not initialize or reset realtime cursors to a future timestamp', async () => {
        const createResponse = await jsonRequest('/ai-summary-pushes', 'POST', {
            cadence: 'daily',
            enabled: true,
            feedIds: ['feed-a'],
            mode: 'realtime',
            timezone: 'UTC',
            webhookUrl: 'https://example.com/realtime-webhook',
        });
        const created = (await createResponse.json()) as ReaderAiSummaryPush;

        expect(createResponse.status).toBe(201);
        expect(created.lastItemPubDateMs).toBe(0);
        expect(mocks.createAiSummaryPush).toHaveBeenCalledWith(expect.objectContaining({ lastItemPubDateMs: 0 }));

        pushes[0] = { ...pushes[0], enabled: false, lastItemPubDateMs: 123 };
        const expectedRevision = pushes[0].configRevision;
        const updateResponse = await jsonRequest(`/ai-summary-pushes/${created.id}`, 'PATCH', { configRevision: expectedRevision, enabled: true });

        expect(updateResponse.status).toBe(200);
        expect(mocks.updateAiSummaryPush).toHaveBeenLastCalledWith(created.id, expect.objectContaining({ lastItemPubDateMs: 0 }), expectedRevision);
    });

    it('returns 404 for an unknown push and deletes an existing push', async () => {
        pushes = [createPush({ id: 'existing-push' })];

        const missingResponse = await jsonRequest('/ai-summary-pushes/missing-push', 'DELETE');
        const deletedResponse = await jsonRequest('/ai-summary-pushes/existing-push', 'DELETE');

        expect(missingResponse.status).toBe(404);
        expect(await missingResponse.json()).toEqual({ error: 'AI summary push not found.' });
        expect(deletedResponse.status).toBe(200);
        expect(await deletedResponse.json()).toEqual({ ok: true });
        expect(pushes).toHaveLength(0);
    });

    it.each([
        [
            'weekly realtime push',
            {
                cadence: 'weekly',
                enabled: false,
                feedIds: ['feed-a'],
                mode: 'realtime',
                timezone: 'UTC',
            },
            'cadence',
        ],
        [
            'invalid timezone',
            {
                cadence: 'daily',
                enabled: false,
                feedIds: ['feed-a'],
                mode: 'summary',
                timezone: 'Mars/Olympus_Mons',
            },
            'timezone',
        ],
    ])('rejects an invalid %s', async (_name, payload, errorField) => {
        const response = await jsonRequest('/ai-summary-pushes', 'POST', payload);
        const result = (await response.json()) as { error: string };

        expect(response.status).toBe(400);
        expect(result.error).toContain(errorField);
        expect(mocks.createAiSummaryPush).not.toHaveBeenCalled();
    });
});
