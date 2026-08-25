import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAiSummaryBatch: vi.fn(),
    getFeedsAiSummaryPrompt: vi.fn(),
    getMultiAiSummaryPrompt: vi.fn(),
    getPoolQuery: vi.fn(),
    rowToItem: vi.fn(),
    updateFeedsAiSummaryPrompt: vi.fn(),
    updateMultiAiSummaryPrompt: vi.fn(),
    upsertAiSummaryBatch: vi.fn(),
}));

const originalReaderAiApiKey = process.env.READER_AI_API_KEY;
const originalReaderAiModel = process.env.READER_AI_MODEL;
const originalReaderAiRequestUrl = process.env.READER_AI_REQUEST_URL;
const originalReaderAiRetries = process.env.READER_AI_RETRIES;

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
            text: () =>
                Promise.resolve(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: summary,
                                },
                            },
                        ],
                    })
                ),
        } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

vi.mock('./store', () => ({
    getAiSummaryBatch: mocks.getAiSummaryBatch,
    getFeedsAiSummaryPrompt: mocks.getFeedsAiSummaryPrompt,
    getMultiAiSummaryPrompt: mocks.getMultiAiSummaryPrompt,
    getPool: () => ({
        query: mocks.getPoolQuery,
    }),
    rowToItem: mocks.rowToItem,
    updateFeedsAiSummaryPrompt: mocks.updateFeedsAiSummaryPrompt,
    updateMultiAiSummaryPrompt: mocks.updateMultiAiSummaryPrompt,
    upsertAiSummaryBatch: mocks.upsertAiSummaryBatch,
}));

const { buildAiSummaryResponse, clearAiSummaryCache, defaultMultiAiSummaryPrompt } = await import('./ai-summary');

describe('reader ai summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAiSummaryBatch.mockReset();
        mocks.upsertAiSummaryBatch.mockReset();
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
        restoreEnv('READER_AI_RETRIES', originalReaderAiRetries);
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

    it('summarizes every oversized item in controlled batches', async () => {
        const fetchMock = mockAiFetch((prompt) => (prompt.includes('最终汇总阶段') ? 'final summary\n链接：https://example.com/items/401' : 'batch summary'));
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(401),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 7);
        const batchPrompts = fetchMock.mock.calls.slice(0, 3).map((call) => JSON.parse(String(call[1].body)).messages[1].content);

        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(result.itemCount).toBe(401);
        expect(result.summarizedItemCount).toBe(401);
        expect(result.summary).toContain('链接：https://example.com/items/401');
        expect(batchPrompts.join('\n')).toContain('Title 1');
        expect(batchPrompts.join('\n')).toContain('Title 401');
        expect(result.prompt).toContain('第 1/3 批中间总结');
        expect(result.prompt).not.toContain('代表性内容');
    });

    it('reuses a completed 200-item block when the feed grows', async () => {
        const persistedBatches = new Map();
        mocks.getAiSummaryBatch.mockImplementation((cacheKey) => Promise.resolve(persistedBatches.get(cacheKey)));
        mocks.upsertAiSummaryBatch.mockImplementation((cacheKey, batch) => {
            persistedBatches.set(cacheKey, batch);
            return Promise.resolve();
        });
        const fetchMock = mockAiFetch();
        const initialItems = mockItems(200);
        const expandedItems = [...mockItems(10, 200), ...initialItems];
        mocks.getPoolQuery.mockResolvedValueOnce({ rows: initialItems }).mockResolvedValueOnce({ rows: expandedItems });

        await buildAiSummaryResponse(['feed-a'], 7);
        const callsAfterInitialSummary = fetchMock.mock.calls.length;
        clearAiSummaryCache();
        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(callsAfterInitialSummary).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(callsAfterInitialSummary + 2);
        expect(result.itemCount).toBe(210);
        expect(mocks.upsertAiSummaryBatch).toHaveBeenCalledTimes(1);
    });

    it('rebuilds an open block as it grows and pins it once it reaches 200 items', async () => {
        const persistedBatches = new Map();
        mocks.getAiSummaryBatch.mockImplementation((cacheKey) => Promise.resolve(persistedBatches.get(cacheKey)));
        mocks.upsertAiSummaryBatch.mockImplementation((cacheKey, batch) => {
            persistedBatches.set(cacheKey, batch);
            return Promise.resolve();
        });
        const fetchMock = mockAiFetch();
        const items150 = mockItems(150);
        const items160 = [...mockItems(10, 150), ...items150];
        const items200 = [...mockItems(40, 160), ...items160];
        mocks.getPoolQuery.mockResolvedValueOnce({ rows: items150 }).mockResolvedValueOnce({ rows: items160 }).mockResolvedValueOnce({ rows: items200 }).mockResolvedValueOnce({ rows: items200 });

        await buildAiSummaryResponse(['feed-a'], 7);
        clearAiSummaryCache();
        await buildAiSummaryResponse(['feed-a'], 7);
        clearAiSummaryCache();
        await buildAiSummaryResponse(['feed-a'], 7);
        clearAiSummaryCache();
        await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(mocks.upsertAiSummaryBatch).toHaveBeenCalledTimes(1);
    });

    it('reports batch progress before the final aggregation', async () => {
        mockAiFetch((prompt) => (prompt.includes('最终汇总阶段') ? 'final summary' : 'batch summary'));
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(401),
        });
        const progress = [];

        await buildAiSummaryResponse(['feed-a'], 7, undefined, false, {
            onProgress: (update) => {
                progress.push(update);
            },
        });

        expect(progress).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'collecting', itemCount: 401, totalBatches: 3 }), expect.objectContaining({ stage: 'finalizing', completedBatches: 3, totalBatches: 3 })]));
        expect(progress.filter((update) => update.stage === 'batch' && update.completedBatches === 3)).toHaveLength(1);
    });

    it('reuses completed batches when final aggregation needs another attempt', async () => {
        process.env.READER_AI_API_KEY = 'test-key';
        process.env.READER_AI_MODEL = 'test-model';
        process.env.READER_AI_REQUEST_URL = 'https://ai.example.test/chat/completions';
        process.env.READER_AI_RETRIES = '0';
        let finalAttempt = 0;
        const fetchMock = vi.fn((_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            const prompt = body.messages.find((message) => message.role === 'user')?.content || '';
            if (prompt.includes('最终汇总阶段')) {
                finalAttempt++;
                if (finalAttempt === 1) {
                    return Promise.resolve({
                        ok: false,
                        status: 503,
                        text: () => Promise.resolve(JSON.stringify({ error: { message: 'temporary final failure' } })),
                    } as Response);
                }
                return Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'final summary' } }] })),
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'batch summary' } }] })),
            } as Response);
        });
        vi.stubGlobal('fetch', fetchMock);
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(401),
        });

        await expect(buildAiSummaryResponse(['feed-a'], 7)).rejects.toThrow('temporary final failure');
        const callsAfterFailure = fetchMock.mock.calls.length;
        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(callsAfterFailure + 1);
        expect(result.summary).toBe('final summary');
    });

    it('reuses a recent summary for the same input', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValueOnce({
            rows: mockItems(100),
        });
        mocks.getPoolQuery.mockResolvedValueOnce({
            rows: mockItems(101),
        });

        const firstResult = await buildAiSummaryResponse(['feed-a'], 7);
        const secondResult = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(mocks.getPoolQuery).toHaveBeenCalledTimes(1);
        expect(secondResult.summary).toBe(firstResult.summary);
        expect(secondResult.prompt).toBe(firstResult.prompt);
        expect(secondResult.cacheSource).toBe('cache');
    });

    it('bypasses the cache for a forced refresh', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(100),
        });

        await buildAiSummaryResponse(['feed-a'], 7);
        const result = await buildAiSummaryResponse(['feed-a'], 7, undefined, false, { forceRefresh: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.cacheSource).toBe('fresh');
    });

    it('includes all items from multiple feeds in controlled batches', async () => {
        const fetchMock = mockAiFetch((prompt) => (prompt.includes('最终汇总阶段') ? 'final summary' : prompt));
        mocks.getPoolQuery.mockResolvedValue({
            rows: [...mockItems(400, 'feed-a', 0, 'Feed A'), ...mockItems(400, 'feed-b', 400, 'Feed B')],
        });

        const result = await buildAiSummaryResponse(['feed-a', 'feed-b'], 7);
        const batchPrompts = fetchMock.mock.calls.slice(0, 4).map((call) => JSON.parse(String(call[1].body)).messages[1].content);

        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(result.itemCount).toBe(800);
        expect(result.summarizedItemCount).toBe(800);
        expect(batchPrompts.join('\n')).toContain('Source: Feed A');
        expect(batchPrompts.join('\n')).toContain('Source: Feed B');
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
