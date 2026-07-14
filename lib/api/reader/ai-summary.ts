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
const linkPreservationInstruction = [
    '链接保留要求：',
    '1. 每条具体内容如果引用原始文章，链接行必须紧跟对应内容下方，格式为：链接：<原始URL>。',
    '2. 链接必须从输入内容的 Link 字段原样复制，不能留空、不能编造。',
    '3. 如果某条内容没有可用链接，不要输出“链接：”行。',
].join('\n');

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

function buildSummaryItemsText(items) {
    return items
        .map((item, index) => {
            const content = limitText(stripHtml(item.summary || item.description || ''), 420);
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

function renderSummaryPrompt(promptTemplate: string, items, days: number) {
    const itemsText = buildSummaryItemsText(items);
    const hasItemsPlaceholder = promptTemplate.includes('{{items}}');
    const promptWithDays = replacePromptToken(promptTemplate, '{{days}}', String(days));
    const promptWithItemCount = replacePromptToken(promptWithDays, '{{itemCount}}', String(items.length));
    const prompt = replacePromptToken(promptWithItemCount, '{{items}}', itemsText);

    if (hasItemsPlaceholder) {
        return [linkPreservationInstruction, '', prompt].join('\n');
    }

    return [prompt, '', linkPreservationInstruction, '', `共收集到 ${items.length} 条：`, itemsText].join('\n');
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
        `这是第 ${batchIndex + 1}/${batchCount} 批内容，全部时间范围内共有 ${itemCount} 条。请先只总结本批，保留重要事实、频道、链接和趋势，供最终汇总使用。`,
        '本批输出里，具体内容的链接行必须紧跟对应内容下方，并从输入 Link 字段原样复制。',
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
        '最终总结引用某条具体内容时，链接行必须紧跟对应内容下方，并从批次摘要里原样复制。',
        '不要输出空的“链接：”行；如果找不到对应链接，就不要列出这条具体内容。',
        '',
        '原始总结要求：',
        promptWithoutItems,
        '',
        linkPreservationInstruction,
        '',
        `原始内容总数：${itemCount} 条 / 分批数：${batchSummaries.length}`,
        '',
        summaryText,
    ].join('\n');
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

async function requestAiSummaryForItems(promptTemplate: string, items, days: number) {
    const batches = getBatches(items, summaryBatchItemLimit);
    if (batches.length <= 1) {
        const prompt = renderSummaryPrompt(promptTemplate, items, days);
        return {
            ...withCleanSummaryLinks(await requestAiSummary(prompt)),
            prompt,
        };
    }

    const batchResults = await Promise.all(
        batches.map(async (batchItems, index) => {
            const prompt = renderBatchSummaryPrompt(promptTemplate, batchItems, days, index, batches.length, items.length);
            return {
                prompt,
                result: withCleanSummaryLinks(await requestAiSummary(prompt)),
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
        ...withCleanSummaryLinks(await requestAiSummary(prompt)),
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
    const aiResult = items.length
        ? await requestAiSummaryForItems(promptTemplate, items, days)
        : {
              configured: Boolean((process.env.READER_AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.READER_AI_MODEL),
              message: '',
              prompt: renderSummaryPrompt(promptTemplate, items, days),
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
