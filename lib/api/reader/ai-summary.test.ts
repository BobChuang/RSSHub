import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFeedsAiSummaryPrompt: vi.fn(),
    getMultiAiSummaryPrompt: vi.fn(),
    getPoolQuery: vi.fn(),
    rowToItem: vi.fn(),
    updateFeedsAiSummaryPrompt: vi.fn(),
    updateMultiAiSummaryPrompt: vi.fn(),
}));

const originalReaderAiApiKey = process.env.READER_AI_API_KEY;
const originalReaderAiModel = process.env.READER_AI_MODEL;
const originalReaderAiRequestUrl = process.env.READER_AI_REQUEST_URL;

function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

function mockItems(length: number, feedId = 'feed-a', offset = 0, feedTitle = '') {
    return Array.from({ length }, (_, index) => ({
        description: `Description ${index + 1}`,
        feedId,
        feed_title: feedTitle,
        id: `item-${index + offset + 1}`,
        link: `https://example.com/items/${index + 1}`,
        pubDateMs: length - index,
        title: `Title ${index + 1}`,
    }));
}

function mockAiFetch(
    getSummary: (prompt: string) => string = (prompt: string) =>
        prompt.includes('第 1/2 批') ? 'batch 1 summary\n链接：https://example.com/items/1' : prompt.includes('第 2/2 批') ? 'batch 2 summary\n链接：https://example.com/items/1001' : 'final summary\n链接：https://example.com/items/1'
) {
    process.env.READER_AI_API_KEY = 'test-key';
    process.env.READER_AI_MODEL = 'test-model';
    process.env.READER_AI_REQUEST_URL = 'https://ai.example.test/chat/completions';
    const fetchMock = vi.fn((_url, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const prompt = body.messages.find((message) => message.role === 'user')?.content || '';
        const summary = getSummary(prompt);

        return Promise.resolve({
            json: () =>
                Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: summary,
                            },
                        },
                    ],
                }),
            ok: true,
        } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

vi.mock('./store', () => ({
    getFeedsAiSummaryPrompt: mocks.getFeedsAiSummaryPrompt,
    getMultiAiSummaryPrompt: mocks.getMultiAiSummaryPrompt,
    getPool: () => ({
        query: mocks.getPoolQuery,
    }),
    rowToItem: mocks.rowToItem,
    updateFeedsAiSummaryPrompt: mocks.updateFeedsAiSummaryPrompt,
    updateMultiAiSummaryPrompt: mocks.updateMultiAiSummaryPrompt,
}));

const { buildAiSummaryResponse, clearAiSummaryCache, defaultMultiAiSummaryPrompt } = await import('./ai-summary');

describe('reader ai summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAiSummaryCache();
        mocks.getFeedsAiSummaryPrompt.mockResolvedValue('saved single-feed prompt');
        mocks.getMultiAiSummaryPrompt.mockResolvedValue('saved multi-feed prompt');
        mocks.getPoolQuery.mockResolvedValue({ rows: [] });
        mocks.rowToItem.mockImplementation((row) => row);
    });

    afterEach(() => {
        clearAiSummaryCache();
        restoreEnv('READER_AI_API_KEY', originalReaderAiApiKey);
        restoreEnv('READER_AI_MODEL', originalReaderAiModel);
        restoreEnv('READER_AI_REQUEST_URL', originalReaderAiRequestUrl);
        vi.unstubAllGlobals();
    });

    it('uses saved prompt for a single feed', async () => {
        const result = await buildAiSummaryResponse(['feed-a'], 1);

        expect(mocks.getFeedsAiSummaryPrompt).toHaveBeenCalledWith(['feed-a']);
        expect(result.promptTemplate).toBe('saved single-feed prompt');
    });

    it('does not use a feed prompt as the default for multi-feed summaries', async () => {
        const result = await buildAiSummaryResponse(['feed-a', 'feed-b'], 1);

        expect(mocks.getFeedsAiSummaryPrompt).not.toHaveBeenCalled();
        expect(mocks.getMultiAiSummaryPrompt).toHaveBeenCalled();
        expect(result.promptTemplate).toBe('saved multi-feed prompt');
    });

    it('uses the default multi-feed prompt when no multi-feed prompt is saved', async () => {
        mocks.getMultiAiSummaryPrompt.mockResolvedValue('');

        const result = await buildAiSummaryResponse(['feed-a', 'feed-b'], 1);

        expect(result.promptTemplate).toBe(defaultMultiAiSummaryPrompt);
    });

    it('saves submitted multi-feed prompts without updating every feed', async () => {
        const result = await buildAiSummaryResponse(['feed-a', 'feed-b'], 1, 'custom multi-feed prompt', true);

        expect(result.promptTemplate).toBe('custom multi-feed prompt');
        expect(mocks.updateFeedsAiSummaryPrompt).not.toHaveBeenCalled();
        expect(mocks.updateMultiAiSummaryPrompt).toHaveBeenCalledWith('custom multi-feed prompt');
    });

    it('saves submitted prompts for a single feed', async () => {
        await buildAiSummaryResponse(['feed-a'], 1, 'custom single-feed prompt', true);

        expect(mocks.updateFeedsAiSummaryPrompt).toHaveBeenCalledWith(['feed-a'], 'custom single-feed prompt');
    });

    it('includes every fetched item in the generated prompt', async () => {
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(100),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 1);

        expect(mocks.getPoolQuery).toHaveBeenCalledWith(expect.not.stringContaining('LIMIT'), expect.any(Array));
        expect(result.prompt).toContain('100. Title 100');
        expect(result.prompt).toContain('Link: https://example.com/items/100');
        expect(result.prompt).toContain('链接行');
        expect(result.prompt).not.toContain('最多展示 80 条');
    });

    it('removes empty link lines from a single summary result', async () => {
        mockAiFetch(() => ['核心要点', '链接:', '值得阅读', '链接：https://example.com/items/1'].join('\n'));
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(1),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 1);

        expect(result.summary).toContain('链接：https://example.com/items/1');
        expect(result.summary).not.toContain('链接:\n');
    });

    it('limits oversized summaries while preserving the fetched item count', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(1000),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.itemCount).toBe(1000);
        expect(result.summarizedItemCount).toBe(500);
        expect(result.summary).toContain('链接：https://example.com/items/1');
        expect(result.prompt).not.toContain('Title 1000');
        expect(result.prompt).toContain('原始范围共有 1000 条内容');
    });

    it('reuses a recent summary for the same input', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(100),
        });

        const firstResult = await buildAiSummaryResponse(['feed-a'], 7);
        const secondResult = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(secondResult.summary).toBe(firstResult.summary);
        expect(secondResult.prompt).toBe(firstResult.prompt);
    });

    it('samples multiple feeds in a round-robin order', async () => {
        const fetchMock = mockAiFetch((prompt) => prompt);
        mocks.getPoolQuery.mockResolvedValue({
            rows: [...mockItems(400, 'feed-a', 0, 'Feed A'), ...mockItems(400, 'feed-b', 400, 'Feed B')],
        });

        const result = await buildAiSummaryResponse(['feed-a', 'feed-b'], 7);
        const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));

        expect(result.summarizedItemCount).toBe(500);
        expect(requestBody.messages[1].content).toContain('Source: Feed A');
        expect(requestBody.messages[1].content).toContain('Source: Feed B');
    });

    it('removes empty link lines from the summary result', async () => {
        mockAiFetch((prompt) => {
            if (prompt.includes('第 1/2 批')) {
                return ['batch 1 summary', '链接:', 'keep', '链接：https://example.com/items/1'].join('\n');
            }
            if (prompt.includes('第 2/2 批')) {
                return ['batch 2 summary', '链接：', 'keep', '链接：https://example.com/items/1001'].join('\n');
            }
            return ['final summary', '链接:', 'keep', '链接：https://example.com/items/1'].join('\n');
        });
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(1),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(result.summary).toContain('链接：https://example.com/items/1');
        expect(result.summary).not.toContain('链接:\n');
        expect(result.prompt).not.toContain('链接:\n');
        expect(result.prompt).not.toContain('链接：\n');
    });
});
