import { Api } from 'telegram';
import { getDisplayName } from 'telegram/Utils.js';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import { ViewType } from '@/types';

import { getTelegramChannel } from './tglib/channel';
import { getClient } from './tglib/client';
import { withTelegramRateLimit } from './tglib/rate-limit';

export const route: Route = {
    path: '/topic/:username/:topicId',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/telegram/topic/fractal_bitcoin_official/31',
    parameters: {
        username: 'group username',
        topicId: 'forum topic id, available from /telegram/topics/:username',
    },
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
            {
                name: 'TELEGRAM_MAX_CONCURRENT_DOWNLOADS',
                optional: true,
                description: 'Telegram Max Concurrent Downloads',
            },
            {
                name: 'TELEGRAM_PROXY_HOST',
                optional: true,
                description: 'Telegram Proxy Host',
            },
            {
                name: 'TELEGRAM_PROXY_PORT',
                optional: true,
                description: 'Telegram Proxy Port',
            },
            {
                name: 'TELEGRAM_PROXY_SECRET',
                optional: true,
                description: 'Telegram Proxy Secret',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [],
    name: 'Topic',
    maintainers: ['DIYgod', 'Rongronggg9', 'synchrone', 'pseudoyu'],
    handler,
    description: 'Subscribe to messages from one forum topic in a Telegram group. First use `/telegram/topics/:username` to find the topic id.',
};

async function handler(ctx) {
    const username = ctx.req.param('username');
    const topicId = Number(ctx.req.param('topicId'));
    if (!Number.isSafeInteger(topicId) || topicId <= 0) {
        throw new InvalidParameterError('Invalid topicId. Please use a positive integer from /telegram/topics/:username.');
    }

    const client = await getClient();
    const peer = await withTelegramRateLimit(() => client.getInputEntity(username));
    const entity = await withTelegramRateLimit(() => client.getEntity(peer));
    const response = await withTelegramRateLimit(() =>
        client.invoke(
            new Api.channels.GetForumTopicsByID({
                channel: peer,
                topics: [topicId],
            })
        )
    );
    const topic = response.topics.find((topic) => topic instanceof Api.ForumTopic);
    if (!(topic instanceof Api.ForumTopic)) {
        throw new InvalidParameterError(`Topic ${topicId} was not found in @${username}.`);
    }

    return await getTelegramChannel(ctx, username, {
        replyTo: topic.id,
        title: `${topic.title} - ${getDisplayName(entity)} - Telegram Topic`,
        link: `https://t.me/${username}/${topic.id}`,
        description: `${topic.title} in @${username} on Telegram`,
    });
}
