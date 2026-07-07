import MarkdownIt from 'markdown-it';

import type { ReaderAiSummaryPush, ReaderFeed, ReaderItem } from './store';
import { getFeedsAiSummaryPrompt, getMultiAiSummaryPrompt, getPool, rowToItem, updateFeedsAiSummaryPrompt, updateMultiAiSummaryPrompt } from './store';

const markdown = MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
});
const larkMarkdownChunkLength = 4000;
const summaryBatchItemLimit = 1000;
const sourceUsageInstruction = '引用文章时必须保留 SourceID，格式为 Sources: S12, S45。不要输出空的“链接:”行；需要链接时只引用 SourceID，链接会由系统补全。';

type SummarySource = {
    id: string;
    link: string;
    source: string;
    title: string;
};

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

function getSummarySourceId(index: number) {
    return `S${index + 1}`;
}

function getSummaryItemSource(item) {
    return [item.feedGroup, item.feedTitle].filter(Boolean).join(' / ');
}

function prepareSummaryItems(items) {
    const sourceMap = new Map<string, SummarySource>();
    const summaryItems = items.map((item, index) => {
        const sourceId = getSummarySourceId(index);
        const source = getSummaryItemSource(item);
        if (item.link) {
            sourceMap.set(sourceId, {
                id: sourceId,
                link: item.link,
                source,
                title: item.title || 'Untitled',
            });
        }
        return {
            ...item,
            aiSummarySourceId: sourceId,
        };
    });
    return { items: summaryItems, sourceMap };
}

function buildSummaryItemsText(items) {
    return items
        .map((item, index) => {
            const content = limitText(stripHtml(item.summary || item.description || ''), 420);
            const source = getSummaryItemSource(item);
            return [
                `${index + 1}. ${item.title}`,
                `SourceID: ${item.aiSummarySourceId || getSummarySourceId(index)}`,
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

function replacePromptToken(value: string, token: string, replacement: string) {
    return value.split(token).join(replacement);
}

function renderSummaryPrompt(promptTemplate: string, items, days: number) {
    const itemsText = buildSummaryItemsText(items);
    const hasItemsPlaceholder = promptTemplate.includes('{{items}}');
    const promptWithDays = replacePromptToken(promptTemplate, '{{days}}', String(days));
    const promptWithItemCount = replacePromptToken(promptWithDays, '{{itemCount}}', String(items.length));
    const prompt = replacePromptToken(promptWithItemCount, '{{items}}', itemsText);

    if (hasItemsPlaceholder) {
        return [sourceUsageInstruction, '', prompt].join('\n');
    }

    return [prompt, '', sourceUsageInstruction, '', `共收集到 ${items.length} 条：`, itemsText].join('\n');
}

function getBatches<T>(items: T[], batchSize: number) {
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += batchSize) {
        batches.push(items.slice(index, index + batchSize));
    }
    return batches;
}

function renderBatchSummaryPrompt(promptTemplate: string, items, days: number, batchIndex: number, batchCount: number, itemCount: number) {
    return [
        `这是第 ${batchIndex + 1}/${batchCount} 批内容，全部时间范围内共有 ${itemCount} 条。请先只总结本批，保留重要事实、频道和趋势，供最终汇总使用。`,
        '每条重要结论必须带 Sources: Sxx；不要复写 URL，不要输出空的“链接:”行。',
        '',
        renderSummaryPrompt(promptTemplate, items, days),
    ].join('\n');
}

function renderFinalSummaryPrompt(promptTemplate: string, batchSummaries: string[], days: number, itemCount: number) {
    const summaryText = batchSummaries.map((summary, index) => [`批次 ${index + 1}`, summary].join('\n')).join('\n\n');
    const promptWithDays = replacePromptToken(promptTemplate, '{{days}}', String(days));
    const promptWithItemCount = replacePromptToken(promptWithDays, '{{itemCount}}', String(itemCount));
    const promptWithoutItems = replacePromptToken(promptWithItemCount, '{{items}}', '见下方分批总结');

    return [
        '下面是同一批 RSS 内容按 1000 条分批生成的中间总结。请基于全部中间总结生成最终总结，不要遗漏跨批次反复出现的趋势、重要频道和关键链接。',
        '最终总结的每条重要结论必须保留批次摘要里的 Sources: Sxx。不要输出空的“链接:”行，链接会由系统根据 SourceID 自动补全。',
        '',
        '原始总结要求：',
        promptWithoutItems,
        '',
        `原始内容总数：${itemCount} 条 / 分批数：${batchSummaries.length}`,
        '',
        summaryText,
    ].join('\n');
}

function getSummarySourceIds(value: string) {
    const sourceIds = new Set<string>();
    for (const match of value.matchAll(/\bS\d+\b/g)) {
        sourceIds.add(match[0]);
    }
    return [...sourceIds].toSorted((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

function stripEmptyLinkLines(value: string) {
    return value
        .split('\n')
        .filter((line) => !/^\s*(?:[-*]\s*)?(?:链接|Link)\s*[:：]\s*$/.test(line))
        .join('\n')
        .trim();
}

function appendSummarySourceLinks(summary: string, sourceMap: Map<string, SummarySource>) {
    const cleanSummary = stripEmptyLinkLines(summary);
    const sourceIds = getSummarySourceIds(cleanSummary).filter((sourceId) => sourceMap.has(sourceId));
    if (!sourceIds.length) {
        return cleanSummary;
    }
    const sourceLinks = sourceIds.map((sourceId) => {
        const source = sourceMap.get(sourceId);
        return `- ${sourceId} ${source?.title || 'Untitled'}${source?.source ? ` (${source.source})` : ''}: ${source?.link || ''}`;
    });
    return [cleanSummary, '', '来源链接：', ...sourceLinks].join('\n');
}

function withSummarySourceLinks<T extends { summary: string }>(result: T, sourceMap: Map<string, SummarySource>) {
    return {
        ...result,
        summary: result.summary ? appendSummarySourceLinks(result.summary, sourceMap) : result.summary,
    };
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

async function requestAiSummaryForItems(promptTemplate: string, items, days: number, sourceMap: Map<string, SummarySource>) {
    const batches = getBatches(items, summaryBatchItemLimit);
    if (batches.length <= 1) {
        const prompt = renderSummaryPrompt(promptTemplate, items, days);
        return {
            ...withSummarySourceLinks(await requestAiSummary(prompt), sourceMap),
            prompt,
        };
    }

    const batchResults = await Promise.all(
        batches.map(async (batchItems, index) => {
            const prompt = renderBatchSummaryPrompt(promptTemplate, batchItems, days, index, batches.length, items.length);
            return {
                prompt,
                result: await requestAiSummary(prompt),
            };
        })
    );
    const failedBatch = batchResults.find(({ result }) => !result.configured || !result.summary);
    if (failedBatch) {
        return {
            ...failedBatch.result,
            prompt: failedBatch.prompt,
        };
    }
    const batchSummaries = batchResults.map(({ result }) => result.summary);

    const prompt = renderFinalSummaryPrompt(promptTemplate, batchSummaries, days, items.length);
    return {
        ...withSummarySourceLinks(await requestAiSummary(prompt), sourceMap),
        prompt,
    };
}

export async function buildAiSummaryResponse(feedIds: string[], days: number, promptValue?: unknown, savePrompt?: boolean) {
    const submittedPrompt = normalizeSummaryPrompt(promptValue);
    const isSingleFeed = feedIds.length === 1;
    const defaultPrompt = isSingleFeed ? defaultAiSummaryPrompt : defaultMultiAiSummaryPrompt;
    const savedPrompt = isSingleFeed ? await getFeedsAiSummaryPrompt(feedIds) : await getMultiAiSummaryPrompt();
    const promptTemplate = submittedPrompt || savedPrompt || defaultPrompt;
    if (savePrompt && submittedPrompt) {
        await (isSingleFeed ? updateFeedsAiSummaryPrompt(feedIds, promptTemplate) : updateMultiAiSummaryPrompt(promptTemplate));
    }
    const items = await getSummaryItems(feedIds, days);
    const prepared = prepareSummaryItems(items);
    const aiResult = prepared.items.length
        ? await requestAiSummaryForItems(promptTemplate, prepared.items, days, prepared.sourceMap)
        : {
              configured: Boolean((process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.READER_AI_MODEL),
              message: '',
              prompt: renderSummaryPrompt(promptTemplate, prepared.items, days),
              summary: '',
          };

    return {
        ...aiResult,
        days,
        itemCount: items.length,
        prompt: aiResult.prompt,
        promptTemplate,
        summaryHtml: renderSummaryMarkdown(aiResult.summary),
    };
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

async function requestAiSummary(prompt: string) {
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

    const response = await fetch(requestUrl, {
        body: JSON.stringify({
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
    });
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

type WebhookMessage = {
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

async function postPushWebhook(push: ReaderAiSummaryPush, message: WebhookMessage) {
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
            summary: result.summary,
            summaryHtml: result.summaryHtml,
        },
        meta: `最近 ${result.days} 天 / ${result.itemCount} 条内容`,
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
    const result = await buildAiSummaryResponse(push.feedIds, push.days, push.prompt || undefined, false);
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
