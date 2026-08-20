import MarkdownIt from 'markdown-it';

import logger from '@/utils/logger';

import type { ReaderAiSummaryPush, ReaderFeed, ReaderItem } from './store';
import { getFeedsAiSummaryPrompt, getMultiAiSummaryPrompt, getPool, rowToItem, updateFeedsAiSummaryPrompt, updateMultiAiSummaryPrompt } from './store';

const markdown = MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
});
const larkMarkdownChunkLength = 4000;
const summaryItemContentLimit = 240;
const summaryBatchItemLimit = 200;
const summaryBatchConcurrency = 4;
const summaryBatchMaxTokens = 900;
const summaryCacheTtlMs = 5 * 60 * 1000;
const defaultAiMaxTokens = 3000;
const defaultAiTimeoutMs = 180000;
const summaryCacheVersion = 3;
const linkPreservationInstruction = [
    '链接保留要求：',
    '1. 每条具体内容如果引用原始文章，链接行必须紧跟对应内容下方，格式为：链接：<原始URL>。',
    '2. 链接必须从输入内容的 Link 字段原样复制，不能留空、不能编造。',
    '3. 如果某条内容没有可用链接，不要输出“链接：”行。',
].join('\n');

type SummaryInputItem = ReaderItem & {
    feedGroup: string;
    feedTitle: string;
};

type AiSummaryResult = {
    configured: boolean;
    message: string;
    summary: string;
    prompt: string;
};

type AiSummaryCacheEntry = {
    createdAt: number;
    expiresAt: number;
    itemCount: number;
    result: AiSummaryResult;
    summarizedItemCount: number;
};

type AiSummaryBuildOptions = {
    forceRefresh?: boolean;
};

type AiSummaryCacheSource = 'cache' | 'fresh' | 'in-flight';

const aiSummaryCache = new Map<string, AiSummaryCacheEntry>();
const aiSummaryInFlight = new Map<string, Promise<AiSummaryCacheEntry>>();

export const defaultAiSummaryPrompt = [
    '请用中文总结这个 RSS 订阅源最近 {{days}} 天的内容。',
    '要求：',
    '1. 先给出 3-6 条核心要点。',
    '2. 再列出主要趋势或重复出现的主题。',
    '3. 最后列出最值得打开阅读的 3-5 篇，并说明理由。',
    '',
    '不总结：',
    '1. 安全提醒与垃圾/诈骗信息信息',
].join('\n');

export const defaultMultiAiSummaryPrompt = [
    '请用中文按频道汇总这些 RSS 订阅源最近 {{days}} 天的内容。',
    '要求：',
    '1. 先给出跨频道的 5-8 条核心要点，合并重复信息。',
    '2. 按频道列出各自最重要的进展、讨论或异常信号。',
    '3. 标出跨频道反复出现的趋势、共识、分歧或待跟进事项。',
    '4. 最后列出最值得打开阅读的 3-5 条内容，并说明来自哪个频道和理由。',
    '',
    '不总结：',
    '1. 安全提醒与垃圾/诈骗信息信息',
].join('\n');

export function normalizeSummaryDays(value: unknown) {
    return Number(value) === 7 ? 7 : 1;
}

export function normalizeSummaryFeedIds(value: unknown) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map((feedId) => String(feedId || '').trim()).filter(Boolean))].slice(0, 100);
}

export function normalizeSummaryPrompt(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function stripHtml(value: string) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function limitText(value: string, maxLength: number) {
    return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
}

function buildSummaryItemsText(items: SummaryInputItem[]) {
    return items
        .map((item, index) => {
            const content = limitText(stripHtml(item.summary || item.description || ''), summaryItemContentLimit);
            const source = [item.feedGroup, item.feedTitle].filter(Boolean).join(' / ');
            return [
                `${index + 1}. ${item.title}`,
                source ? `Source: ${source}` : '',
                item.author ? `Author: ${item.author}` : '',
                item.pubDate ? `Date: ${item.pubDate}` : '',
                item.link ? `Link: ${item.link}` : '',
                content ? `Content: ${content}` : '',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n\n');
}

function stripEmptyLinkLines(value: string) {
    return value
        .split('\n')
        .filter((line) => !/^\s*(?:[-*]\s*)?(?:链接|Link)\s*[:：]\s*$/.test(line))
        .join('\n')
        .trim();
}

function withCleanSummaryLinks<T extends { summary: string }>(result: T) {
    return {
        ...result,
        summary: result.summary ? stripEmptyLinkLines(result.summary) : result.summary,
    };
}

function replacePromptToken(value: string, token: string, replacement: string) {
    return value.split(token).join(replacement);
}

function renderSummaryPrompt(promptTemplate: string, items: SummaryInputItem[], days: number, totalItemCount = items.length, contentNotice = `共收集到 ${items.length} 条内容。`) {
    const itemsText = buildSummaryItemsText(items);
    const hasItemsPlaceholder = promptTemplate.includes('{{items}}');
    const promptWithDays = replacePromptToken(promptTemplate, '{{days}}', String(days));
    const promptWithItemCount = replacePromptToken(promptWithDays, '{{itemCount}}', String(totalItemCount));
    const prompt = replacePromptToken(promptWithItemCount, '{{items}}', itemsText);

    if (hasItemsPlaceholder) {
        return [contentNotice, linkPreservationInstruction, '', prompt].join('\n');
    }

    return [prompt, '', linkPreservationInstruction, '', contentNotice, itemsText].join('\n');
}

function renderSummaryMarkdown(value: string) {
    return value ? markdown.render(value) : '';
}

async function getSummaryItems(feedIds: string[], days: number) {
    if (!feedIds.length) {
        return [];
    }

    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = await getPool().query(
        `
            SELECT item.*, feed.title AS feed_title, feed.group_name AS feed_group
            FROM reader_items item
            LEFT JOIN reader_feeds feed ON feed.id = item.feed_id
            WHERE item.feed_id = ANY($1::text[])
                AND item.pub_date_ms >= $2
            ORDER BY item.pub_date_ms DESC, item.id DESC
        `,
        [feedIds, sinceMs]
    );
    return result.rows.map((row) => ({
        ...rowToItem(row),
        feedGroup: row.feed_group || '',
        feedTitle: row.feed_title || '',
    }));
}

function createSummaryCacheKey(feedIds: string[], days: number, promptTemplate: string) {
    return JSON.stringify({ days, feedIds: [...feedIds].toSorted((left, right) => left.localeCompare(right)), promptTemplate, version: summaryCacheVersion });
}

function getCachedAiSummary(cacheKey: string) {
    const cached = aiSummaryCache.get(cacheKey);
    if (!cached) {
        return;
    }
    if (cached.expiresAt <= Date.now()) {
        aiSummaryCache.delete(cacheKey);
        return;
    }
    return cached;
}

function cacheAiSummary(cacheKey: string, entry: AiSummaryCacheEntry) {
    if (entry.result.configured && entry.result.summary) {
        aiSummaryCache.set(cacheKey, entry);
    }
}

export function clearAiSummaryCache() {
    aiSummaryCache.clear();
    aiSummaryInFlight.clear();
}

function splitSummaryItems(items: SummaryInputItem[]) {
    return Array.from({ length: Math.ceil(items.length / summaryBatchItemLimit) }, (_, index) => items.slice(index * summaryBatchItemLimit, (index + 1) * summaryBatchItemLimit));
}

function renderBatchSummaryPrompt(promptTemplate: string, items: SummaryInputItem[], days: number, batchIndex: number, batchCount: number, totalItemCount: number) {
    const contentNotice = `整个范围共有 ${totalItemCount} 条内容；这是第 ${batchIndex}/${batchCount} 批，本批包含 ${items.length} 条内容，以下是本批全部内容。`;
    return [
        `这是分批总结任务的第 ${batchIndex}/${batchCount} 批。`,
        `请处理本批全部 ${items.length} 条内容，不要只挑选代表性内容；提炼本批最重要的事实、趋势、来源频道和原始链接，输出精炼的中间总结，供最终汇总使用。`,
        renderSummaryPrompt(promptTemplate, items, days, totalItemCount, contentNotice),
    ].join('\n\n');
}

function renderFinalSummaryPrompt(promptTemplate: string, batchSummaries: string[], days: number, totalItemCount: number) {
    const summariesText = batchSummaries.map((summary, index) => `第 ${index + 1}/${batchSummaries.length} 批中间总结：\n${summary}`).join('\n\n');
    const prompt = renderSummaryPrompt(promptTemplate, [], days, totalItemCount, `整个范围共有 ${totalItemCount} 条内容，已通过 ${batchSummaries.length} 个批次全部处理。`);
    return [
        '这是分批总结任务的最终汇总阶段。',
        `下面的 ${batchSummaries.length} 份中间总结覆盖了全部 ${totalItemCount} 条原始内容。请综合所有批次，合并重复信息，不要遗漏任何批次，也不要声称只总结了部分内容。`,
        '最终输出请保留最重要的事实、趋势、频道归属和值得阅读的内容；引用原始内容时，只使用中间总结中出现的真实链接。',
        prompt,
        '全部批次的中间总结：',
        summariesText,
    ].join('\n\n');
}

async function mapWithConcurrency<T, TResult>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<TResult>) {
    const results = [] as TResult[];
    results.length = items.length;
    let nextIndex = 0;
    const worker = async () => {
        const index = nextIndex++;
        if (index >= items.length) {
            return;
        }
        results[index] = await mapper(items[index], index);
        return worker();
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
}

async function requestAiSummaryForItems(promptTemplate: string, items: SummaryInputItem[], days: number, totalItemCount = items.length) {
    if (items.length <= summaryBatchItemLimit) {
        const prompt = renderSummaryPrompt(promptTemplate, items, days, totalItemCount);
        return {
            ...withCleanSummaryLinks(await requestAiSummary(prompt)),
            prompt,
        };
    }

    const batches = splitSummaryItems(items);
    logger.info(`Reader AI summary batching: itemCount=${items.length} batchCount=${batches.length} batchSize=${summaryBatchItemLimit}`);
    const batchResults = await mapWithConcurrency(batches, summaryBatchConcurrency, async (batch, index) => {
        const prompt = renderBatchSummaryPrompt(promptTemplate, batch, days, index + 1, batches.length, totalItemCount);
        const result = await requestAiSummary(prompt, summaryBatchMaxTokens);
        return {
            ...withCleanSummaryLinks(result),
            prompt,
        };
    });
    const incompleteBatch = batchResults.find((result) => !result.configured || !result.summary);
    if (incompleteBatch) {
        return {
            ...incompleteBatch,
            prompt: incompleteBatch.prompt,
        };
    }

    const finalPrompt = renderFinalSummaryPrompt(
        promptTemplate,
        batchResults.map((result) => result.summary),
        days,
        totalItemCount
    );
    return {
        ...withCleanSummaryLinks(await requestAiSummary(finalPrompt)),
        prompt: finalPrompt,
    };
}

async function generateAiSummaryCacheEntry(feedIds: string[], days: number, promptTemplate: string): Promise<AiSummaryCacheEntry> {
    const items = await getSummaryItems(feedIds, days);
    const aiResult = items.length
        ? await requestAiSummaryForItems(promptTemplate, items, days)
        : {
              configured: Boolean((process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.READER_AI_MODEL),
              message: '',
              prompt: renderSummaryPrompt(promptTemplate, items, days),
              summary: '',
          };
    const createdAt = Date.now();
    return {
        createdAt,
        expiresAt: createdAt + summaryCacheTtlMs,
        itemCount: items.length,
        result: aiResult,
        summarizedItemCount: items.length,
    };
}

function formatAiSummaryResponse(entry: AiSummaryCacheEntry, days: number, promptTemplate: string, cacheSource: AiSummaryCacheSource) {
    return {
        ...entry.result,
        cacheAgeMs: Math.max(0, Date.now() - entry.createdAt),
        cacheSource,
        days,
        itemCount: entry.itemCount,
        summarizedItemCount: entry.summarizedItemCount,
        prompt: entry.result.prompt,
        promptTemplate,
        summaryHtml: renderSummaryMarkdown(entry.result.summary),
    };
}

export async function buildAiSummaryResponse(feedIds: string[], days: number, promptValue?: unknown, savePrompt?: boolean, options: AiSummaryBuildOptions = {}) {
    const submittedPrompt = normalizeSummaryPrompt(promptValue);
    const isSingleFeed = feedIds.length === 1;
    const defaultPrompt = isSingleFeed ? defaultAiSummaryPrompt : defaultMultiAiSummaryPrompt;
    const savedPrompt = submittedPrompt ? '' : isSingleFeed ? await getFeedsAiSummaryPrompt(feedIds) : await getMultiAiSummaryPrompt();
    const promptTemplate = submittedPrompt || savedPrompt || defaultPrompt;
    if (savePrompt && submittedPrompt) {
        await (isSingleFeed ? updateFeedsAiSummaryPrompt(feedIds, promptTemplate) : updateMultiAiSummaryPrompt(promptTemplate));
    }
    const cacheKey = createSummaryCacheKey(feedIds, days, promptTemplate);
    const forceRefresh = options.forceRefresh === true;
    if (!forceRefresh) {
        const cachedAiSummary = getCachedAiSummary(cacheKey);
        if (cachedAiSummary) {
            logger.info(`Reader AI summary cache hit: feedCount=${feedIds.length} days=${days}`);
            return formatAiSummaryResponse(cachedAiSummary, days, promptTemplate, 'cache');
        }
    }

    const existingRequest = aiSummaryInFlight.get(cacheKey);
    if (existingRequest) {
        logger.info(`Reader AI summary joined in-flight request: feedCount=${feedIds.length} days=${days}`);
        return formatAiSummaryResponse(await existingRequest, days, promptTemplate, 'in-flight');
    }

    logger.info(`Reader AI summary cache miss: feedCount=${feedIds.length} days=${days} forceRefresh=${forceRefresh}`);
    const generationRequest = generateAiSummaryCacheEntry(feedIds, days, promptTemplate);
    aiSummaryInFlight.set(cacheKey, generationRequest);
    try {
        const entry = await generationRequest;
        cacheAiSummary(cacheKey, entry);
        return formatAiSummaryResponse(entry, days, promptTemplate, 'fresh');
    } finally {
        if (aiSummaryInFlight.get(cacheKey) === generationRequest) {
            aiSummaryInFlight.delete(cacheKey);
        }
    }
}

function getAiRequestUrl() {
    const configuredUrl = process.env.READER_AI_REQUEST_URL?.trim();
    const baseUrl = (process.env.READER_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const requestUrl = configuredUrl || `${baseUrl}/chat/completions`;

    if (/\/v1\/?$/.test(requestUrl)) {
        return requestUrl.replace(/\/$/, '') + '/chat/completions';
    }

    return requestUrl;
}

async function requestAiSummary(prompt: string, maxTokensOverride?: number) {
    const apiKey = process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.READER_AI_MODEL;
    const requestUrl = getAiRequestUrl();

    if (!apiKey || !model) {
        return {
            configured: false,
            message: 'AI summary is not configured. Set READER_AI_REQUEST_URL, READER_AI_API_KEY, and READER_AI_MODEL to enable automatic summaries.',
            summary: '',
        };
    }

    const configuredMaxTokens = Number(process.env.READER_AI_MAX_TOKENS);
    const configuredMaxTokensValue = Number.isSafeInteger(configuredMaxTokens) && configuredMaxTokens > 0 ? configuredMaxTokens : defaultAiMaxTokens;
    const maxTokens = maxTokensOverride ? Math.min(configuredMaxTokensValue, maxTokensOverride) : configuredMaxTokensValue;
    const configuredTimeoutMs = Number(process.env.READER_AI_TIMEOUT_MS);
    const timeoutMs = Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : defaultAiTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
        response = await fetch(requestUrl, {
            body: JSON.stringify({
                max_tokens: maxTokens,
                messages: [
                    {
                        content: 'You summarize RSS reader content clearly and concisely in Chinese.',
                        role: 'system',
                    },
                    {
                        content: prompt,
                        role: 'user',
                    },
                ],
                model,
                temperature: 0.2,
            }),
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            method: 'POST',
            signal: controller.signal,
        });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`AI summary request timed out after ${timeoutMs} ms.`, { cause: error });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || 'AI summary request failed.');
    }

    return {
        configured: true,
        message: '',
        summary: data?.choices?.[0]?.message?.content || '',
    };
}

function getWebhookKind(webhookUrl: string) {
    try {
        const url = new URL(webhookUrl);
        const host = url.hostname;
        const path = url.pathname;
        if (host.includes('discord.com') && path.includes('/api/webhooks/')) {
            return 'discord';
        }
        if (host.includes('hooks.slack.com')) {
            return 'slack';
        }
        if (host.includes('open.feishu.cn') || host.includes('larksuite.com')) {
            return 'lark';
        }
        if (host.includes('qyapi.weixin.qq.com')) {
            return 'wechat-work';
        }
        if (host.includes('oapi.dingtalk.com')) {
            return 'dingtalk';
        }
    } catch {
        // Validate webhook URLs before saving; this fallback keeps sender defensive.
    }

    return 'generic';
}

export type WebhookMessage = {
    title: string;
    meta: string;
    body: string;
    fallback: Record<string, unknown>;
};

function buildWebhookText(message: WebhookMessage) {
    return [`# ${message.title}`, message.meta, message.body].filter(Boolean).join('\n\n');
}

function stripMarkdownEmphasis(value: string) {
    return value.replaceAll('**', '').replaceAll('__', '').trim();
}

function formatLarkMarkdown(value: string) {
    return value
        .split('\n')
        .map((line) => {
            const heading = line.match(/^ {0,3}#{1,6} (.+)$/);
            if (heading) {
                return `**${stripMarkdownEmphasis(heading[1])}**`;
            }
            if (/^\s*-{3,}\s*$/.test(line)) {
                return '';
            }
            return line.replaceAll(/\*\*([^*\n]+)\*\*/g, (_, text: string) => `**${text.trimEnd()}**`);
        })
        .join('\n')
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();
}

function splitLarkMarkdown(value: string) {
    const chunks: string[] = [];
    let chunk = '';

    for (const line of value.split('\n')) {
        if (line.length > larkMarkdownChunkLength) {
            if (chunk) {
                chunks.push(chunk);
                chunk = '';
            }
            for (let index = 0; index < line.length; index += larkMarkdownChunkLength) {
                chunks.push(line.slice(index, index + larkMarkdownChunkLength));
            }
            continue;
        }

        const candidate = chunk ? `${chunk}\n${line}` : line;
        if (candidate.length > larkMarkdownChunkLength) {
            chunks.push(chunk);
            chunk = line;
            continue;
        }
        chunk = candidate;
    }

    if (chunk) {
        chunks.push(chunk);
    }
    return chunks.length ? chunks : [''];
}

function buildLarkCard(message: WebhookMessage) {
    const meta = message.meta ? `**${message.meta}**` : '';
    const content = formatLarkMarkdown([meta, message.body].filter(Boolean).join('\n\n'));

    return {
        card: {
            config: {
                wide_screen_mode: true,
            },
            elements: splitLarkMarkdown(content).map((markdown) => ({
                content: markdown,
                tag: 'markdown',
            })),
            header: {
                title: {
                    content: message.title,
                    tag: 'plain_text',
                },
            },
        },
        msg_type: 'interactive',
    };
}

function getWebhookBody(push: ReaderAiSummaryPush, message: WebhookMessage) {
    const text = buildWebhookText(message);
    const kind = getWebhookKind(push.webhookUrl);

    if (kind === 'discord') {
        return { content: text.slice(0, 2000) };
    }
    if (kind === 'slack') {
        return { text };
    }
    if (kind === 'lark') {
        return buildLarkCard(message);
    }
    if (kind === 'wechat-work') {
        return {
            msgtype: 'text',
            text: { content: text },
        };
    }
    if (kind === 'dingtalk') {
        return {
            msgtype: 'text',
            text: { content: text },
        };
    }

    return {
        ...message.fallback,
        generatedAt: new Date().toISOString(),
        text,
        title: message.title,
    };
}

export async function postPushWebhook(push: ReaderAiSummaryPush, message: WebhookMessage) {
    const response = await fetch(push.webhookUrl, {
        body: JSON.stringify(getWebhookBody(push, message)),
        headers: {
            'content-type': 'application/json',
        },
        method: 'POST',
    });
    if (!response.ok) {
        throw new Error(`Webhook request failed with HTTP ${response.status}.`);
    }
}

function getAiSummaryWebhookMessage(push: ReaderAiSummaryPush, result): WebhookMessage {
    return {
        body: result.summary || result.message || '这个范围内还没有可总结的数据。',
        fallback: {
            days: result.days,
            feedIds: push.feedIds,
            itemCount: result.itemCount,
            summarizedItemCount: result.summarizedItemCount,
            summary: result.summary,
            summaryHtml: result.summaryHtml,
        },
        meta: result.summarizedItemCount < result.itemCount ? `最近 ${result.days} 天 / 共 ${result.itemCount} 条内容，已总结 ${result.summarizedItemCount} 条` : `最近 ${result.days} 天 / ${result.itemCount} 条内容`,
        title: push.title || (push.feedIds.length > 1 ? '多频道 AI 总结' : 'AI 总结'),
    };
}

function buildRealtimeItemsBody(items: ReaderItem[]) {
    const visibleItems = items.toSorted((left, right) => right.pubDateMs - left.pubDateMs || right.id.localeCompare(left.id));
    const body = visibleItems
        .slice(0, 20)
        .map((item, index) => {
            const content = limitText(stripHtml(item.summary || item.description || ''), 300);
            const meta = [item.author, item.pubDate].filter(Boolean).join(' / ');
            return [`${index + 1}. ${item.title || 'Untitled'}`, meta, item.link ? `Link: ${item.link}` : '', content].filter(Boolean).join('\n');
        })
        .join('\n\n');
    const hiddenCount = visibleItems.length - 20;
    return hiddenCount > 0 ? `${body}\n\n还有 ${hiddenCount} 条新内容未展示。` : body;
}

function getRealtimeWebhookMessage(push: ReaderAiSummaryPush, feed: ReaderFeed, items: ReaderItem[]): WebhookMessage {
    const feedTitle = feed.title || feed.homeUrl || feed.url || '订阅源';
    return {
        body: buildRealtimeItemsBody(items),
        fallback: {
            feedId: feed.id,
            feedIds: push.feedIds,
            itemCount: items.length,
            items: items.map((item) => ({
                author: item.author,
                id: item.id,
                link: item.link,
                pubDate: item.pubDate,
                pubDateMs: item.pubDateMs,
                title: item.title,
            })),
            mode: 'realtime',
        },
        meta: `${feedTitle} / ${items.length} 条新内容`,
        title: push.title || `${feedTitle} 实时推送`,
    };
}

export async function sendAiSummaryPush(push: ReaderAiSummaryPush) {
    const result = await buildAiSummaryResponse(push.feedIds, push.days, push.prompt || undefined, false, { forceRefresh: true });
    if (!result.configured) {
        throw new Error(result.message || 'AI summary is not configured.');
    }
    await postPushWebhook(push, getAiSummaryWebhookMessage(push, result));
    return result;
}

export async function sendRealtimeItemsPush(push: ReaderAiSummaryPush, feed: ReaderFeed, items: ReaderItem[]) {
    if (!items.length) {
        return { itemCount: 0 };
    }
    await postPushWebhook(push, getRealtimeWebhookMessage(push, feed, items));
    return { itemCount: items.length };
}
