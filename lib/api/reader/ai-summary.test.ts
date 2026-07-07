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

function mockItems(length: number) {
    return Array.from({ length }, (_, index) => ({
        description: `Description ${index + 1}`,
        id: `item-${index + 1}`,
        title: `Title ${index + 1}`,
    }));
}

function mockAiFetch() {
    process.env.READER_AI_API_KEY = 'test-key';
    process.env.READER_AI_MODEL = 'test-model';
    process.env.READER_AI_REQUEST_URL = 'https://ai.example.test/chat/completions';
    const fetchMock = vi.fn((_url, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const prompt = body.messages.find((message) => message.role === 'user')?.content || '';
        const summary = prompt.includes('第 1/2 批') ? 'batch 1 summary' : prompt.includes('第 2/2 批') ? 'batch 2 summary' : 'final summary';

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

const { buildAiSummaryResponse, defaultMultiAiSummaryPrompt } = await import('./ai-summary');

describe('reader ai summary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getFeedsAiSummaryPrompt.mockResolvedValue('saved single-feed prompt');
        mocks.getMultiAiSummaryPrompt.mockResolvedValue('saved multi-feed prompt');
        mocks.getPoolQuery.mockResolvedValue({ rows: [] });
        mocks.rowToItem.mockImplementation((row) => row);
    });

    afterEach(() => {
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
        expect(result.prompt).not.toContain('最多展示 80 条');
    });

    it('requests one summary when fetched item count is at the batch limit', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(1000),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result.itemCount).toBe(1000);
        expect(result.summary).toBe('final summary');
        expect(result.prompt).toContain('1000. Title 1000');
    });

    it('summarizes in batches when fetched item count exceeds the batch limit', async () => {
        const fetchMock = mockAiFetch();
        mocks.getPoolQuery.mockResolvedValue({
            rows: mockItems(1001),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 7);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.itemCount).toBe(1001);
        expect(result.summary).toBe('final summary');
        expect(result.prompt).toContain('batch 1 summary');
        expect(result.prompt).toContain('batch 2 summary');
    });
});
