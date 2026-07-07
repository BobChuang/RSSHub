import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFeedsAiSummaryPrompt: vi.fn(),
    getMultiAiSummaryPrompt: vi.fn(),
    getPoolQuery: vi.fn(),
    rowToItem: vi.fn(),
    updateFeedsAiSummaryPrompt: vi.fn(),
    updateMultiAiSummaryPrompt: vi.fn(),
}));

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
            rows: Array.from({ length: 100 }, (_, index) => ({
                description: `Description ${index + 1}`,
                id: `item-${index + 1}`,
                title: `Title ${index + 1}`,
            })),
        });

        const result = await buildAiSummaryResponse(['feed-a'], 1);

        expect(mocks.getPoolQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 2000'), expect.any(Array));
        expect(result.prompt).toContain('100. Title 100');
        expect(result.prompt).not.toContain('最多展示 80 条');
    });
});
