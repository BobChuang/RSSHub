import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    query: vi.fn(),
}));

vi.mock('pg', () => ({
    Pool: class {
        connect = mocks.connect;
        query = mocks.query;
    },
}));

vi.stubEnv('READER_DATABASE_URL', 'postgres://reader:test@localhost/reader');

const { claimDueAiSummaryPushes, completeAiSummaryPush, createOrUpdateReaderEvent, failAiSummaryPush, renewAiSummaryPushLock, updateAiSummaryPush } = await import('./store');

function createRow(sendLockToken = '') {
    return {
        cadence: 'daily',
        config_revision: 0,
        enabled: true,
        feed_ids: ['feed-a'],
        id: 'push-1',
        mode: 'summary',
        send_lock_token: sendLockToken,
        send_time: '09:00',
        weekday: 1,
    };
}

beforeEach(() => {
    mocks.connect.mockReset();
    mocks.query.mockReset();
});

afterAll(() => {
    vi.unstubAllEnvs();
});

describe('reader AI summary push send locks', () => {
    it('assigns a random fencing token while claiming due pushes', async () => {
        mocks.query.mockImplementation((_sql: string, values: unknown[]) =>
            Promise.resolve({
                rows: [createRow(String(values[2]))],
            })
        );

        const [push] = await claimDueAiSummaryPushes(4, 300);
        const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];

        expect(values).toEqual([4, 300, expect.stringMatching(/^[\da-f-]{36}$/)]);
        expect(push.sendLockToken).toBe(values[2]);
        expect(sql).toContain('send_lock_token = $3');
    });

    it('renews and settles a send only with the matching fencing token', async () => {
        mocks.query.mockResolvedValue({ rows: [createRow('lease-token')] });

        await expect(renewAiSummaryPushLock('push-1', 'lease-token', 450)).resolves.toMatchObject({ sendLockToken: 'lease-token' });
        await expect(completeAiSummaryPush('push-1', 'lease-token', '2026-07-15T01:00:00.000Z')).resolves.toMatchObject({ id: 'push-1' });
        await expect(failAiSummaryPush('push-1', 'lease-token', 'Webhook failed.', '2026-07-15T01:00:00.000Z')).resolves.toMatchObject({ id: 'push-1' });

        const [renewSql, renewValues] = mocks.query.mock.calls[0] as [string, unknown[]];
        const [completeSql, completeValues] = mocks.query.mock.calls[1] as [string, unknown[]];
        const [failSql, failValues] = mocks.query.mock.calls[2] as [string, unknown[]];
        expect(renewSql).toContain('AND send_lock_token = $2');
        expect(renewValues).toEqual(['push-1', 'lease-token', 450]);
        expect(completeSql).toContain('AND send_lock_token = $3');
        expect(completeSql).toContain("send_lock_token = ''");
        expect(completeValues).toEqual(['push-1', '2026-07-15T01:00:00.000Z', 'lease-token']);
        expect(failSql).toContain('AND send_lock_token = $4');
        expect(failSql).toContain("send_lock_token = ''");
        expect(failValues).toEqual(['push-1', '2026-07-15T01:00:00.000Z', 'Webhook failed.', 'lease-token']);
    });

    it('does not allow an empty token to renew or settle a send', async () => {
        await expect(renewAiSummaryPushLock('push-1', '')).resolves.toBeNull();
        await expect(completeAiSummaryPush('push-1', '', '2026-07-15T01:00:00.000Z')).resolves.toBeNull();
        await expect(failAiSummaryPush('push-1', '', 'Failed.', '2026-07-15T01:00:00.000Z')).resolves.toBeNull();
        expect(mocks.query).not.toHaveBeenCalled();
    });

    it('invalidates an expired send token when a configuration update succeeds', async () => {
        mocks.query.mockResolvedValue({ rows: [] });

        await updateAiSummaryPush(
            'push-1',
            {
                cadence: 'daily',
                enabled: false,
                feedIds: ['feed-a'],
                mode: 'summary',
                sendTime: '09:00',
                timezone: 'UTC',
                weekday: 1,
            },
            2
        );

        const [sql] = mocks.query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('send_locked_until = NULL');
        expect(sql).toContain("send_lock_token = ''");
        expect(sql).toContain('AND (send_locked_until IS NULL OR send_locked_until <= NOW())');
    });
});

describe('reader event deduplication', () => {
    it('aggregates the same event key inside the configured window', async () => {
        const currentEvent = {
            confidence: 0.8,
            event_key: 'wallet-sync-failed',
            event_type: 'productBug',
            feed_id: 'feed-a',
            id: 'event-1',
            item_id: 'item-1',
            occurrence_count: 2,
            push_id: 'push-1',
            severity: 'medium',
            status: 'open',
            summary: 'Wallet sync is failing.',
            title: 'Wallet sync failed',
        };
        const clientQuery = vi
            .fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'push-1' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [currentEvent] })
            .mockResolvedValueOnce({ rows: [{ ...currentEvent, confidence: 0.95, occurrence_count: 3, severity: 'high' }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });
        const release = vi.fn();
        mocks.connect.mockResolvedValue({ query: clientQuery, release });

        const result = await createOrUpdateReaderEvent({ dedupeMinutes: 10, id: 'push-1' }, 'feed-a', 'item-2', {
            confidence: 0.95,
            eventKey: 'wallet-sync-failed',
            eventType: 'productBug',
            severity: 'high',
            summary: 'Wallet sync still fails after the update.',
            title: 'Wallet sync failed after update',
        });

        expect(result).toMatchObject({ event: { confidence: 0.95, id: 'event-1', occurrenceCount: 3, severity: 'high' }, isNew: false });
        expect(clientQuery.mock.calls[3][1]).toEqual(['push-1', 'wallet-sync-failed', 10]);
        expect(clientQuery.mock.calls[5][1]).toEqual(['event-1', 'push-1', 'feed-a', 'item-2']);
        expect(release).toHaveBeenCalledOnce();
    });
});
