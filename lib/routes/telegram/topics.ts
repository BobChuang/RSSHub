import { Api } from 'telegram';
import { getDisplayName } from 'telegram/Utils.js';

import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';

import { getClient } from './tglib/client';

export const route: Route = {
    path: '/topics/:username',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/telegram/topics/fractal_bitcoin_official',
    parameters: { username: 'group username' },
    features: {
        requireConfig: [
            {
                name: 'TELEGRAM_SESSION',
                optional: false,
                description: 'Telegram API Authentication',
            },
            {
                name: 'TELEGRAM_API_ID',
                optional: true,
                description: 'Telegram API ID',
            },
            {
                name: 'TELEGRAM_API_HASH',
                optional: true,
                description: 'Telegram API Hash',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [],
    name: 'Topics',
    maintainers: ['DIYgod', 'Rongronggg9', 'synchrone', 'pseudoyu'],
    handler,
    description: 'List forum topics from a Telegram group. Use the topic id in `/telegram/topic/:username/:topicId` to subscribe to a single topic.',
};

async function handler(ctx) {
    const client = await getClient();
    const username = ctx.req.param('username');
    const peer = await client.getInputEntity(username);
    const entity = await client.getEntity(peer);
    const origin = new URL(ctx.req.url).origin;

    const response = await client.invoke(
        new Api.channels.GetForumTopics({
            channel: peer,
            offsetDate: 0,
            offsetId: 0,
            offsetTopic: 0,
            limit: 100,
        })
    );

    const item: DataItem[] = response.topics
        .filter((topic) => topic instanceof Api.ForumTopic)
        .map((topic) => {
            const topicUrl = new URL(`/telegram/topic/${username}/${topic.id}`, origin).href;
            return {
                title: topic.title,
                description: `<p>Topic ID: ${topic.id}</p><p><a href="${topicUrl}">Subscribe to this topic</a></p>`,
                pubDate: new Date(topic.date * 1000).toUTCString(),
                link: topicUrl,
                guid: `telegram:topic:${username}:${topic.id}`,
                category: [topic.closed ? 'closed' : 'open', topic.pinned ? 'pinned' : 'unpinned'],
            };
        });

    return {
        title: `${getDisplayName(entity)} - Telegram Topics`,
        link: `https://t.me/${username}`,
        description: `Topics of @${username} on Telegram`,
        item,
    };
}
