/* oxlint-disable eslint-js/no-implicit-globals eslint/require-await eslint/no-unused-vars unicorn/no-array-callback-reference unicorn/no-array-for-each unicorn/no-useless-fallback-in-spread unicorn/numeric-separators-style unicorn/prefer-code-point unicorn/prefer-query-selector unicorn/prefer-set-has unicorn/prefer-string-replace-all unicorn-js/no-computed-property-existence-check unicorn-js/prefer-else-if */

const storageKey = 'rsshub-reader-state-v1';
const legacyArticleCleanupKey = 'rsshub-reader-legacy-article-cleanup-v1';
const articlePageSize = 50;
const defaultRefreshMinutes = 5;
const globalRefreshOffValue = 'off';
const globalRefreshOnValue = 'on';
const chatGuildSourcePrefix = 'chat-guild:';
const ungroupedGroupKey = '__ungrouped__';
const ungroupedGroupLabel = '未分组';
const categoryIds = ['articles', 'social', 'chat', 'videos', 'notifications'];
const categoryLabels = {
    all: '全部',
    articles: '文章',
    chat: '聊天',
    notifications: '通知',
    social: '社媒',
    videos: '视频',
};

const elements = {
    addFeedButton: document.querySelector('#addFeedButton'),
    addFeedForm: document.querySelector('#addFeedForm'),
    addFeedModal: document.querySelector('#addFeedModal'),
    aiSummaryFeedTitle: document.querySelector('#aiSummaryFeedTitle'),
    aiSummaryForm: document.querySelector('#aiSummaryForm'),
    aiSummaryModal: document.querySelector('#aiSummaryModal'),
    aiSummaryRangeInput: document.querySelector('#aiSummaryRangeInput'),
    aiSummaryResult: document.querySelector('#aiSummaryResult'),
    articleList: document.querySelector('#articleList'),
    cancelAiSummaryButton: document.querySelector('#cancelAiSummaryButton'),
    cancelAddFeedButton: document.querySelector('#cancelAddFeedButton'),
    closeAiSummaryButton: document.querySelector('#closeAiSummaryButton'),
    closeAddFeedButton: document.querySelector('#closeAddFeedButton'),
    deleteFeedButton: document.querySelector('#deleteFeedButton'),
    exportConfigButton: document.querySelector('#exportConfigButton'),
    feedCategoryInput: document.querySelector('#feedCategoryInput'),
    feedGroupInput: document.querySelector('#feedGroupInput'),
    feedIntervalInput: document.querySelector('#feedIntervalInput'),
    feedModalTitle: document.querySelector('#feedModalTitle'),
    feedUrlInput: document.querySelector('#feedUrlInput'),
    globalIntervalSelect: document.querySelector('#globalIntervalSelect'),
    importConfigButton: document.querySelector('#importConfigButton'),
    importConfigInput: document.querySelector('#importConfigInput'),
    markAllReadButton: document.querySelector('#markAllReadButton'),
    openAddFeedButton: document.querySelector('#openAddFeedButton'),
    readerPane: document.querySelector('#readerPane'),
    readerStatus: document.querySelector('#readerStatus'),
    refreshButton: document.querySelector('#refreshButton'),
    runAiSummaryButton: document.querySelector('#runAiSummaryButton'),
    searchInput: document.querySelector('#searchInput'),
    settingsButton: document.querySelector('#settingsButton'),
    settingsMenu: document.querySelector('#settingsMenu'),
    sourceList: document.querySelector('#sourceList'),
};

let legacyItemsToMigrate = [];
let shouldPersistLoadedState = false;

const state = loadState();
const fetchingFeedIds = new Set();
const latestChatMessageDateByFeedId = new Map();
const unreadCountByFeedId = new Map();
let editingFeedId = '';
let summarizingFeedId = '';
let summarizingFeedIds = [];
let summarizingTitle = '';
let articleOffset = 0;
let hasMoreArticles = true;
let isLoadingArticles = false;
let renderToken = 0;
let discordRolePopover;
let unreadCountsReady = false;

function loadState() {
    const fallback = {
        baseUrl: window.location.origin,
        collapsedGroups: {},
        feeds: [],
        globalRefreshEnabled: true,
        items: [],
        readFilter: 'all',
        search: '',
        selectedChatGuildKey: '',
        selectedCategory: 'all',
        selectedItemId: '',
        selectedSource: 'all',
    };

    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
        const savedItems = Array.isArray(saved.items) ? saved.items : fallback.items;
        const loaded = {
            ...fallback,
            ...saved,
            collapsedGroups: typeof saved.collapsedGroups === 'object' && saved.collapsedGroups ? saved.collapsedGroups : fallback.collapsedGroups,
            feeds: Array.isArray(saved.feeds) ? saved.feeds : fallback.feeds,
            globalRefreshEnabled: getGlobalRefreshEnabled(saved),
            items: savedItems,
        };
        loaded.feeds = loaded.feeds.map((feed) => ({
            ...feed,
            category: getCategory(feed.category || inferCategory(feed.url)),
            group: normalizeGroupName(feed.group),
            paused: Boolean(feed.paused),
            refreshMinutes: getAllowedRefreshMinutes(feed.refreshMinutes),
        }));
        loaded.items = loaded.items.filter((item) => {
            const itemCategory = item.category === 'images' ? 'chat' : item.category;
            if (!categoryIds.includes(itemCategory)) {
                return false;
            }
            return itemCategory !== 'articles' || getFeedCategory(loaded.feeds, item.feedId) === 'articles';
        });
        if (loaded.items.length !== savedItems.length) {
            shouldPersistLoadedState = true;
        }
        loaded.items = loaded.items.map((item) => ({ ...item, category: getCategory(item.category) }));
        if (!localStorage.getItem(legacyArticleCleanupKey)) {
            const articleItems = loaded.items.filter((item) => item.category === 'articles');
            if (articleItems.length === 20) {
                loaded.items = loaded.items.filter((item) => item.category !== 'articles');
                localStorage.setItem(legacyArticleCleanupKey, 'true');
                shouldPersistLoadedState = true;
            }
        }
        legacyItemsToMigrate = loaded.items;
        loaded.items = [];
        if (savedItems.length) {
            shouldPersistLoadedState = true;
        }
        loaded.selectedCategory = getCategory(loaded.selectedCategory || 'all', true);
        if (['unread', 'starred'].includes(loaded.selectedSource)) {
            loaded.selectedSource = 'all';
        }
        loaded.readFilter = getReadFilter(loaded.readFilter);
        return loaded;
    } catch {
        return fallback;
    }
}

function saveState() {
    localStorage.setItem(
        storageKey,
        JSON.stringify({
            baseUrl: state.baseUrl,
            collapsedGroups: state.collapsedGroups,
            feeds: state.feeds,
            globalRefreshEnabled: state.globalRefreshEnabled,
            readFilter: state.readFilter,
            search: state.search,
            selectedChatGuildKey: state.selectedChatGuildKey,
            selectedCategory: state.selectedCategory,
            selectedItemId: state.selectedItemId,
            selectedSource: state.selectedSource,
        })
    );
}

function prepareItemForDatabase(item) {
    return {
        ...item,
        category: getCategory(item.category),
        pubDateMs: getTimestamp(item.pubDate),
        searchText: [item.title, item.summary, item.author, ...(item.categories || [])].join(' ').toLowerCase(),
    };
}

async function readerApi(path, options = {}) {
    const response = await fetch('/api/reader' + path, {
        cache: 'no-store',
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error || 'Reader database request failed.');
    }
    return data;
}

async function putItems(items) {
    if (!items.length) {
        return;
    }
    await readerApi('/items/bulk', {
        body: JSON.stringify({
            items: items.map(prepareItemForDatabase),
        }),
        method: 'POST',
    });
}

async function getItem(itemId) {
    if (!itemId) {
        return;
    }
    return readerApi('/items/' + encodeURIComponent(itemId));
}

async function updateItem(item) {
    return readerApi('/items/' + encodeURIComponent(item.id), {
        body: JSON.stringify({
            isRead: item.isRead,
            isStarred: item.isStarred,
        }),
        method: 'PATCH',
    });
}

async function deleteFeedItems(feedId) {
    await readerApi('/feeds/' + encodeURIComponent(feedId) + '/items', {
        method: 'DELETE',
    });
}

async function updateFeedItemsCategory(feedId, category) {
    await readerApi('/feeds/' + encodeURIComponent(feedId) + '/category', {
        body: JSON.stringify({ category }),
        method: 'PATCH',
    });
}

async function getAiSummary(feedId, days) {
    return readerApi('/feeds/' + encodeURIComponent(feedId) + '/ai-summary', {
        body: JSON.stringify({ days }),
        method: 'POST',
    });
}

async function getAiSummaryForFeeds(feedIds, days) {
    if (feedIds.length === 1) {
        return getAiSummary(feedIds[0], days);
    }
    return readerApi('/feeds/ai-summary', {
        body: JSON.stringify({ days, feedIds }),
        method: 'POST',
    });
}

async function lookupDiscordAuthorRoles(guildId, authors) {
    if (!guildId || !authors.length) {
        return {};
    }
    const result = await readerApi('/discord-author-roles/lookup', {
        body: JSON.stringify({ authors, guildId }),
        method: 'POST',
    });
    return result.roles || {};
}

async function saveDiscordAuthorRole(guildId, author, role) {
    return readerApi('/discord-author-roles', {
        body: JSON.stringify({ author, guildId, role }),
        method: 'PUT',
    });
}

async function markCurrentListRead() {
    if (isChatView()) {
        await markSelectedChatChannelRead();
        return;
    }

    const params = getCurrentListParams();
    const result = await readerApi('/items/read-all?' + params.toString(), {
        method: 'PATCH',
    });
    setStatus('Marked ' + result.count + ' item' + (result.count === 1 ? '' : 's') + ' as read.');
    if (state.readFilter === 'unread') {
        state.selectedItemId = '';
        saveState();
    }
    await renderCounts();
    await resetArticlePagination();
    await renderReader();
}

async function markSelectedChatChannelRead(feed = getSelectedChatFeed()) {
    if (!feed) {
        setStatus('Choose a Discord channel first.');
        return;
    }

    const params = new URLSearchParams();
    params.set('feedId', feed.id);
    const result = await readerApi('/items/read-all?' + params.toString(), {
        method: 'PATCH',
    });
    setStatus('Marked ' + result.count + ' message' + (result.count === 1 ? '' : 's') + ' as read in ' + feed.channelName + '.');
    await renderCounts();
    await renderChatChannels();
    await renderChatMessages();
}

async function migrateLegacyItems() {
    if (!legacyItemsToMigrate.length) {
        return;
    }
    await putItems(legacyItemsToMigrate);
    legacyItemsToMigrate = [];
}

function getAllowedRefreshMinutes(value) {
    const minutes = Number(value);
    return [1, 3, 5, 10, 30].includes(minutes) ? minutes : defaultRefreshMinutes;
}

function getGlobalRefreshEnabled(saved) {
    if (typeof saved.globalRefreshEnabled === 'boolean') {
        return saved.globalRefreshEnabled;
    }
    return Number(saved.globalRefreshMinutes) !== 0;
}

function getReadFilter(value) {
    return ['all', 'unread', 'read'].includes(value) ? value : 'all';
}

function normalizeGroupName(value) {
    return String(value || '').trim();
}

function getGroupKey(groupName) {
    return groupName || ungroupedGroupKey;
}

function getGroupLabel(groupName) {
    return groupName || ungroupedGroupLabel;
}

function getCategory(value, allowAll = false) {
    if (allowAll && value === 'all') {
        return value;
    }
    if (value === 'images') {
        return 'chat';
    }
    return categoryIds.includes(value) ? value : 'articles';
}

function getFeedCategory(feeds, feedId) {
    return getCategory(feeds.find((feed) => feed.id === feedId)?.category);
}

function inferCategory(url) {
    const lowerUrl = String(url || '').toLowerCase();
    if (['twitter', 'x.com', 'bsky', 'mastodon', 'weibo', 'telegram', 'threads'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'social';
    }
    if (['chat', 'message', 'conversation', 'discord', 'slack', 'lark', 'telegram'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'chat';
    }
    if (['youtube', 'bilibili', 'douyin', 'tiktok', 'video', 'podcast'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'videos';
    }
    if (['status', 'release', 'security', 'notice', 'notification', 'alert'].some((keyword) => lowerUrl.includes(keyword))) {
        return 'notifications';
    }
    return 'articles';
}

function normalizeFeedUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Feed URL is required.');
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return new URL(trimmed).href;
    }

    const routePath = trimmed.startsWith('/') ? trimmed : '/' + trimmed;
    return new URL(routePath, window.location.origin).href;
}

function getPortableFeedUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.origin === window.location.origin) {
            return parsed.pathname + parsed.search + parsed.hash;
        }
    } catch {
        // Keep malformed legacy URLs exportable as-is.
    }

    return url;
}

function getRefreshMinutes(feed) {
    return Number(feed.refreshMinutes) || defaultRefreshMinutes;
}

function getNextFetchAt(feed) {
    if (!state.globalRefreshEnabled) {
        return '';
    }
    return new Date(Date.now() + getRefreshMinutes(feed) * 60_000).toISOString();
}

function createId(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(31, hash) + value.charCodeAt(index);
    }
    return Math.abs(hash).toString(36);
}

function getText(parent, tagName) {
    return parent?.getElementsByTagName(tagName)[0]?.textContent?.trim() || '';
}

function getNode(parent, tagName) {
    return parent?.getElementsByTagName(tagName)[0];
}

function stripHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    return template.content.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = value || '';
    return span.innerHTML;
}

function parseFeed(text, contentType, feedUrl) {
    if (contentType.includes('json') || text.trim().startsWith('{')) {
        return parseJsonFeed(JSON.parse(text), feedUrl);
    }

    const documentNode = new DOMParser().parseFromString(text, 'application/xml');
    const parserError = documentNode.querySelector('parsererror');
    if (parserError) {
        throw new Error('The response is not valid RSS, Atom, or JSON Feed.');
    }

    if (documentNode.querySelector('rss, channel')) {
        return parseRssFeed(documentNode, feedUrl);
    }

    if (documentNode.querySelector('feed')) {
        return parseAtomFeed(documentNode, feedUrl);
    }

    throw new Error('The response does not look like a supported feed.');
}

function parseRssFeed(documentNode, feedUrl) {
    const channel = documentNode.querySelector('channel') || documentNode;
    const title = getText(channel, 'title') || feedUrl;
    const homeUrl = getText(channel, 'link') || feedUrl;
    const entries = [...documentNode.querySelectorAll('item')].map((entry) => {
        const link = getText(entry, 'link');
        const guid = getText(entry, 'guid') || link || getText(entry, 'title');
        const content = getText(entry, 'content:encoded') || getText(entry, 'description');
        const categories = [...entry.getElementsByTagName('category')].map((category) => category.textContent?.trim()).filter(Boolean);
        return {
            author: getText(entry, 'dc:creator') || getText(entry, 'author'),
            categories,
            description: content,
            idSeed: guid,
            link,
            pubDate: getText(entry, 'pubDate') || getText(entry, 'dc:date'),
            summary: stripHtml(content),
            title: getText(entry, 'title') || link || 'Untitled',
        };
    });

    return { homeUrl, items: entries, title };
}

function getAtomLink(entry) {
    const links = [...entry.getElementsByTagName('link')];
    const alternate = links.find((link) => !link.getAttribute('rel') || link.getAttribute('rel') === 'alternate');
    return alternate?.getAttribute('href') || links[0]?.getAttribute('href') || '';
}

function parseAtomFeed(documentNode, feedUrl) {
    const feed = documentNode.querySelector('feed');
    const title = getText(feed, 'title') || feedUrl;
    const homeUrl = getAtomLink(feed) || feedUrl;
    const entries = [...documentNode.querySelectorAll('entry')].map((entry) => {
        const link = getAtomLink(entry);
        const content = getText(entry, 'content') || getText(entry, 'summary');
        const categories = [...entry.getElementsByTagName('category')].map((category) => category.getAttribute('term') || category.textContent?.trim()).filter(Boolean);
        return {
            author: getText(getNode(entry, 'author'), 'name'),
            categories,
            description: content,
            idSeed: getText(entry, 'id') || link || getText(entry, 'title'),
            link,
            pubDate: getText(entry, 'published') || getText(entry, 'updated'),
            summary: stripHtml(content),
            title: getText(entry, 'title') || link || 'Untitled',
        };
    });

    return { homeUrl, items: entries, title };
}

function parseJsonFeed(json, feedUrl) {
    const title = json.title || feedUrl;
    const homeUrl = json.home_page_url || json.feed_url || feedUrl;
    const entries = (json.items || []).map((entry) => {
        const content = entry.content_html || escapeHtml(entry.content_text || entry.summary || '');
        return {
            author: entry.author?.name || entry.author?.url || '',
            categories: Array.isArray(entry.tags) ? entry.tags : [],
            description: content,
            idSeed: entry.id || entry.url || entry.title,
            link: entry.url || entry.external_url || '',
            pubDate: entry.date_published || entry.date_modified || '',
            summary: entry.summary || stripHtml(content),
            title: entry.title || entry.url || 'Untitled',
        };
    });

    return { homeUrl, items: entries, title };
}

function normalizeParsedItems(feed, parsedItems) {
    return parsedItems
        .filter((item) => item.link || item.idSeed)
        .map((item) => {
            const link = item.link || item.idSeed;
            const id = createId(feed.id + ':' + (item.idSeed || link));
            return {
                author: item.author || '',
                categories: item.categories || [],
                category: getCategory(feed.category),
                description: item.description || '',
                feedId: feed.id,
                id,
                isRead: false,
                isStarred: false,
                link,
                pubDate: item.pubDate || '',
                summary: item.summary || '',
                title: item.title || link,
            };
        });
}

function isChatView() {
    return state.selectedCategory === 'chat' || isAllSelectedChatView();
}

function isChatOnlyView() {
    return state.selectedCategory === 'chat';
}

function isAllSelectedChatView() {
    return state.selectedCategory === 'all' && (isChatGuildSourceId(state.selectedSource) || isDiscordChannelFeed(getFeed(state.selectedSource)));
}

function getChatGuildSourceId(groupKey) {
    return chatGuildSourcePrefix + groupKey;
}

function isChatGuildSourceId(sourceId) {
    return String(sourceId || '').startsWith(chatGuildSourcePrefix);
}

function getDiscordChannelRouteId(feed) {
    try {
        return new URL(feed.url).pathname.match(/\/discord\/channel\/([^/]+)/)?.[1] || '';
    } catch {
        return '';
    }
}

function getDiscordGuildIdFromHomeUrl(feed) {
    return String(feed.homeUrl || '').match(/\/channels\/(\d+)(?:\/|$)/)?.[1] || '';
}

function parseDiscordFeedTitle(feed) {
    const title = feed.title || '';
    const suffix = ' - Discord';
    const body = title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
    const separator = body.lastIndexOf(' - ');
    const hasGuildTitle = separator !== -1;
    const channelName = hasGuildTitle ? body.slice(0, separator) : title || getDiscordChannelRouteId(feed);
    const guildName = hasGuildTitle ? body.slice(separator + 3) : feed.group || 'Discord';

    return {
        channelName,
        guildName,
    };
}

function isDiscordChannelFeed(feed) {
    return Boolean(feed) && getCategory(feed.category) === 'chat' && Boolean(getDiscordChannelRouteId(feed));
}

function getChatGuildGroups(feeds = getVisibleFeeds()) {
    const groups = [];
    const groupMap = new Map();
    for (const feed of feeds) {
        if (!isDiscordChannelFeed(feed)) {
            continue;
        }

        const { channelName, guildName } = parseDiscordFeedTitle(feed);
        const guildId = getDiscordGuildIdFromHomeUrl(feed);
        const key = guildId || guildName;
        if (!groupMap.has(key)) {
            const group = {
                feeds: [],
                key,
                label: guildName,
            };
            groupMap.set(key, group);
            groups.push(group);
        }
        groupMap.get(key).feeds.push({
            ...feed,
            channelName,
            guildName,
        });
    }
    return groups;
}

function getSelectedChatGuildGroup() {
    const groups = getChatGuildGroups();
    if (!groups.length) {
        return;
    }
    const selectedFeed = getFeed(state.selectedSource);
    if (isDiscordChannelFeed(selectedFeed)) {
        const selectedFeedKey = getDiscordGuildIdFromHomeUrl(selectedFeed) || parseDiscordFeedTitle(selectedFeed).guildName;
        const selectedFeedGroup = groups.find((group) => group.key === selectedFeedKey);
        if (selectedFeedGroup) {
            state.selectedChatGuildKey = selectedFeedGroup.key;
            saveState();
            return selectedFeedGroup;
        }
    }
    const selectedGroup = groups.find((group) => group.key === state.selectedChatGuildKey);
    if (selectedGroup) {
        return selectedGroup;
    }
    state.selectedChatGuildKey = groups[0].key;
    saveState();
    return groups[0];
}

function getChatGuildGroup(groupKey) {
    return getChatGuildGroups().find((group) => group.key === groupKey);
}

function getSelectedChatFeed() {
    const group = getSelectedChatGuildGroup();
    return group?.feeds.find((feed) => feed.id === state.selectedSource);
}

async function queryFeedItemsPage(feedId, offset, limit) {
    const params = new URLSearchParams();
    params.set('feedId', feedId);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (state.search) {
        params.set('search', state.search);
    }
    return readerApi('/items?' + params.toString());
}

function updateLatestChatMessageDate(feedId, items) {
    let latestItem;
    for (const item of items) {
        if (getTimestamp(item.pubDate) > getTimestamp(latestItem?.pubDate)) {
            latestItem = item;
        }
    }
    latestChatMessageDateByFeedId.set(feedId, latestItem?.pubDate || '');
}

async function ensureLatestChatMessageDates(feeds) {
    await Promise.all(
        feeds
            .filter((feed) => !latestChatMessageDateByFeedId.has(feed.id))
            .map(async (feed) => {
                try {
                    const page = await queryFeedItemsPage(feed.id, 0, 1);
                    updateLatestChatMessageDate(feed.id, page.items || []);
                } catch {
                    latestChatMessageDateByFeedId.set(feed.id, '');
                }
            })
    );
}

function getLatestChatMessageDate(feed) {
    return latestChatMessageDateByFeedId.get(feed.id) || '';
}

async function fetchFeed(feed) {
    if (fetchingFeedIds.has(feed.id)) {
        return;
    }

    fetchingFeedIds.add(feed.id);
    feed.error = '';
    renderSources();

    try {
        const response = await fetch(feed.url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('Request failed with HTTP ' + response.status + '.');
        }

        const text = await response.text();
        const parsed = parseFeed(text, response.headers.get('content-type') || '', feed.url);
        const parsedItems = normalizeParsedItems(feed, parsed.items);

        feed.title = parsed.title;
        feed.homeUrl = parsed.homeUrl;
        feed.lastFetchedAt = new Date().toISOString();
        feed.nextFetchAt = getNextFetchAt(feed);
        feed.error = '';
        if (isDiscordChannelFeed(feed)) {
            updateLatestChatMessageDate(feed.id, parsedItems);
        }
        await putItems(parsedItems);
        setStatus('Updated ' + feed.title + '.');
    } catch (error) {
        feed.error = error instanceof Error ? error.message : 'Unable to fetch this feed.';
        feed.nextFetchAt = getNextFetchAt(feed);
        setStatus(feed.error);
    } finally {
        fetchingFeedIds.delete(feed.id);
        saveState();
        renderSources();
        await renderCounts();
        await resetArticlePagination();
        await renderReader();
    }
}

async function addFeed() {
    try {
        const url = normalizeFeedUrl(elements.feedUrlInput.value);
        const existing = state.feeds.find((feed) => feed.url === url);
        if (existing) {
            state.selectedCategory = getCategory(existing.category);
            state.selectedSource = existing.id;
            setStatus('Feed already exists.');
            closeAddFeedModal();
            render();
            return;
        }

        const feed = {
            category: getCategory(elements.feedCategoryInput.value || inferCategory(url)),
            group: normalizeGroupName(elements.feedGroupInput.value),
            id: createId(url),
            lastFetchedAt: '',
            nextFetchAt: '',
            paused: false,
            refreshMinutes: getAllowedRefreshMinutes(elements.feedIntervalInput.value || defaultRefreshMinutes),
            title: new URL(url).pathname,
            url,
        };
        state.feeds.unshift(feed);
        state.selectedCategory = feed.category;
        state.selectedSource = feed.id;
        elements.feedUrlInput.value = '';
        closeAddFeedModal();
        saveState();
        await fetchFeed(feed);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to add feed.');
    }
}

async function updateFeedSettings() {
    const feed = getFeed(editingFeedId);
    if (!feed) {
        return;
    }

    const category = getCategory(elements.feedCategoryInput.value);
    feed.group = normalizeGroupName(elements.feedGroupInput.value);
    feed.category = category;
    feed.refreshMinutes = getAllowedRefreshMinutes(elements.feedIntervalInput.value);
    feed.nextFetchAt = getNextFetchAt(feed);
    await updateFeedItemsCategory(feed.id, category);
    state.selectedCategory = category;
    state.selectedSource = feed.id;
    setStatus('Updated ' + feed.title + '.');
    closeAddFeedModal();
    saveState();
    await resetArticlePagination();
    render();
}

function buildReaderConfigExport() {
    return {
        app: 'rsshub-reader',
        collapsedGroups: state.collapsedGroups,
        exportedAt: new Date().toISOString(),
        feeds: state.feeds.map((feed) => ({
            category: getCategory(feed.category || inferCategory(feed.url)),
            group: normalizeGroupName(feed.group),
            homeUrl: feed.homeUrl || '',
            paused: Boolean(feed.paused),
            refreshMinutes: getAllowedRefreshMinutes(feed.refreshMinutes),
            title: feed.title || new URL(feed.url).pathname,
            url: getPortableFeedUrl(feed.url),
        })),
        globalRefreshEnabled: state.globalRefreshEnabled,
        version: 1,
    };
}

function exportReaderConfig() {
    const json = JSON.stringify(buildReaderConfigExport(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = 'rsshub-reader-config-' + date + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus('Exported ' + state.feeds.length + ' subscriptions.');
}

function closeSettingsMenu() {
    elements.settingsMenu.hidden = true;
    elements.settingsButton.setAttribute('aria-expanded', 'false');
}

function toggleSettingsMenu() {
    const shouldOpen = elements.settingsMenu.hidden;
    elements.settingsMenu.hidden = !shouldOpen;
    elements.settingsButton.setAttribute('aria-expanded', String(shouldOpen));
}

function normalizeImportedFeed(rawFeed) {
    if (!rawFeed || typeof rawFeed !== 'object') {
        return;
    }

    const rawUrl = typeof rawFeed.url === 'string' ? rawFeed.url : typeof rawFeed.route === 'string' ? rawFeed.route : '';
    if (!rawUrl.trim()) {
        return;
    }

    const url = normalizeFeedUrl(rawUrl);
    return {
        category: getCategory(rawFeed.category || inferCategory(url)),
        group: normalizeGroupName(rawFeed.group),
        homeUrl: typeof rawFeed.homeUrl === 'string' ? rawFeed.homeUrl : '',
        id: createId(url),
        lastFetchedAt: '',
        nextFetchAt: '',
        paused: Boolean(rawFeed.paused),
        refreshMinutes: getAllowedRefreshMinutes(rawFeed.refreshMinutes),
        title: typeof rawFeed.title === 'string' && rawFeed.title.trim() ? rawFeed.title.trim() : new URL(url).pathname,
        url,
    };
}

function getImportedFeeds(data) {
    const rawFeeds = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.feeds) ? data.feeds : [];
    const importedByUrl = new Map();
    rawFeeds.forEach((rawFeed) => {
        const feed = normalizeImportedFeed(rawFeed);
        if (feed) {
            importedByUrl.set(feed.url, feed);
        }
    });
    const feeds = [];
    importedByUrl.forEach((feed) => {
        feeds.push(feed);
    });
    return feeds;
}

async function importReaderConfigFile(file) {
    if (!file) {
        return;
    }

    try {
        const data = JSON.parse(await file.text());
        const importedFeeds = getImportedFeeds(data);
        if (!importedFeeds.length) {
            throw new Error('No subscriptions were found in this config file.');
        }

        if (data && typeof data === 'object' && typeof data.globalRefreshEnabled === 'boolean') {
            state.globalRefreshEnabled = data.globalRefreshEnabled;
        }
        const existingByUrl = new Map(state.feeds.map((feed) => [feed.url, feed]));
        const importedUrls = new Set();
        const categoryUpdateTasks = [];
        const mergedFeeds = importedFeeds.map((importedFeed) => {
            importedUrls.add(importedFeed.url);
            const existing = existingByUrl.get(importedFeed.url);
            if (!existing) {
                return importedFeed;
            }

            const nextCategory = getCategory(importedFeed.category);
            if (getCategory(existing.category) !== nextCategory) {
                categoryUpdateTasks.push(updateFeedItemsCategory(existing.id, nextCategory));
            }

            return {
                ...existing,
                category: nextCategory,
                group: importedFeed.group,
                homeUrl: importedFeed.homeUrl || existing.homeUrl || '',
                nextFetchAt: existing.paused === importedFeed.paused && existing.refreshMinutes === importedFeed.refreshMinutes ? existing.nextFetchAt : getNextFetchAt(importedFeed),
                paused: importedFeed.paused,
                refreshMinutes: importedFeed.refreshMinutes,
                title: importedFeed.title || existing.title,
            };
        });

        state.feeds = [...mergedFeeds, ...state.feeds.filter((feed) => !importedUrls.has(feed.url))];
        if (data && typeof data === 'object' && data.collapsedGroups && typeof data.collapsedGroups === 'object') {
            state.collapsedGroups = {
                ...state.collapsedGroups,
                ...data.collapsedGroups,
            };
        }
        state.selectedCategory = 'all';
        state.selectedChatGuildKey = '';
        state.selectedItemId = '';
        state.selectedSource = 'all';
        await Promise.all(categoryUpdateTasks);
        saveState();
        setStatus('Imported ' + importedFeeds.length + ' subscriptions.');
        render();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Unable to import config.');
    } finally {
        elements.importConfigInput.value = '';
    }
}

function submitFeedForm() {
    if (editingFeedId) {
        void updateFeedSettings();
        return;
    }
    void addFeed();
}

function getFeed(feedId) {
    return state.feeds.find((feed) => feed.id === feedId);
}

function getTimestamp(value) {
    const time = Date.parse(value || '');
    return Number.isNaN(time) ? 0 : time;
}

async function queryItemsPage(offset, limit) {
    const params = getCurrentListParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return readerApi('/items?' + params.toString());
}

function getCurrentListParams() {
    const params = new URLSearchParams();
    if (state.selectedCategory !== 'all') {
        params.set('category', state.selectedCategory);
    }
    if (state.selectedSource !== 'all' && getFeed(state.selectedSource)) {
        params.set('feedId', state.selectedSource);
    }
    if (state.readFilter !== 'all') {
        params.set('read', state.readFilter);
    }
    if (state.search) {
        params.set('search', state.search);
    }
    return params;
}

async function getItemCounts() {
    const params = new URLSearchParams();
    if (state.selectedSource !== 'all' && getFeed(state.selectedSource)) {
        params.set('feedId', state.selectedSource);
    }
    if (state.search) {
        params.set('search', state.search);
    }
    return readerApi('/items/counts' + (params.size ? '?' + params.toString() : ''));
}

async function getFeedUnreadCounts() {
    const result = await readerApi('/feeds/unread-counts');
    return result.counts || {};
}

function getFeedUnreadCount(feedId) {
    return unreadCountByFeedId.get(feedId) || 0;
}

function getUnreadTitleText(title, unreadCount) {
    return unreadCount > 0 ? title + ' (' + unreadCount + ' unread)' : title;
}

function getChatGuildUnreadCount(group) {
    let count = 0;
    for (const feed of group.feeds) {
        count += getFeedUnreadCount(feed.id);
    }
    return count;
}

function getFeedsUnreadCount(feeds) {
    let count = 0;
    for (const feed of feeds) {
        count += getFeedUnreadCount(feed.id);
    }
    return count;
}

function formatDate(value) {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const now = new Date();
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatLastFetched(value) {
    return value ? 'Last ' + formatDate(value) : 'Not fetched yet';
}

function formatNextFetch(value) {
    if (!value) {
        return 'Queued';
    }
    const seconds = Math.ceil((new Date(value).getTime() - Date.now()) / 1000);
    if (seconds <= 0) {
        return 'Due now';
    }
    if (seconds < 60) {
        return seconds + 's';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (seconds < 3600) {
        return minutes + 'm ' + remainingSeconds + 's';
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours + 'h ' + remainingMinutes + 'm';
}

function formatNextFetchZh(value) {
    if (!value) {
        return '等待刷新';
    }
    const seconds = Math.ceil((new Date(value).getTime() - Date.now()) / 1000);
    if (seconds <= 0) {
        return '该刷新了';
    }
    if (seconds < 60) {
        return '下次刷新 ' + seconds + ' 秒后';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (seconds < 3600) {
        return '下次刷新 ' + minutes + ' 分 ' + remainingSeconds + ' 秒后';
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return '下次刷新 ' + hours + ' 小时 ' + remainingMinutes + ' 分后';
}

function setStatus(message) {
    elements.readerStatus.textContent = message;
}

function render() {
    elements.feedIntervalInput.value = String(getAllowedRefreshMinutes(elements.feedIntervalInput.value || defaultRefreshMinutes));
    elements.globalIntervalSelect.value = state.globalRefreshEnabled ? globalRefreshOnValue : globalRefreshOffValue;
    elements.searchInput.value = state.search;
    document.querySelectorAll('.read-filter-button').forEach((button) => {
        button.classList.toggle('active', button.dataset.readFilter === state.readFilter);
    });
    void renderCounts();
    renderSources();
    void resetArticlePagination();
    void renderReader();
}

async function renderCounts() {
    try {
        const [counts, feedUnreadCounts] = await Promise.all([getItemCounts(), getFeedUnreadCounts()]);
        unreadCountByFeedId.clear();
        Object.entries(feedUnreadCounts).forEach(([feedId, count]) => {
            unreadCountByFeedId.set(feedId, Number(count) || 0);
        });
        unreadCountsReady = true;
        document.querySelectorAll('[data-category-count]').forEach((countElement) => {
            countElement.textContent = String(counts[countElement.dataset.categoryCount] || 0);
        });
        renderSources();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Reader database request failed.');
    }
}

function renderSources() {
    document.querySelectorAll('.category-button').forEach((button) => {
        button.classList.toggle('active', button.dataset.category === state.selectedCategory);
    });

    elements.sourceList.innerHTML = '';
    if (isChatOnlyView()) {
        renderDiscordGuilds();
        return;
    }
    if (state.selectedCategory === 'all') {
        renderMixedSources();
        return;
    }

    const visibleFeeds = getVisibleFeeds();
    renderFeedGroups(visibleFeeds);
}

function renderMixedSources() {
    const visibleFeeds = getVisibleFeeds();
    if (!visibleFeeds.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No feeds</h2><p>Use + to add a feed to this category.</p>';
        elements.sourceList.append(empty);
        return;
    }

    renderSourceRowsByFeedGroup(visibleFeeds, createMixedSourceRows);
}

function renderSourceRowsByFeedGroup(feeds, createRows) {
    for (const group of getFeedGroups(feeds)) {
        const rows = createRows(group.feeds);
        if (!rows.length) {
            continue;
        }
        if (group.key === ungroupedGroupKey) {
            rows.forEach((row) => elements.sourceList.append(row));
            continue;
        }

        const section = createSourceGroupSection(group.label, group.key, getFeedsUnreadCount(group.feeds));
        section.querySelector('.feed-group-body')?.append(...rows);
        elements.sourceList.append(section);
    }
}

function createMixedSourceRows(feeds) {
    const rows = feeds.filter((feed) => !isDiscordChannelFeed(feed)).map((feed) => createFeedRow(feed));
    const selectedGroup = isChatView() ? getSelectedChatGuildGroup() : undefined;
    getChatGuildGroups(feeds).forEach((group) => {
        rows.push(createDiscordGuildRow(group, selectedGroup?.key));
    });
    return rows;
}

function renderFeedGroups(visibleFeeds, { showEmpty = true } = {}) {
    for (const group of getFeedGroups(visibleFeeds)) {
        if (group.key === ungroupedGroupKey) {
            group.feeds.forEach((feed) => elements.sourceList.append(createFeedRow(feed)));
            continue;
        }

        const section = createSourceGroupSection(group.label, group.key, getFeedsUnreadCount(group.feeds));
        section.querySelector('.feed-group-body')?.append(...group.feeds.map((feed) => createFeedRow(feed)));
        elements.sourceList.append(section);
    }

    if (showEmpty && !visibleFeeds.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No feeds</h2><p>Use + to add a feed to this category.</p>';
        elements.sourceList.append(empty);
    }
}

function createSourceGroupSection(label, key, count) {
    const section = document.createElement('section');
    section.className = 'feed-group';

    const collapsed = Boolean(state.collapsedGroups[key]);
    const toggle = document.createElement('button');
    toggle.className = 'feed-group-toggle';
    toggle.type = 'button';
    toggle.dataset.groupKey = key;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.append(createText('span', 'feed-group-arrow', collapsed ? '▸' : '▾'), createText('span', 'feed-group-title', label), createText('strong', 'feed-group-count', count > 0 ? String(count) : ''));
    section.append(toggle);

    if (!collapsed) {
        const body = document.createElement('div');
        body.className = 'feed-group-body';
        section.append(body);
    }
    return section;
}

function renderDiscordGuilds() {
    const discordFeeds = getVisibleFeeds().filter((feed) => isDiscordChannelFeed(feed));

    if (!discordFeeds.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No Discord channels</h2><p>Add /discord/channel/:channelId to subscribe to a channel.</p>';
        elements.sourceList.append(empty);
        return;
    }

    renderSourceRowsByFeedGroup(discordFeeds, createDiscordGuildRows);
}

function createDiscordGuildRows(feeds) {
    const selectedGroup = getSelectedChatGuildGroup();
    return getChatGuildGroups(feeds).map((group) => createDiscordGuildRow(group, selectedGroup?.key));
}

function getFeedGroups(feeds) {
    const groups = [];
    const groupMap = new Map();
    for (const feed of feeds) {
        const groupName = normalizeGroupName(feed.group);
        const key = getGroupKey(groupName);
        if (!groupMap.has(key)) {
            const group = {
                feeds: [],
                key,
                label: getGroupLabel(groupName),
            };
            groupMap.set(key, group);
            groups.push(group);
        }
        groupMap.get(key).feeds.push(feed);
    }
    return groups;
}

function createDiscordGuildRow(group, selectedKey) {
    const unreadCount = getChatGuildUnreadCount(group);
    const row = document.createElement('div');
    row.className = 'feed-row discord-guild-row';
    row.classList.toggle('active', selectedKey === group.key);
    row.classList.toggle('no-unread', unreadCountsReady && unreadCount === 0);

    const button = document.createElement('button');
    button.className = 'feed-button';
    button.type = 'button';
    button.dataset.chatGuildKey = group.key;
    button.append(createText('span', 'feed-title', getUnreadTitleText(group.label, unreadCount)), createText('span', 'feed-meta', group.feeds.length + ' channel' + (group.feeds.length === 1 ? '' : 's')));

    const actions = document.createElement('div');
    actions.className = 'feed-actions';
    actions.append(createChatGuildAction('summarize-chat-guild', group.key, 'AI', 'AI summary'), createChatGuildAction('edit-chat-guild', group.key, '⚙️', 'Edit first channel settings'));

    row.append(button, actions);
    return row;
}

function createChatGuildAction(action, groupKey, text, label) {
    const button = document.createElement('button');
    button.className = 'feed-action';
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.chatGuildKey = groupKey;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = text;
    return button;
}

function createFeedRow(feed) {
    const unreadCount = getFeedUnreadCount(feed.id);
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.classList.toggle('active', state.selectedSource === feed.id);
    row.classList.toggle('no-unread', unreadCountsReady && unreadCount === 0);

    const button = document.createElement('button');
    button.className = 'feed-button';
    button.type = 'button';
    button.dataset.feedId = feed.id;

    const title = document.createElement('span');
    title.className = 'feed-title';
    title.textContent = getUnreadTitleText(feed.title || feed.url, unreadCount);

    const meta = document.createElement('span');
    meta.className = 'feed-meta';
    meta.textContent = getFeedMetaText(feed);

    const error = document.createElement('span');
    error.className = 'feed-meta feed-error';
    error.textContent = feed.error || '';

    button.append(title, meta);
    if (feed.error) {
        button.append(error);
    }

    const actions = document.createElement('div');
    actions.className = 'feed-actions';
    actions.append(
        createFeedAction('toggle-pause-feed', feed.id, feed.paused ? '▶' : '⏸', feed.paused ? 'Resume refresh' : 'Pause refresh'),
        createFeedAction('summarize-feed', feed.id, 'AI', 'AI summary'),
        createFeedAction('edit-feed', feed.id, '⚙️', 'Feed settings')
    );

    row.append(button, actions);
    return row;
}

function getFeedMetaText(feed) {
    if (fetchingFeedIds.has(feed.id)) {
        return 'Refreshing...';
    }
    if (feed.paused) {
        return categoryLabels[getCategory(feed.category)] + ' / Paused';
    }
    if (!state.globalRefreshEnabled) {
        return categoryLabels[getCategory(feed.category)] + ' / OFF';
    }
    return categoryLabels[getCategory(feed.category)] + ' / Next ' + formatNextFetch(feed.nextFetchAt);
}

function getChatFeedMetaText(feed) {
    if (fetchingFeedIds.has(feed.id)) {
        return '正在刷新';
    }
    const lastFetchedText = feed.lastFetchedAt ? ' / ' + formatLastFetched(feed.lastFetchedAt) : '';
    if (feed.paused) {
        return '已暂停' + lastFetchedText;
    }
    if (!state.globalRefreshEnabled) {
        return '自动刷新已关闭' + lastFetchedText;
    }
    return formatNextFetchZh(feed.nextFetchAt) + lastFetchedText;
}

function createFeedAction(action, feedId, text, label) {
    const button = document.createElement('button');
    button.className = 'feed-action';
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.feedId = feedId;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = text;
    return button;
}

async function resetArticlePagination() {
    renderToken += 1;
    articleOffset = 0;
    hasMoreArticles = true;
    elements.articleList.innerHTML = '';
    if (isChatView()) {
        await renderChatChannels();
        await renderChatMessages();
        return;
    }
    await loadMoreArticles(renderToken);
}

async function loadMoreArticles(token = renderToken) {
    if (isLoadingArticles || !hasMoreArticles) {
        return;
    }

    isLoadingArticles = true;
    let page;
    try {
        page = await queryItemsPage(articleOffset, articlePageSize);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Reader database request failed.');
        renderArticles([], false);
        isLoadingArticles = false;
        return;
    }
    if (token !== renderToken) {
        isLoadingArticles = false;
        return;
    }
    hasMoreArticles = page.hasMore;
    articleOffset += page.items.length;
    renderArticles(page.items, articleOffset > page.items.length);
    isLoadingArticles = false;
}

function renderArticles(items, append = false) {
    if (!append) {
        elements.articleList.innerHTML = '';
    }

    if (!items.length && !append) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No articles</h2><p>Feeds will appear here after the first successful refresh.</p>';
        elements.articleList.append(empty);
        return;
    }

    for (const item of items) {
        const feed = getFeed(item.feedId);
        const button = document.createElement('button');
        button.className = 'article-card';
        button.classList.toggle('unread', !item.isRead);
        button.classList.toggle('active', item.id === state.selectedItemId);
        button.type = 'button';
        button.dataset.itemId = item.id;

        const topLine = document.createElement('div');
        topLine.className = 'article-topline';
        const sourceWrap = document.createElement('span');
        sourceWrap.className = 'article-source-wrap';
        if (!item.isRead) {
            sourceWrap.append(createText('span', 'unread-dot', ''));
        }
        sourceWrap.append(createText('span', 'article-source', feed?.title || 'Unknown source'));
        topLine.append(sourceWrap, createText('span', 'article-date', formatDate(item.pubDate)));

        const title = createText('h2', 'article-title', item.title);
        const summary = createText('p', 'article-summary', item.summary || stripHtml(item.description));

        const footer = document.createElement('div');
        footer.className = 'article-footer';
        footer.append(createText('span', '', item.author || item.categories?.[0] || ''), createText('span', item.isStarred ? 'star' : '', item.isStarred ? '*' : ''));

        button.append(topLine, title, summary, footer);
        elements.articleList.append(button);
    }
}

async function renderChatChannels() {
    elements.articleList.innerHTML = '';

    const group = getSelectedChatGuildGroup();
    if (!group) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No channels</h2><p>Add /discord/channel/:channelId to subscribe to a Discord channel.</p>';
        elements.articleList.append(empty);
        return;
    }

    const query = state.search.toLowerCase();
    const visibleChannels = query ? group.feeds.filter((feed) => [feed.channelName, feed.title, feed.error].join(' ').toLowerCase().includes(query)) : group.feeds;
    if (!visibleChannels.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No channels</h2><p>No subscribed Discord channels match this view.</p>';
        elements.articleList.append(empty);
        return;
    }

    await ensureLatestChatMessageDates(visibleChannels);
    for (const feed of visibleChannels) {
        const unreadCount = getFeedUnreadCount(feed.id);
        const card = document.createElement('div');
        card.className = 'article-card discord-channel-card';
        card.classList.toggle('active', feed.id === state.selectedSource);
        card.classList.toggle('no-unread', unreadCountsReady && unreadCount === 0);
        card.dataset.chatFeedId = feed.id;

        const topLine = document.createElement('div');
        topLine.className = 'article-topline';
        const latestMessageDate = formatDate(getLatestChatMessageDate(feed));
        topLine.append(createText('span', 'article-source', feed.guildName), createText('span', 'article-date', latestMessageDate));

        const title = createText('h2', 'article-title', getUnreadTitleText(feed.channelName, unreadCount));
        const summary = createText('p', 'article-summary', feed.error || getChatFeedMetaText(feed));
        const footer = document.createElement('div');
        footer.className = 'article-footer';
        const actions = document.createElement('div');
        actions.className = 'feed-actions';
        actions.append(
            createFeedAction('toggle-pause-feed', feed.id, feed.paused ? '▶' : '⏸', feed.paused ? 'Resume refresh' : 'Pause refresh'),
            createFeedAction('summarize-feed', feed.id, 'AI', 'AI summary'),
            createFeedAction('edit-feed', feed.id, '⚙️', 'Feed settings')
        );
        footer.append(createText('span', '', ''), actions);

        card.append(topLine, title, summary, footer);
        elements.articleList.append(card);
    }
}

function updateArticleCardReadState(itemId, isRead) {
    document.querySelectorAll('.article-card').forEach((card) => {
        if (card.dataset.itemId !== itemId) {
            return;
        }
        card.classList.toggle('unread', !isRead);
        card.querySelector('.unread-dot')?.remove();
    });
}

function createText(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    element.textContent = text;
    return element;
}

async function renderReader({ markRead = true } = {}) {
    if (isChatView()) {
        await renderChatMessages();
        return;
    }

    const item = await getItem(state.selectedItemId);
    elements.readerPane.innerHTML = '';

    if (!item) {
        const empty = document.createElement('div');
        empty.className = 'empty-pane';
        empty.innerHTML = '<h2>No article selected</h2><p>Add a feed or choose an article from the list.</p>';
        elements.readerPane.append(empty);
        return;
    }

    if (markRead && !item.isRead) {
        item.isRead = true;
        await updateItem(item);
        await renderCounts();
        if (state.readFilter === 'unread') {
            await resetArticlePagination();
        } else {
            updateArticleCardReadState(item.id, true);
        }
    }

    const feed = getFeed(item.feedId);
    const header = document.createElement('header');
    header.className = 'reader-header';

    const title = createText('h2', '', item.title);
    const meta = document.createElement('div');
    meta.className = 'reader-meta';
    meta.append(createText('span', '', feed?.title || 'Unknown source'), createText('span', '', formatDate(item.pubDate)), createText('span', '', item.author || ''));

    const actions = document.createElement('div');
    actions.className = 'reader-actions';
    actions.append(createReaderButton('toggle-read', item.isRead ? 'Mark unread' : 'Mark read'), createReaderButton('toggle-star', item.isStarred ? 'Unstar' : 'Star'));
    if (item.link) {
        const link = document.createElement('a');
        link.className = 'reader-action';
        link.href = item.link;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Open source';
        actions.append(link);
    }

    header.append(title, meta, actions);

    const frame = document.createElement('iframe');
    frame.className = 'content-frame';
    frame.title = 'Article content';
    frame.setAttribute('sandbox', '');
    frame.srcdoc = buildArticleDocument(item);

    elements.readerPane.append(header, frame);
}

async function renderChatMessages() {
    elements.readerPane.innerHTML = '';

    const feed = getSelectedChatFeed();
    if (!feed) {
        const empty = document.createElement('div');
        empty.className = 'empty-pane';
        empty.innerHTML = '<h2>No channel selected</h2><p>Choose a Discord channel to show its messages.</p>';
        elements.readerPane.append(empty);
        return;
    }

    const header = document.createElement('header');
    header.className = 'reader-header discord-message-header';
    header.append(createText('h2', '', feed.channelName));

    const meta = document.createElement('div');
    meta.className = 'reader-meta';
    meta.append(createText('span', '', feed.guildName), createText('span', '', fetchingFeedIds.has(feed.id) ? 'Refreshing messages' : formatLastFetched(feed.lastFetchedAt)));

    const actions = document.createElement('div');
    actions.className = 'reader-actions';
    const refresh = createReaderButton('refresh-discord-channel', 'Refresh');
    const markRead = createReaderButton('mark-discord-channel-read', 'Mark read');
    actions.append(refresh, markRead);

    header.append(meta, actions);
    elements.readerPane.append(header);

    const body = document.createElement('div');
    body.className = 'discord-message-list';
    elements.readerPane.append(body);

    if (fetchingFeedIds.has(feed.id)) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>Refreshing messages</h2><p>Fetching the latest channel messages.</p>';
        body.append(empty);
        return;
    }

    let page;
    try {
        page = await queryFeedItemsPage(feed.id, 0, 100);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Reader database request failed.');
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>Unable to load messages</h2><p>Refresh this channel and try again.</p>';
        body.append(empty);
        return;
    }

    if (!page.items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No messages</h2><p>Refresh this channel to fetch its latest messages.</p>';
        body.append(empty);
        return;
    }

    let roleOverrides = {};
    try {
        roleOverrides = await lookupDiscordAuthorRoles(
            getSelectedChatGuildRoleKey(),
            page.items.map((message) => message.author)
        );
    } catch (error) {
        setStatus(error instanceof Error ? error.message : '读取成员角色标记失败。');
    }
    for (const message of page.items) {
        body.append(createDiscordMessageCard(message, roleOverrides));
    }
}

function createDiscordMessageCard(message, roleOverrides = {}) {
    const messageRole = getDiscordMessageRole(message, roleOverrides);
    const article = document.createElement('article');
    article.className = 'discord-message-card discord-message-' + messageRole;
    article.dataset.discordAuthor = message.author || '';

    const avatar = createText('div', 'discord-message-avatar', getDiscordAuthorInitial(message.author));

    const content = document.createElement('div');
    content.className = 'discord-message-content';

    const meta = document.createElement('div');
    meta.className = 'discord-message-meta';
    meta.append(
        createText('span', 'discord-message-time', formatDate(message.pubDate)),
        createText('span', 'discord-message-badge', getDiscordRoleLabel(messageRole)),
        createText('span', 'discord-message-author', message.author || 'Discord')
    );

    const main = document.createElement('div');
    main.className = 'discord-message-main';

    const bubble = document.createElement('div');
    bubble.className = 'discord-message-bubble';
    const body = document.createElement('div');
    body.className = 'discord-message-body';
    body.innerHTML = message.description || '<p>' + escapeHtml(message.summary || message.title || '') + '</p>';

    const actions = document.createElement('div');
    actions.className = 'discord-message-actions';
    const roleButton = document.createElement('button');
    roleButton.className = 'discord-message-icon-button';
    roleButton.type = 'button';
    roleButton.dataset.action = 'open-discord-role-menu';
    roleButton.dataset.author = message.author || '';
    roleButton.dataset.role = messageRole;
    roleButton.title = '标记成员角色';
    roleButton.setAttribute('aria-label', '标记成员角色');
    roleButton.textContent = '◐';
    actions.append(roleButton);
    if (message.link) {
        const link = document.createElement('a');
        link.className = 'discord-message-icon-button';
        link.href = message.link;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.title = '打开原消息';
        link.setAttribute('aria-label', '打开原消息');
        link.textContent = '↗';
        actions.append(link);
    }

    bubble.append(body);
    main.append(bubble, actions);
    content.append(meta, main);
    article.append(avatar, content);
    return article;
}

function getSelectedChatGuildRoleKey() {
    const group = getSelectedChatGuildGroup();
    return group?.key || '';
}

function getDiscordMessageRole(message, roleOverrides = {}) {
    const override = roleOverrides[message.author || ''];
    if (['admin', 'bot', 'user'].includes(override)) {
        return override;
    }
    const roleCategory = message.categories?.find((category) => category.startsWith('discord-role:')) || '';
    const role = roleCategory.split(':', 2)[1];
    return ['admin', 'bot', 'user'].includes(role) ? role : 'user';
}

function getDiscordRoleLabel(role) {
    return {
        admin: '管理员',
        bot: '机器人',
        user: '成员',
    }[role];
}

function getDiscordRoleOptions() {
    return [
        { label: '管理员', role: 'admin' },
        { label: '机器人', role: 'bot' },
        { label: '成员', role: 'user' },
    ];
}

function closeDiscordRolePopover() {
    discordRolePopover?.remove();
    discordRolePopover = undefined;
}

function openDiscordRolePopover(anchor, author, currentRole) {
    closeDiscordRolePopover();
    if (!author) {
        setStatus('这个消息没有可标记的作者。');
        return;
    }

    const popover = document.createElement('div');
    popover.className = 'discord-role-popover';
    popover.dataset.author = author;
    popover.append(createText('strong', 'discord-role-popover-title', author));

    const options = document.createElement('div');
    options.className = 'discord-role-options';
    for (const option of getDiscordRoleOptions()) {
        const button = document.createElement('button');
        button.className = 'discord-role-option';
        button.classList.toggle('active', option.role === currentRole);
        button.type = 'button';
        button.dataset.action = 'set-discord-author-role';
        button.dataset.author = author;
        button.dataset.role = option.role;
        button.textContent = option.label;
        options.append(button);
    }
    popover.append(options);
    document.body.append(popover);

    const rect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const top = Math.min(rect.bottom + 8, window.innerHeight - popoverRect.height - 12);
    const left = Math.min(Math.max(12, rect.right - popoverRect.width), window.innerWidth - popoverRect.width - 12);
    popover.style.top = Math.max(12, top) + 'px';
    popover.style.left = left + 'px';
    discordRolePopover = popover;
}

function getDiscordAuthorInitial(author) {
    const name = String(author || 'D').trim();
    return name.charAt(0).toUpperCase();
}

function createReaderButton(action, text) {
    const button = document.createElement('button');
    button.className = 'reader-action';
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = text;
    return button;
}

function buildArticleDocument(item) {
    const content = item.description || '<p>' + escapeHtml(item.summary || item.title) + '</p>';
    return String.raw`<!doctype html>
<html>
    <head>
        <base target="_blank">
        <style>
            body {
                margin: 0;
                color: #1e2528;
                background: #fffdf9;
                font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
                font-size: 18px;
                line-height: 1.72;
            }
            article {
                max-width: 820px;
                margin: 0 auto;
                padding: 30px 28px 64px;
            }
            img, video, iframe {
                max-width: 100%;
            }
            pre {
                overflow: auto;
                padding: 14px;
                background: #f2eee7;
            }
            code {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 0.9em;
            }
            a {
                color: #315f9d;
            }
            blockquote {
                margin-left: 0;
                border-left: 3px solid #e85d2a;
                padding-left: 16px;
                color: #526066;
            }
        </style>
    </head>
    <body>
        <article>${content}</article>
    </body>
</html>`;
}

function selectItem(itemId) {
    state.selectedItemId = itemId;
    saveState();
    document.querySelectorAll('.article-card').forEach((card) => {
        card.classList.toggle('active', card.dataset.itemId === itemId);
    });
    void renderReader();
}

async function deleteFeed(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    state.feeds = state.feeds.filter((currentFeed) => currentFeed.id !== feedId);
    await deleteFeedItems(feedId);
    if (state.selectedSource === feedId) {
        state.selectedSource = 'all';
    }
    const selectedItem = await getItem(state.selectedItemId);
    if (!selectedItem) {
        state.selectedItemId = '';
    }
    setStatus('Deleted ' + feed.title + '.');
    saveState();
    await resetArticlePagination();
    render();
}

function toggleFeedPaused(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    feed.paused = !feed.paused;
    if (!feed.paused) {
        feed.nextFetchAt = getNextFetchAt(feed);
    }
    setStatus((feed.paused ? 'Paused ' : 'Resumed ') + feed.title + '.');
    saveState();
    render();
}

function refreshSelected() {
    if (isChatView()) {
        const selectedFeed = getSelectedChatFeed();
        if (selectedFeed) {
            void fetchFeed(selectedFeed);
            return;
        }
        getSelectedChatGuildGroup()?.feeds.forEach((feed) => {
            void fetchFeed(feed);
        });
        return;
    }

    if (state.selectedSource !== 'all') {
        const feed = getFeed(state.selectedSource);
        if (feed) {
            void fetchFeed(feed);
        }
        return;
    }
    getVisibleFeeds().forEach((feed) => {
        void fetchFeed(feed);
    });
}

function getVisibleFeeds() {
    return state.feeds.filter((feed) => state.selectedCategory === 'all' || getCategory(feed.category) === state.selectedCategory);
}

function openAddFeedModal(feedId = '') {
    const feed = getFeed(feedId);
    editingFeedId = feed?.id || '';
    elements.feedModalTitle.textContent = feed ? '设置订阅' : '添加订阅';
    elements.addFeedButton.textContent = feed ? 'Save' : 'Add';
    elements.deleteFeedButton.hidden = !feed;
    elements.feedUrlInput.disabled = Boolean(feed);
    elements.feedUrlInput.value = feed?.url || '';
    elements.feedGroupInput.value = feed?.group || '';
    elements.feedIntervalInput.value = String(getAllowedRefreshMinutes(feed?.refreshMinutes || defaultRefreshMinutes));
    elements.feedCategoryInput.value = feed ? getCategory(feed.category) : state.selectedCategory === 'all' ? 'articles' : getCategory(state.selectedCategory);
    elements.addFeedModal.hidden = false;
    window.setTimeout(() => (feed ? elements.feedCategoryInput : elements.feedUrlInput).focus(), 0);
}

function closeAddFeedModal() {
    editingFeedId = '';
    elements.deleteFeedButton.hidden = true;
    elements.feedUrlInput.disabled = false;
    elements.feedUrlInput.value = '';
    elements.feedGroupInput.value = '';
    elements.addFeedModal.hidden = true;
}

function openAiSummaryModal(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    openAiSummaryForFeeds([feed.id], feed.title || feed.url);
}

function openAiSummaryForFeeds(feedIds, title) {
    summarizingFeedId = feedIds[0] || '';
    summarizingFeedIds = feedIds;
    summarizingTitle = title;
    elements.aiSummaryFeedTitle.textContent = title;
    elements.aiSummaryRangeInput.value = '1';
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '选择范围后生成该订阅源的摘要。'));
    elements.aiSummaryModal.hidden = false;
    window.setTimeout(() => elements.aiSummaryRangeInput.focus(), 0);
}

function closeAiSummaryModal() {
    summarizingFeedId = '';
    summarizingFeedIds = [];
    summarizingTitle = '';
    elements.aiSummaryModal.hidden = true;
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '选择范围后生成该订阅源的摘要。'));
}

function renderAiSummaryResult(data) {
    elements.aiSummaryResult.replaceChildren();
    const daysText = '最近 ' + data.days + ' 天';
    elements.aiSummaryResult.append(createText('p', 'ai-summary-meta', daysText + ' / ' + data.itemCount + ' 条内容'));

    if (!data.itemCount) {
        elements.aiSummaryResult.append(createText('p', 'ai-summary-placeholder', '这个范围内还没有可总结的数据。'));
        return;
    }

    if (data.summary) {
        elements.aiSummaryResult.append(createText('pre', 'ai-summary-text', data.summary));
        return;
    }

    elements.aiSummaryResult.append(createText('p', 'ai-summary-placeholder', data.message || 'AI 总结接口未配置。'));
    const prompt = document.createElement('textarea');
    prompt.className = 'ai-summary-prompt';
    prompt.readOnly = true;
    prompt.value = data.prompt || '';
    elements.aiSummaryResult.append(prompt);
}

async function submitAiSummary(event) {
    event.preventDefault();
    const feedIds = summarizingFeedIds.length ? summarizingFeedIds : summarizingFeedId ? [summarizingFeedId] : [];
    if (!feedIds.length) {
        return;
    }

    const days = Number(elements.aiSummaryRangeInput.value) === 7 ? 7 : 1;
    elements.runAiSummaryButton.disabled = true;
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '正在收集内容并生成总结...'));
    try {
        const result = await getAiSummaryForFeeds(feedIds, days);
        renderAiSummaryResult(result);
        setStatus('AI summary ready for ' + summarizingTitle + '.');
    } catch (error) {
        elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-error', error instanceof Error ? error.message : 'AI summary failed.'));
    } finally {
        elements.runAiSummaryButton.disabled = false;
    }
}

function tick() {
    renderSources();
    if (isChatView()) {
        void renderChatChannels();
    }
    if (document.visibilityState === 'hidden') {
        return;
    }

    const now = Date.now();
    if (!state.globalRefreshEnabled) {
        return;
    }
    state.feeds.forEach((feed) => {
        if (feed.paused) {
            return;
        }
        const next = Date.parse(feed.nextFetchAt || '');
        if (!feed.nextFetchAt || Number.isNaN(next) || next <= now) {
            void fetchFeed(feed);
        }
    });
}

function bindEvents() {
    elements.addFeedForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitFeedForm();
    });
    elements.aiSummaryForm.addEventListener('submit', submitAiSummary);
    elements.settingsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSettingsMenu();
    });
    elements.exportConfigButton.addEventListener('click', () => {
        closeSettingsMenu();
        exportReaderConfig();
    });
    elements.importConfigButton.addEventListener('click', () => {
        closeSettingsMenu();
        elements.importConfigInput.click();
    });
    elements.importConfigInput.addEventListener('change', () => {
        void importReaderConfigFile(elements.importConfigInput.files?.[0]);
    });
    elements.openAddFeedButton.addEventListener('click', openAddFeedModal);
    elements.cancelAddFeedButton.addEventListener('click', closeAddFeedModal);
    elements.cancelAiSummaryButton.addEventListener('click', closeAiSummaryModal);
    elements.closeAddFeedButton.addEventListener('click', closeAddFeedModal);
    elements.closeAiSummaryButton.addEventListener('click', closeAiSummaryModal);
    elements.deleteFeedButton.addEventListener('click', () => {
        const feedId = editingFeedId;
        closeAddFeedModal();
        void deleteFeed(feedId);
    });
    elements.addFeedModal.addEventListener('click', (event) => {
        if (event.target === elements.addFeedModal) {
            closeAddFeedModal();
        }
    });
    elements.aiSummaryModal.addEventListener('click', (event) => {
        if (event.target === elements.aiSummaryModal) {
            closeAiSummaryModal();
        }
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.sidebar-settings')) {
            closeSettingsMenu();
        }
        const roleOption = event.target.closest('[data-action="set-discord-author-role"]');
        if (roleOption) {
            event.preventDefault();
            const author = roleOption.dataset.author || '';
            const role = roleOption.dataset.role || 'user';
            const guildId = getSelectedChatGuildRoleKey();
            closeDiscordRolePopover();
            void saveDiscordAuthorRole(guildId, author, role)
                .then(() => {
                    setStatus('已将 ' + author + ' 标记为' + getDiscordRoleLabel(role) + '。');
                    return renderChatMessages();
                })
                .catch((error) => {
                    setStatus(error instanceof Error ? error.message : '保存成员角色失败。');
                });
            return;
        }
        if (!event.target.closest('.discord-role-popover') && !event.target.closest('[data-action="open-discord-role-menu"]')) {
            closeDiscordRolePopover();
        }
    });
    elements.feedUrlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeAddFeedModal();
        }
    });
    elements.feedUrlInput.addEventListener('input', () => {
        if (!editingFeedId) {
            elements.feedCategoryInput.value = inferCategory(elements.feedUrlInput.value);
        }
    });
    elements.globalIntervalSelect.addEventListener('change', () => {
        state.globalRefreshEnabled = elements.globalIntervalSelect.value === globalRefreshOnValue;
        state.feeds = state.feeds.map((feed) => ({
            ...feed,
            nextFetchAt: getNextFetchAt(feed),
        }));
        saveState();
        render();
    });
    elements.searchInput.addEventListener('input', () => {
        state.search = elements.searchInput.value;
        saveState();
        void resetArticlePagination();
    });
    document.querySelectorAll('.read-filter-button').forEach((button) => {
        button.addEventListener('click', () => {
            state.readFilter = getReadFilter(button.dataset.readFilter || 'all');
            saveState();
            render();
        });
    });
    elements.refreshButton.addEventListener('click', refreshSelected);
    elements.markAllReadButton.addEventListener('click', () => {
        void markCurrentListRead();
    });
    document.querySelectorAll('.category-button').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedCategory = getCategory(button.dataset.category || 'all', true);
            state.selectedSource = 'all';
            state.selectedItemId = '';
            saveState();
            render();
        });
    });
    elements.sourceList.addEventListener('click', (event) => {
        const groupToggle = event.target.closest('[data-group-key]');
        if (groupToggle) {
            const groupKey = groupToggle.dataset.groupKey;
            state.collapsedGroups = {
                ...state.collapsedGroups,
                [groupKey]: !state.collapsedGroups[groupKey],
            };
            saveState();
            renderSources();
            return;
        }

        const chatActionButton = event.target.closest('[data-action][data-chat-guild-key]');
        const actionGroup = chatActionButton?.dataset.chatGuildKey ? getChatGuildGroup(chatActionButton.dataset.chatGuildKey) : undefined;
        if (chatActionButton?.dataset.action === 'summarize-chat-guild' && actionGroup) {
            openAiSummaryForFeeds(
                actionGroup.feeds.map((feed) => feed.id),
                actionGroup.label
            );
            return;
        }
        if (chatActionButton?.dataset.action === 'edit-chat-guild' && actionGroup?.feeds[0]) {
            openAddFeedModal(actionGroup.feeds[0].id);
            return;
        }

        const guildButton = event.target.closest('[data-chat-guild-key]');
        if (guildButton?.dataset.chatGuildKey) {
            const nextSource = isChatOnlyView() ? 'all' : getChatGuildSourceId(guildButton.dataset.chatGuildKey);
            if (state.selectedChatGuildKey === guildButton.dataset.chatGuildKey && state.selectedSource === nextSource) {
                return;
            }
            state.selectedChatGuildKey = guildButton.dataset.chatGuildKey;
            state.selectedSource = nextSource;
            state.selectedItemId = '';
            saveState();
            render();
            return;
        }

        if (isChatOnlyView()) {
            return;
        }

        const actionButton = event.target.closest('[data-action]');
        if (actionButton?.dataset.action === 'toggle-pause-feed') {
            toggleFeedPaused(actionButton.dataset.feedId);
            return;
        }
        if (actionButton?.dataset.action === 'summarize-feed') {
            openAiSummaryModal(actionButton.dataset.feedId);
            return;
        }
        if (actionButton?.dataset.action === 'edit-feed') {
            openAddFeedModal(actionButton.dataset.feedId);
            return;
        }
        const feedButton = event.target.closest('.feed-button');
        if (feedButton?.dataset.feedId) {
            if (state.selectedSource === feedButton.dataset.feedId) {
                return;
            }
            state.selectedSource = feedButton.dataset.feedId;
            if (isDiscordChannelFeed(getFeed(feedButton.dataset.feedId))) {
                state.selectedChatGuildKey = getDiscordGuildIdFromHomeUrl(getFeed(feedButton.dataset.feedId)) || state.selectedChatGuildKey;
            }
            saveState();
            render();
            return;
        }
        if (!event.target.closest('.feed-row')) {
            if (state.selectedSource === 'all') {
                return;
            }
            state.selectedSource = 'all';
            saveState();
            render();
        }
    });
    elements.articleList.addEventListener('click', (event) => {
        if (isChatView()) {
            const actionButton = event.target.closest('[data-action]');
            if (actionButton?.dataset.action === 'toggle-pause-feed') {
                toggleFeedPaused(actionButton.dataset.feedId);
                return;
            }
            if (actionButton?.dataset.action === 'summarize-feed') {
                openAiSummaryModal(actionButton.dataset.feedId);
                return;
            }
            if (actionButton?.dataset.action === 'edit-feed') {
                openAddFeedModal(actionButton.dataset.feedId);
                return;
            }

            const card = event.target.closest('[data-chat-feed-id]');
            if (!card?.dataset.chatFeedId) {
                return;
            }
            state.selectedSource = card.dataset.chatFeedId;
            state.selectedItemId = '';
            saveState();
            document.querySelectorAll('.discord-channel-card').forEach((channelCard) => {
                channelCard.classList.toggle('active', channelCard.dataset.chatFeedId === state.selectedSource);
            });
            void renderChatMessages();
            return;
        }

        const card = event.target.closest('.article-card');
        if (card?.dataset.itemId) {
            selectItem(card.dataset.itemId);
        }
    });
    elements.articleList.addEventListener('scroll', () => {
        if (isChatView()) {
            return;
        }
        const remaining = elements.articleList.scrollHeight - elements.articleList.scrollTop - elements.articleList.clientHeight;
        if (remaining < 160) {
            void loadMoreArticles();
        }
    });
    elements.readerPane.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-action]');
        if (isChatView()) {
            const feed = getSelectedChatFeed();
            if (actionButton?.dataset.action === 'refresh-discord-channel' && feed) {
                void fetchFeed(feed);
                return;
            }
            if (actionButton?.dataset.action === 'mark-discord-channel-read' && feed) {
                void markSelectedChatChannelRead(feed);
                return;
            }
            if (actionButton?.dataset.action === 'open-discord-role-menu') {
                event.preventDefault();
                event.stopPropagation();
                openDiscordRolePopover(actionButton, actionButton.dataset.author || '', actionButton.dataset.role || 'user');
            }
            return;
        }

        const item = await getItem(state.selectedItemId);
        if (!actionButton || !item) {
            return;
        }
        if (actionButton.dataset.action === 'toggle-read') {
            item.isRead = !item.isRead;
        }
        if (actionButton.dataset.action === 'toggle-star') {
            item.isStarred = !item.isStarred;
        }
        await updateItem(item);
        await renderCounts();
        await resetArticlePagination();
        await renderReader({ markRead: false });
    });
}

async function initialize() {
    try {
        await migrateLegacyItems();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Reader database request failed.');
    }
    bindEvents();
    if (shouldPersistLoadedState) {
        saveState();
    }
    render();
    window.setInterval(tick, 1000);
}

void initialize();
