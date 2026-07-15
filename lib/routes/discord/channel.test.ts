import { describe, expect, it } from 'vitest';

import { getMessageRole } from './channel';

describe('Discord message roles', () => {
    it('recognizes bot users and webhook senders', () => {
        expect(getMessageRole({ author: { bot: true, id: 'bot-user' } }, new Set(), new Map())).toBe('bot');
        expect(getMessageRole({ author: { bot: false, id: 'webhook-user' }, webhook_id: 'webhook-1' }, new Set(), new Map())).toBe('bot');
    });

    it('keeps non-bot administrator detection', () => {
        expect(getMessageRole({ author: { bot: false, id: 'admin-user' } }, new Set(['admin-role']), new Map([['admin-user', ['admin-role']]]))).toBe('admin');
    });
});
