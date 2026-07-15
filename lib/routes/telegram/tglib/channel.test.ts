import { Api } from 'telegram';
import { describe, expect, it } from 'vitest';

import { getTelegramSenderRole } from './channel';

describe('Telegram sender roles', () => {
    it('recognizes only Telegram users explicitly marked as bots', () => {
        const bot = Object.assign(Object.create(Api.User.prototype), { bot: true });
        const user = Object.assign(Object.create(Api.User.prototype), { bot: false });

        expect(getTelegramSenderRole(bot)).toBe('bot');
        expect(getTelegramSenderRole(user)).toBe('user');
        expect(getTelegramSenderRole({ bot: true })).toBe('user');
    });
});
