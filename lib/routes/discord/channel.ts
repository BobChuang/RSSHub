import { PermissionFlagsBits } from 'discord-api-types/v10';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { DataItem, Route } from '@/types';
import { parseDate } from '@/utils/parse-date';

import { baseUrl, getChannel, getChannelMessages, getGuild, getGuildMember, getGuildRoles } from './discord-api';
import { renderDescription } from './templates/message';

export const route: Route = {
    path: '/channel/:channelId',
    categories: ['social-media'],
    example: '/discord/channel/950465850056536084',
    parameters: { channelId: 'Channel ID' },
    features: {
        requireConfig: [
            {
                name: 'DISCORD_AUTHORIZATION',
                description: 'Discord authorization header from the browser',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['discord.com/channels/:guildId/:channelId/:messageID', 'discord.com/channels/:guildId/:channelId'],
        },
    ],
    name: 'Channel Messages',
    maintainers: ['TonyRL'],
    handler,
};

const getAdminRoleIds = async (guildId: string, authorization: string) => {
    try {
        const roles = await getGuildRoles(guildId, authorization);
        return new Set(roles.filter((role) => (BigInt(role.permissions) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator).map((role) => role.id));
    } catch {
        return new Set<string>();
    }
};

const getAuthorRoleMap = async (guildId: string, authorization: string, authorIds: string[]) => {
    const entries = await Promise.all(
        authorIds.map(async (authorId) => {
            try {
                const member = await getGuildMember(guildId, authorId, authorization);
                return [authorId, member.roles] as const;
            } catch {
                return [authorId, []] as const;
            }
        })
    );

    return new Map(entries);
};

const getMessageRole = (message, adminRoleIds: Set<string>, authorRoleMap: Map<string, string[]>) => {
    if (message.author.bot) {
        return 'bot';
    }
    const authorRoles = authorRoleMap.get(message.author.id) || [];
    return authorRoles.some((roleId) => adminRoleIds.has(roleId)) ? 'admin' : 'user';
};

async function handler(ctx) {
    if (!config.discord || !config.discord.authorization) {
        throw new ConfigNotFoundError('Discord RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }
    const { authorization } = config.discord;
    const channelId = ctx.req.param('channelId');

    const channelInfo = await getChannel(channelId, authorization);
    const messagesRaw = await getChannelMessages(channelId, authorization, ctx.req.query('limit') ?? 100);
    const { name: channelName, topic: channelTopic, guild_id: guildId } = channelInfo;

    const guildInfo = await getGuild(guildId, authorization);
    const { name: guildName, icon: guidIcon } = guildInfo;
    const authorIds = [...new Set(messagesRaw.map((message) => message.author.id).filter(Boolean))];
    const [adminRoleIds, authorRoleMap] = await Promise.all([getAdminRoleIds(guildId, authorization), getAuthorRoleMap(guildId, authorization, authorIds)]);

    const messages = messagesRaw.map((message) => {
        const messageRole = getMessageRole(message, adminRoleIds, authorRoleMap);
        return {
            title: message.content.split('\n', 1)[0],
            description: renderDescription({ message, guildInfo }),
            author: `${message.author.global_name ?? message.author.username}(${message.author.username})`,
            pubDate: parseDate(message.timestamp),
            updated: message.edited_timestamp ? parseDate(message.edited_timestamp) : undefined,
            category: [`#${channelName}`, `discord-role:${messageRole}`],
            link: `${baseUrl}/channels/${guildId}/${channelId}/${message.id}`,
        };
    });

    return {
        title: `#${channelName} - ${guildName} - Discord`,
        description: channelTopic,
        link: `${baseUrl}/channels/${guildId}/${channelId}`,
        image: `https://cdn.discordapp.com/icons/${guildId}/${guidIcon}.webp`,
        item: messages as unknown as DataItem[],
        allowEmpty: true,
    };
}
