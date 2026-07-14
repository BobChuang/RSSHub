import { describe, expect, it } from 'vitest';

import { getNextPushSendAt } from './scheduler';
import type { ReaderAiSummaryPush } from './store';

function createPush(overrides: Partial<ReaderAiSummaryPush> = {}) {
    return {
        cadence: 'daily',
        sendTime: '09:00',
        timezone: 'UTC',
        weekday: 1,
        ...overrides,
    } as ReaderAiSummaryPush;
}

describe('reader push scheduling', () => {
    it('keeps the configured local time across daylight saving changes', () => {
        const push = createPush({ timezone: 'America/New_York' });

        expect(getNextPushSendAt(push, '2026-03-07T14:00:00.000Z')).toBe('2026-03-08T13:00:00.000Z');
        expect(getNextPushSendAt(push, '2026-03-08T13:00:00.000Z')).toBe('2026-03-09T13:00:00.000Z');
    });

    it('schedules weekly pushes for the selected weekday in the configured timezone', () => {
        const push = createPush({ cadence: 'weekly', nextSendAt: '2026-07-06T01:00:00.000Z', timezone: 'Asia/Shanghai', weekday: 1 });

        expect(getNextPushSendAt(push, '2026-07-12T12:00:00.000Z')).toBe('2026-07-13T01:00:00.000Z');
        expect(getNextPushSendAt(push, '2026-07-13T02:00:00.000Z')).toBe('2026-07-20T01:00:00.000Z');
    });

    it('does not schedule the repeated wall-clock time during a daylight saving fallback', () => {
        const newPush = createPush({ sendTime: '01:30', timezone: 'America/New_York' });
        const push = createPush({ nextSendAt: '2026-11-01T05:30:00.000Z', sendTime: '01:30', timezone: 'America/New_York' });

        expect(getNextPushSendAt(newPush, '2026-11-01T04:00:00.000Z')).toBe('2026-11-01T05:30:00.000Z');
        expect(getNextPushSendAt(push, '2026-11-01T06:00:00.000Z')).toBe('2026-11-02T06:30:00.000Z');
    });

    it('catches up stale legacy pushes without cadence as daily', () => {
        const push = createPush({ cadence: undefined, nextSendAt: '2020-01-01T00:00:00.000Z', timezone: 'Asia/Shanghai' });

        expect(getNextPushSendAt(push, '2026-07-14T00:30:00.000Z')).toBe('2026-07-14T01:00:00.000Z');
        expect(getNextPushSendAt(push, '2026-07-14T01:00:00.000Z')).toBe('2026-07-15T01:00:00.000Z');
    });
});
