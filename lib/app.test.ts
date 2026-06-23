import undici from 'undici';
import { describe, expect, it, vi } from 'vitest';

import app from '@/app';

describe('index', () => {
    it('serve index', async () => {
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('Welcome to RSSHub!');
    });

    it('serve reader', async () => {
        const res = await app.request('/reader');
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('RSSHub Reader');
    });

    it('serve reader assets', async () => {
        const res = await app.request('/reader/app.js');
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('rsshub-reader-state-v1');
    });
});

describe('request-rewriter', () => {
    it('should rewrite request', async () => {
        const fetchSpy = vi.spyOn(undici, 'fetch');
        await app.request('/test/httperror');

        // headers
        const headers: Headers = fetchSpy.mock.lastCall?.[0].headers;
        expect(headers.get('user-agent')).toMatch(/Chrome/);
    });
});
