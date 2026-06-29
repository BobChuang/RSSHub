import type { Data, DataItem } from '@/types';
import parser from '@/utils/rss-parser';

function stripHtml(value: string) {
    return value
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
}

function escapeHtml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function normalizeJsonFeedItem(item: any): DataItem {
    const description = item.content_html || escapeHtml(item.content_text || item.summary || '');
    return {
        title: item.title || item.url || item.external_url || 'Untitled',
        description,
        pubDate: item.date_published || item.date_modified || '',
        link: item.url || item.external_url || '',
        category: Array.isArray(item.tags) ? item.tags : [],
        author: item.author?.name || item.author?.url || '',
        guid: item.id || item.url || item.title,
        content: {
            html: description,
            text: item.content_text || item.summary || stripHtml(description),
        },
    };
}

function parseJsonFeed(json: any, feedUrl: string): Data {
    return {
        title: json.title || feedUrl,
        description: json.description || '',
        link: json.home_page_url || json.feed_url || feedUrl,
        item: (json.items || []).map((item) => normalizeJsonFeedItem(item)),
    };
}

function normalizeParsedItem(item: any): DataItem {
    const description = item['content:encoded'] || item.content || item.summary || item.contentSnippet || '';
    return {
        title: item.title || item.link || item.guid || 'Untitled',
        description,
        pubDate: item.pubDate || item.isoDate || item.updated || '',
        link: item.link || item.guid || '',
        category: item.categories || item.category || [],
        author: item.creator || item.author || '',
        guid: item.guid || item.id || item.link || item.title,
        content: {
            html: description,
            text: item.contentSnippet || stripHtml(description),
        },
        enclosure_url: item.enclosure?.url,
        enclosure_type: item.enclosure?.type,
        enclosure_length: item.enclosure?.length,
    };
}

export async function parseFeedText(text: string, contentType: string, feedUrl: string): Promise<Data> {
    const trimmed = text.trim();
    if (contentType.includes('json') || trimmed.startsWith('{')) {
        return parseJsonFeed(JSON.parse(trimmed), feedUrl);
    }

    const feed = await parser.parseString(text);
    return {
        title: feed.title || feedUrl,
        description: feed.description || '',
        link: feed.link || feed.feedUrl || feedUrl,
        item: (feed.items || []).map((item) => normalizeParsedItem(item)),
    };
}
