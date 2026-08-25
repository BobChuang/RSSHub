/* oxlint-disable eslint-js/no-implicit-globals eslint/require-await eslint/no-unused-vars unicorn/no-array-callback-reference unicorn/no-array-for-each unicorn/no-useless-fallback-in-spread unicorn/numeric-separators-style unicorn/prefer-code-point unicorn/prefer-query-selector unicorn/prefer-set-has unicorn/prefer-string-replace-all unicorn-js/no-computed-property-existence-check unicorn-js/prefer-else-if */

const storageKey = 'rsshub-reader-state-v1';
const legacyArticleCleanupKey = 'rsshub-reader-legacy-article-cleanup-v1';
const serverFeedBootstrapKey = 'rsshub-reader-server-feed-bootstrap-v1';
const articlePageSize = 50;
const defaultRefreshMinutes = 5;
const globalRefreshOffValue = 'off';
const globalRefreshOnValue = 'on';
const chatGuildSourcePrefix = 'chat-guild:';
const ungroupedGroupKey = '__ungrouped__';
const ungroupedGroupLabel = '未分组';
const defaultAiSummaryPrompt = [
    '请用中文总结这个 RSS 订阅源最近 {{days}} 天的内容。',
    '要求：',
    '1. 先给出 3-6 条核心要点。',
    '2. 再列出主要趋势或重复出现的主题。',
    '3. 最后列出最值得打开阅读的 3-5 篇，并说明理由。',
    '',
    '不总结：',
    '1. 安全提醒与垃圾/诈骗信息信息',
].join('\n');
const defaultMultiAiSummaryPrompt = [
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
const defaultEventMonitorPrompt = [
    '识别需要产品、运营或研发团队关注的真实产品事件。',
    '重点包括：功能异常、崩溃、服务不可用、登录或支付失败、钱包或数据异常、API 错误、性能问题、安全问题、诈骗风险以及新版本回归。',
    '忽略：营销推广、价格讨论、普通问答、功能建议、无事实依据的情绪表达，以及仅仅提到产品名称的内容。',
    '只有内容明确描述已经发生的问题、异常或风险时，才判定为事件。',
].join('\n');
const defaultAiSummaryPushTime = '09:00';
const aiSummaryPushSummaryMode = 'summary';
const aiSummaryPushRealtimeMode = 'realtime';
const aiSummaryPushEventMode = 'event';
const aiSummaryPushWeekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const categoryIds = ['articles', 'social', 'chat', 'videos', 'notifications'];
const derivedCategoryIds = ['events'];
const categoryLabels = {
    all: '全部',
    articles: '文章',
    chat: '聊天',
    events: '事件',
    notifications: '通知',
    social: '社媒',
    videos: '视频',
};

const elements = {
    addFeedButton: document.querySelector('#addFeedButton'),
    addFeedForm: document.querySelector('#addFeedForm'),
    addFeedModal: document.querySelector('#addFeedModal'),
    aiSummaryFeedTitle: document.querySelector('#aiSummaryFeedTitle'),
    aiSummaryChannelField: document.querySelector('#aiSummaryChannelField'),
    aiSummaryChannelList: document.querySelector('#aiSummaryChannelList'),
    aiSummaryForm: document.querySelector('#aiSummaryForm'),
    aiSummaryModal: document.querySelector('#aiSummaryModal'),
    aiSummaryPromptInput: document.querySelector('#aiSummaryPromptInput'),
    aiSummaryPushCadenceInput: document.querySelector('#aiSummaryPushCadenceInput'),
    aiSummaryPushDaysInput: document.querySelector('#aiSummaryPushDaysInput'),
    aiSummaryPushDedupeMinutesInput: document.querySelector('#aiSummaryPushDedupeMinutesInput'),
    aiSummaryPushEditor: document.querySelector('#aiSummaryPushEditor'),
    aiSummaryPushEditorTitle: document.querySelector('#aiSummaryPushEditorTitle'),
    aiSummaryPushEnabledInput: document.querySelector('#aiSummaryPushEnabledInput'),
    aiSummaryPushEventFields: document.querySelector('#aiSummaryPushEventFields'),
    aiSummaryPushList: document.querySelector('#aiSummaryPushList'),
    aiSummaryPushModeInput: document.querySelector('#aiSummaryPushModeInput'),
    aiSummaryPushMinimumSeverityInput: document.querySelector('#aiSummaryPushMinimumSeverityInput'),
    aiSummaryPushPromptLabel: document.querySelector('#aiSummaryPushPromptLabel'),
    aiSummaryPushPromptInput: document.querySelector('#aiSummaryPushPromptInput'),
    aiSummaryPushPreviewResult: document.querySelector('#aiSummaryPushPreviewResult'),
    aiSummaryPushScheduleFields: document.querySelector('#aiSummaryPushScheduleFields'),
    aiSummaryPushStatus: document.querySelector('#aiSummaryPushStatus'),
    aiSummaryPushTimeInput: document.querySelector('#aiSummaryPushTimeInput'),
    aiSummaryPushTimezone: document.querySelector('#aiSummaryPushTimezone'),
    aiSummaryPushWeekdayField: document.querySelector('#aiSummaryPushWeekdayField'),
    aiSummaryPushWeekdayInput: document.querySelector('#aiSummaryPushWeekdayInput'),
    aiSummaryRangeInput: document.querySelector('#aiSummaryRangeInput'),
    aiSummaryResult: document.querySelector('#aiSummaryResult'),
    aiSummarySelectedCount: document.querySelector('#aiSummarySelectedCount'),
    aiSummaryWebhookInput: document.querySelector('#aiSummaryWebhookInput'),
    addAiSummaryPushButton: document.querySelector('#addAiSummaryPushButton'),
    articleList: document.querySelector('#articleList'),
    cancelAiSummaryButton: document.querySelector('#cancelAiSummaryButton'),
    cancelAiSummaryPushButton: document.querySelector('#cancelAiSummaryPushButton'),
    cancelAddFeedButton: document.querySelector('#cancelAddFeedButton'),
    clearAiSummaryChannelsButton: document.querySelector('#clearAiSummaryChannelsButton'),
    closeAiSummaryButton: document.querySelector('#closeAiSummaryButton'),
    closeAddFeedButton: document.querySelector('#closeAddFeedButton'),
    closeServerFeedsButton: document.querySelector('#closeServerFeedsButton'),
    copyAiSummaryButton: document.querySelector('#copyAiSummaryButton'),
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
    openServerFeedsButton: document.querySelector('#openServerFeedsButton'),
    openAddFeedButton: document.querySelector('#openAddFeedButton'),
    openGlobalAiSummaryButton: document.querySelector('#openGlobalAiSummaryButton'),
    previewAiSummaryPushButton: document.querySelector('#previewAiSummaryPushButton'),
    readerPane: document.querySelector('#readerPane'),
    readerStatus: document.querySelector('#readerStatus'),
    readFilter: document.querySelector('#readFilter'),
    refreshButton: document.querySelector('#refreshButton'),
    runAiSummaryButton: document.querySelector('#runAiSummaryButton'),
    saveAiSummaryPushButton: document.querySelector('#saveAiSummaryPushButton'),
    searchInput: document.querySelector('#searchInput'),
    selectAllAiSummaryChannelsButton: document.querySelector('#selectAllAiSummaryChannelsButton'),
    settingsButton: document.querySelector('#settingsButton'),
    settingsMenu: document.querySelector('#settingsMenu'),
    sourceList: document.querySelector('#sourceList'),
    applyServerFeedsBulkIntervalButton: document.querySelector('#applyServerFeedsBulkIntervalButton'),
    serverFeedsBulkIntervalInput: document.querySelector('#serverFeedsBulkIntervalInput'),
    serverFeedsModal: document.querySelector('#serverFeedsModal'),
    serverFeedsSelectAllInput: document.querySelector('#serverFeedsSelectAllInput'),
    serverFeedsTableBody: document.querySelector('#serverFeedsTableBody'),
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
let summarizingUsesChannelPicker = false;
let initialAiSummaryPrompt = defaultAiSummaryPrompt;
let savedMultiAiSummaryPrompt = '';
let currentAiSummaryMarkdown = '';
let aiSummaryPushLookupToken = 0;
let aiSummaryPushes = [];
let editingAiSummaryPushId = '';
let editingAiSummaryPushRevision = 0;
let editingAiSummaryPushTimezone = '';
let articleOffset = 0;
let hasMoreArticles = true;
let isLoadingArticles = false;
let renderToken = 0;
let discordRolePopover;
let unreadCountsReady = false;
let serverFeedsCache = [];
let lastServerFeedsLoadedAt = 0;

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
    const responseText = await response.text();
    let data = {};
    try {
        data = responseText ? JSON.parse(responseText) : {};
    } catch {
        throw new Error(response.ok ? 'Reader returned an invalid JSON response.' : 'Reader request failed with HTTP ' + response.status + '.');
    }
    if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw new Error(message || 'Reader request failed with HTTP ' + response.status + '.');
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

async function getReaderEvent(eventId) {
    if (!eventId) {
        return;
    }
    return readerApi('/events/' + encodeURIComponent(eventId));
}

async function updateReaderEvent(eventId, status) {
    return readerApi('/events/' + encodeURIComponent(eventId), {
        body: JSON.stringify({ status }),
        method: 'PATCH',
    });
}

async function getReaderEventCounts() {
    return readerApi('/events/counts');
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

async function getServerFeeds() {
    const result = await readerApi('/feeds');
    return result.feeds || [];
}

async function saveServerFeed(feed) {
    return readerApi('/feeds', {
        body: JSON.stringify(feedToServerPayload(feed)),
        method: 'POST',
    });
}

async function updateServerFeed(feedId, patch) {
    return readerApi('/feeds/' + encodeURIComponent(feedId), {
        body: JSON.stringify(patch),
        method: 'PATCH',
    });
}

async function bulkUpdateServerFeeds(feedIds, patch) {
    return readerApi('/feeds/bulk', {
        body: JSON.stringify({
            feedIds,
            ...patch,
        }),
        method: 'PATCH',
    });
}

async function deleteServerFeed(feedId) {
    return readerApi('/feeds/' + encodeURIComponent(feedId), {
        method: 'DELETE',
    });
}

async function refreshServerFeed(feedId) {
    return readerApi('/feeds/' + encodeURIComponent(feedId) + '/refresh', {
        method: 'POST',
    });
}

async function createAiSummaryJob(feedId, days, prompt, savePrompt) {
    return readerApi('/feeds/' + encodeURIComponent(feedId) + '/ai-summary/jobs', {
        body: JSON.stringify({ days, prompt, savePrompt }),
        method: 'POST',
    });
}

async function createAiSummaryJobForFeeds(feedIds, days, prompt, savePrompt) {
    if (feedIds.length === 1) {
        return createAiSummaryJob(feedIds[0], days, prompt, savePrompt);
    }
    return readerApi('/feeds/ai-summary/jobs', {
        body: JSON.stringify({ days, feedIds, prompt, savePrompt }),
        method: 'POST',
    });
}

async function getAiSummaryJob(jobId) {
    return readerApi('/ai-summary/jobs/' + encodeURIComponent(jobId));
}

function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForAiSummaryJob(jobId, onUpdate) {
    const job = await getAiSummaryJob(jobId);
    onUpdate(job);
    if (job.status === 'completed') {
        return job.result;
    }
    if (job.status === 'failed') {
        throw new Error(job.error || 'AI summary job failed.');
    }
    await wait(1000);
    return waitForAiSummaryJob(jobId, onUpdate);
}

async function getMultiAiSummaryPrompt() {
    const result = await readerApi('/ai-summary-prompt');
    return result.prompt || '';
}

async function lookupAiSummaryPush(feedIds) {
    return readerApi('/ai-summary-pushes/lookup', {
        body: JSON.stringify({ feedIds }),
        method: 'POST',
    });
}

async function createAiSummaryPush(payload) {
    return readerApi('/ai-summary-pushes', {
        body: JSON.stringify(payload),
        method: 'POST',
    });
}

async function updateAiSummaryPush(pushId, payload) {
    return readerApi('/ai-summary-pushes/' + encodeURIComponent(pushId), {
        body: JSON.stringify(payload),
        method: 'PATCH',
    });
}

async function deleteAiSummaryPush(pushId) {
    return readerApi('/ai-summary-pushes/' + encodeURIComponent(pushId), {
        method: 'DELETE',
    });
}

async function previewProductEvents(feedIds, prompt) {
    return readerApi('/events/preview', {
        body: JSON.stringify({ feedIds, prompt }),
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
        setStatus('Choose a chat channel first.');
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
    if (allowAll && derivedCategoryIds.includes(value)) {
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
    if (lowerUrl.includes('/telegram/topic/')) {
        return 'chat';
    }
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

function getRefreshSeconds(feed) {
    return Number(feed.refreshSeconds) || getRefreshMinutes(feed) * 60;
}

function getFeedTitleFallback(url) {
    try {
        return new URL(url, window.location.origin).pathname || url;
    } catch {
        return url || 'Untitled';
    }
}

function isFutureDate(value) {
    if (!value) {
        return false;
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time > Date.now();
}

function isServerFeedRefreshing(feed) {
    return isFutureDate(feed.syncLockedUntil);
}

function serverFeedToLocal(feed) {
    const refreshSeconds = Number(feed.refreshSeconds) || defaultRefreshMinutes * 60;
    return {
        category: getCategory(feed.category || inferCategory(feed.url)),
        aiSummaryPrompt: feed.aiSummaryPrompt || '',
        error: feed.lastError || '',
        group: normalizeGroupName(feed.group),
        homeUrl: feed.homeUrl || '',
        id: feed.id,
        lastError: feed.lastError || '',
        lastFetchedAt: feed.lastFetchedAt || '',
        nextFetchAt: feed.nextFetchAt || '',
        paused: Boolean(feed.paused),
        refreshMinutes: getAllowedRefreshMinutes(Math.max(1, Math.round(refreshSeconds / 60))),
        refreshSeconds,
        serverSyncEnabled: feed.serverSyncEnabled !== false,
        syncLockedUntil: feed.syncLockedUntil || '',
        title: feed.title || getFeedTitleFallback(feed.url),
        url: feed.url,
    };
}

function feedToServerPayload(feed) {
    return {
        category: getCategory(feed.category || inferCategory(feed.url)),
        aiSummaryPrompt: feed.aiSummaryPrompt || undefined,
        group: normalizeGroupName(feed.group),
        homeUrl: feed.homeUrl || feed.url,
        id: feed.id,
        lastFetchedAt: feed.lastFetchedAt || undefined,
        nextFetchAt: feed.nextFetchAt || undefined,
        paused: Boolean(feed.paused),
        refreshSeconds: getRefreshSeconds(feed),
        serverSyncEnabled: feed.serverSyncEnabled !== false,
        title: feed.title || getFeedTitleFallback(feed.url),
        url: feed.url,
    };
}

async function saveLocalFeedsToServer() {
    const seenUrls = new Set();
    const feedsToSave = state.feeds.filter((feed) => {
        if (!feed.url || seenUrls.has(feed.url)) {
            return false;
        }
        seenUrls.add(feed.url);
        return true;
    });
    return Promise.all(
        feedsToSave.map((feed) =>
            saveServerFeed({
                ...feed,
                category: getCategory(feed.category || inferCategory(feed.url)),
                group: normalizeGroupName(feed.group),
                id: feed.id || createId(feed.url),
                refreshSeconds: getRefreshSeconds(feed),
                serverSyncEnabled: state.globalRefreshEnabled && feed.serverSyncEnabled !== false,
                title: feed.title || getFeedTitleFallback(feed.url),
            })
        )
    );
}

async function loadServerFeeds({ quiet = false } = {}) {
    try {
        let feeds = await getServerFeeds();
        if (!feeds.length && state.feeds.length && !localStorage.getItem(serverFeedBootstrapKey)) {
            feeds = await saveLocalFeedsToServer();
            localStorage.setItem(serverFeedBootstrapKey, 'true');
        }
        serverFeedsCache = feeds.map((feed) => serverFeedToLocal(feed));
        lastServerFeedsLoadedAt = Date.now();
        if (serverFeedsCache.length || !state.feeds.length) {
            state.feeds = serverFeedsCache;
            if (state.selectedSource !== 'all' && !getFeed(state.selectedSource) && !isChatGuildSourceId(state.selectedSource)) {
                state.selectedSource = 'all';
                state.selectedItemId = '';
            }
            saveState();
        }
        renderSources();
        if (!quiet) {
            setStatus('服务端订阅已同步。');
        }
    } catch (error) {
        if (!quiet) {
            setStatus(error instanceof Error ? error.message : 'Unable to load server feeds.');
        }
    }
}

async function loadMultiAiSummaryPrompt({ quiet = false } = {}) {
    try {
        savedMultiAiSummaryPrompt = await getMultiAiSummaryPrompt();
    } catch (error) {
        if (!quiet) {
            setStatus(error instanceof Error ? error.message : 'Unable to load AI summary prompt.');
        }
    }
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

function isEventView() {
    return state.selectedCategory === 'events';
}

function isChatOnlyView() {
    return state.selectedCategory === 'chat';
}

function isAllSelectedChatView() {
    return state.selectedCategory === 'all' && (isChatGuildSourceId(state.selectedSource) || isChatChannelFeed(getFeed(state.selectedSource)));
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

function getTelegramTopicRoute(feed) {
    try {
        const match = new URL(feed.url).pathname.match(/\/telegram\/topic\/([^/]+)\/([^/]+)/);
        return match
            ? {
                  topicId: match[2],
                  username: match[1],
              }
            : undefined;
    } catch {
        return;
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

function parseTelegramTopicFeedTitle(feed) {
    const route = getTelegramTopicRoute(feed);
    const title = feed.title || '';
    const suffix = ' - Telegram Topic';
    const body = title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
    const separator = body.lastIndexOf(' - ');
    const hasGroupTitle = separator !== -1;
    const channelName = hasGroupTitle ? body.slice(0, separator) : title || route?.topicId || 'Telegram Topic';
    const guildName = hasGroupTitle ? body.slice(separator + 3) : feed.group || route?.username || 'Telegram';

    return {
        channelName,
        guildName,
    };
}

function parseChatFeedTitle(feed) {
    if (getTelegramTopicRoute(feed)) {
        return parseTelegramTopicFeedTitle(feed);
    }
    return parseDiscordFeedTitle(feed);
}

function getChatGuildKey(feed) {
    const telegramRoute = getTelegramTopicRoute(feed);
    if (telegramRoute) {
        return 'telegram:' + telegramRoute.username;
    }
    return getDiscordGuildIdFromHomeUrl(feed) || parseDiscordFeedTitle(feed).guildName;
}

function isDiscordChannelFeed(feed) {
    return Boolean(feed) && getCategory(feed.category) === 'chat' && Boolean(getDiscordChannelRouteId(feed));
}

function isTelegramTopicFeed(feed) {
    return Boolean(feed) && getCategory(feed.category) === 'chat' && Boolean(getTelegramTopicRoute(feed));
}

function isChatChannelFeed(feed) {
    return isDiscordChannelFeed(feed) || isTelegramTopicFeed(feed);
}

function getChatGuildGroups(feeds = getVisibleFeeds()) {
    const groups = [];
    const groupMap = new Map();
    for (const feed of feeds) {
        if (!isChatChannelFeed(feed)) {
            continue;
        }

        const { channelName, guildName } = parseChatFeedTitle(feed);
        const key = getChatGuildKey(feed);
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
    if (isChatChannelFeed(selectedFeed)) {
        const selectedFeedKey = getChatGuildKey(selectedFeed);
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
        if (feed.serverSyncEnabled !== false) {
            const result = await refreshServerFeed(feed.id);
            if (result.feed) {
                Object.assign(feed, serverFeedToLocal(result.feed));
            }
            setStatus('Updated ' + feed.title + '.');
            await loadServerFeeds({ quiet: true });
            return;
        }

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
        if (isChatChannelFeed(feed)) {
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
            refreshSeconds: getAllowedRefreshMinutes(elements.feedIntervalInput.value || defaultRefreshMinutes) * 60,
            serverSyncEnabled: true,
            title: getFeedTitleFallback(url),
            url,
        };
        const savedFeed = serverFeedToLocal(await saveServerFeed(feed));
        state.feeds.unshift(savedFeed);
        state.selectedCategory = savedFeed.category;
        state.selectedSource = savedFeed.id;
        elements.feedUrlInput.value = '';
        closeAddFeedModal();
        saveState();
        await fetchFeed(savedFeed);
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
    feed.refreshSeconds = feed.refreshMinutes * 60;
    const updatedFeed = await updateServerFeed(feed.id, feedToServerPayload(feed));
    Object.assign(feed, serverFeedToLocal(updatedFeed));
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
            refreshSeconds: getRefreshSeconds(feed),
            serverSyncEnabled: feed.serverSyncEnabled !== false,
            title: feed.title || getFeedTitleFallback(feed.url),
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
        refreshSeconds: Number(rawFeed.refreshSeconds) || getAllowedRefreshMinutes(rawFeed.refreshMinutes) * 60,
        serverSyncEnabled: rawFeed.serverSyncEnabled !== false,
        title: typeof rawFeed.title === 'string' && rawFeed.title.trim() ? rawFeed.title.trim() : getFeedTitleFallback(url),
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
                nextFetchAt: existing.paused === importedFeed.paused && existing.refreshSeconds === importedFeed.refreshSeconds ? existing.nextFetchAt : new Date(Date.now() + importedFeed.refreshSeconds * 1000).toISOString(),
                paused: importedFeed.paused,
                refreshMinutes: importedFeed.refreshMinutes,
                refreshSeconds: importedFeed.refreshSeconds,
                serverSyncEnabled: importedFeed.serverSyncEnabled,
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
        await Promise.all(importedFeeds.map((feed) => saveServerFeed(feed)));
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
    if (isEventView()) {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            status: 'open',
        });
        if (state.search) {
            params.set('search', state.search);
        }
        return readerApi('/events?' + params.toString());
    }
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
    elements.searchInput.placeholder = isEventView() ? '搜索产品事件' : 'Search articles';
    elements.readFilter.hidden = isEventView();
    elements.markAllReadButton.hidden = isEventView();
    elements.refreshButton.title = isEventView() ? '刷新事件' : 'Refresh now';
    elements.refreshButton.setAttribute('aria-label', elements.refreshButton.title);
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
        const [counts, eventCounts, feedUnreadCounts] = await Promise.all([getItemCounts(), getReaderEventCounts(), getFeedUnreadCounts()]);
        counts.events = Number(eventCounts.open) || 0;
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
    if (isEventView()) {
        renderEventSourceInfo();
        return;
    }
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

function renderEventSourceInfo() {
    const card = document.createElement('section');
    card.className = 'event-source-info';
    card.append(createText('strong', '', '产品事件监控'), createText('p', '', '这里汇总 AI 从社媒和聊天订阅中识别出的待处理产品问题。'), createText('small', '', '在任意频道的 AI 设置中新增“产品事件监控”任务即可开始。'));
    elements.sourceList.append(card);
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
    const rows = feeds.filter((feed) => !isChatChannelFeed(feed)).map((feed) => createFeedRow(feed));
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
    const chatFeeds = getVisibleFeeds().filter((feed) => isChatChannelFeed(feed));

    if (!chatFeeds.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No chat channels</h2><p>Add /discord/channel/:channelId or /telegram/topic/:username/:topicId to subscribe to a channel.</p>';
        elements.sourceList.append(empty);
        return;
    }

    renderSourceRowsByFeedGroup(chatFeeds, createDiscordGuildRows);
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
    if (fetchingFeedIds.has(feed.id) || isServerFeedRefreshing(feed)) {
        return 'Refreshing...';
    }
    if (feed.paused) {
        return categoryLabels[getCategory(feed.category)] + ' / Paused';
    }
    if (!state.globalRefreshEnabled || feed.serverSyncEnabled === false) {
        return categoryLabels[getCategory(feed.category)] + ' / OFF';
    }
    return categoryLabels[getCategory(feed.category)] + ' / Next ' + formatNextFetch(feed.nextFetchAt);
}

function getChatFeedMetaText(feed) {
    if (fetchingFeedIds.has(feed.id) || isServerFeedRefreshing(feed)) {
        return '正在刷新';
    }
    const lastFetchedText = feed.lastFetchedAt ? ' / ' + formatLastFetched(feed.lastFetchedAt) : '';
    if (feed.paused) {
        return '已暂停' + lastFetchedText;
    }
    if (!state.globalRefreshEnabled || feed.serverSyncEnabled === false) {
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
    const records = isEventView() ? page.events || [] : page.items || [];
    articleOffset += records.length;
    renderArticles(records, articleOffset > records.length);
    isLoadingArticles = false;
}

function renderArticles(items, append = false) {
    if (!append) {
        elements.articleList.innerHTML = '';
    }

    if (!items.length && !append) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = isEventView() ? '<h2>暂无待处理事件</h2><p>启用产品事件监控后，AI 命中的问题会显示在这里。</p>' : '<h2>No articles</h2><p>Feeds will appear here after the first successful refresh.</p>';
        elements.articleList.append(empty);
        return;
    }

    if (isEventView()) {
        renderEventCards(items);
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

function getEventSeverityLabel(severity) {
    return (
        {
            high: 'HIGH',
            low: 'LOW',
            medium: 'MEDIUM',
        }[severity] || 'MEDIUM'
    );
}

function renderEventCards(events) {
    for (const event of events) {
        const button = document.createElement('button');
        button.className = 'article-card event-card event-severity-' + event.severity;
        button.classList.toggle('active', event.id === state.selectedItemId);
        button.type = 'button';
        button.dataset.eventId = event.id;

        const topLine = document.createElement('div');
        topLine.className = 'article-topline';
        const sourceWrap = document.createElement('span');
        sourceWrap.className = 'article-source-wrap';
        sourceWrap.append(createText('span', 'event-severity-badge', getEventSeverityLabel(event.severity)), createText('span', 'article-source', event.sourceTitle || 'Unknown source'));
        topLine.append(sourceWrap, createText('span', 'article-date', formatDate(event.lastSeenAt)));

        const title = createText('h2', 'article-title', event.title);
        const summary = createText('p', 'article-summary', event.summary);
        const footer = document.createElement('div');
        footer.className = 'article-footer';
        const confidence = Math.round((Number(event.confidence) || 0) * 100) + '% 可信度';
        const occurrence = Number(event.occurrenceCount) > 1 ? event.occurrenceCount + ' 条相似反馈' : '首次发现';
        footer.append(createText('span', '', confidence), createText('span', '', occurrence));

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
        empty.innerHTML = '<h2>No channels</h2><p>Add /discord/channel/:channelId or /telegram/topic/:username/:topicId to subscribe to a channel.</p>';
        elements.articleList.append(empty);
        return;
    }

    const query = state.search.toLowerCase();
    const visibleChannels = query ? group.feeds.filter((feed) => [feed.channelName, feed.title, feed.error].join(' ').toLowerCase().includes(query)) : group.feeds;
    if (!visibleChannels.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No channels</h2><p>No subscribed chat channels match this view.</p>';
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
    if (isEventView()) {
        await renderEventReader();
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

function createEventDetailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'event-detail-row';
    row.append(createText('dt', '', label), createText('dd', '', value || '未提及'));
    return row;
}

async function renderEventReader() {
    const event = await getReaderEvent(state.selectedItemId);
    elements.readerPane.innerHTML = '';

    if (!event) {
        const empty = document.createElement('div');
        empty.className = 'empty-pane';
        empty.innerHTML = '<h2>未选择产品事件</h2><p>从中间列表选择一个事件查看 AI 分析和原始反馈。</p>';
        elements.readerPane.append(empty);
        return;
    }

    const header = document.createElement('header');
    header.className = 'reader-header event-reader-header';
    header.append(createText('span', 'event-severity-badge event-severity-' + event.severity, getEventSeverityLabel(event.severity)), createText('h2', '', event.title));

    const meta = document.createElement('div');
    meta.className = 'reader-meta';
    const confidence = Math.round((Number(event.confidence) || 0) * 100) + '% 可信度';
    meta.append(
        createText('span', '', event.sourceTitle || 'Unknown source'),
        createText('span', '', confidence),
        createText('span', '', event.occurrenceCount + ' 条反馈'),
        createText('span', '', '最新 ' + formatDate(event.lastSeenAt))
    );

    const actions = document.createElement('div');
    actions.className = 'reader-actions';
    actions.append(createReaderButton('resolve-event', '标记已处理'), createReaderButton('false-positive-event', '标记误报'));
    if (event.itemLink) {
        const link = document.createElement('a');
        link.className = 'reader-action';
        link.href = event.itemLink;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = '打开原帖';
        actions.append(link);
    }
    header.append(meta, actions);

    const body = document.createElement('div');
    body.className = 'event-detail';
    const analysis = document.createElement('section');
    analysis.className = 'event-analysis-card';
    analysis.append(createText('h3', '', 'AI 事件分析'), createText('p', 'event-analysis-summary', event.summary || event.title));
    const details = document.createElement('dl');
    details.className = 'event-detail-grid';
    details.append(
        createEventDetailRow('事件类型', event.eventType),
        createEventDetailRow('影响平台', event.platform),
        createEventDetailRow('相关版本', event.version),
        createEventDetailRow('去重标识', event.eventKey),
        createEventDetailRow('首次发现', formatDate(event.firstSeenAt)),
        createEventDetailRow('通知状态', event.notifiedAt ? '已推送 Lark' : '未推送')
    );
    analysis.append(details);

    const original = document.createElement('section');
    original.className = 'event-original-card';
    original.append(createText('h3', '', '代表性原始反馈'));
    if (event.itemTitle && event.itemTitle !== event.title) {
        original.append(createText('h4', '', event.itemTitle));
    }
    original.append(createText('p', 'event-original-meta', [event.itemAuthor, formatDate(event.itemPubDate)].filter(Boolean).join(' · ')));
    original.append(createText('p', 'event-original-content', event.itemSummary || stripHtml(event.itemDescription) || event.itemTitle || '暂无原文内容。'));
    body.append(analysis, original);
    elements.readerPane.append(header, body);
}

async function renderChatMessages() {
    elements.readerPane.innerHTML = '';

    const feed = getSelectedChatFeed();
    if (!feed) {
        const empty = document.createElement('div');
        empty.className = 'empty-pane';
        empty.innerHTML = '<h2>No channel selected</h2><p>Choose a chat channel to show its messages.</p>';
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
    const time = createText('span', 'discord-message-time', formatDate(message.pubDate));
    const badge = createText('span', 'discord-message-badge', getDiscordRoleLabel(messageRole));
    const author = createText('span', 'discord-message-author', message.author || 'Discord');
    if (messageRole === 'admin') {
        meta.append(time, badge, author);
    } else {
        meta.append(author, badge, time);
    }

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
        card.classList.toggle('active', (isEventView() ? card.dataset.eventId : card.dataset.itemId) === itemId);
    });
    void renderReader();
}

async function deleteFeed(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    await deleteServerFeed(feedId);
    state.feeds = state.feeds.filter((currentFeed) => currentFeed.id !== feedId);
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

async function toggleFeedPaused(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    feed.paused = !feed.paused;
    const updatedFeed = await updateServerFeed(feed.id, {
        nextFetchAt: feed.paused ? '' : new Date(Date.now() + getRefreshSeconds(feed) * 1000).toISOString(),
        paused: feed.paused,
    });
    Object.assign(feed, serverFeedToLocal(updatedFeed));
    setStatus((feed.paused ? 'Paused ' : 'Resumed ') + feed.title + '.');
    saveState();
    render();
}

function refreshSelected() {
    if (isEventView()) {
        void renderCounts();
        void resetArticlePagination();
        void renderReader();
        return;
    }
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

function createServerIntervalSelect(feed) {
    const select = document.createElement('select');
    select.dataset.action = 'server-feed-interval';
    select.dataset.feedId = feed.id;
    const options = [
        [60, '1 分钟'],
        [180, '3 分钟'],
        [300, '5 分钟'],
        [600, '10 分钟'],
        [1800, '30 分钟'],
    ];
    const value = String(getRefreshSeconds(feed));
    options.forEach(([seconds, label]) => {
        const option = document.createElement('option');
        option.value = String(seconds);
        option.textContent = label;
        select.append(option);
    });
    if (options.every(([seconds]) => String(seconds) !== value)) {
        const custom = document.createElement('option');
        custom.value = value;
        custom.textContent = Math.round(Number(value) / 60) + ' 分钟';
        select.append(custom);
    }
    select.value = value;
    return select;
}

function createServerFeedRow(feed) {
    const row = document.createElement('tr');
    row.dataset.feedId = feed.id;

    const selectCell = document.createElement('td');
    const selected = document.createElement('input');
    selected.type = 'checkbox';
    selected.className = 'server-feed-select';
    selected.dataset.feedId = feed.id;
    selectCell.append(selected);

    const infoCell = document.createElement('td');
    const title = createText('div', 'server-feed-title', feed.title || feed.url);
    const url = createText('div', 'server-feed-url', feed.url);
    infoCell.append(title, url);
    if (feed.lastError) {
        infoCell.append(createText('div', 'server-feed-error', feed.lastError));
    }

    const intervalCell = document.createElement('td');
    intervalCell.append(createServerIntervalSelect(feed));

    const statusCell = document.createElement('td');
    statusCell.className = 'server-feed-status';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'server-feed-check';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = feed.serverSyncEnabled !== false;
    enabled.dataset.action = 'server-feed-enabled';
    enabled.dataset.feedId = feed.id;
    enabledLabel.append(enabled, document.createTextNode('同步'));
    const pausedLabel = document.createElement('label');
    pausedLabel.className = 'server-feed-check';
    const paused = document.createElement('input');
    paused.type = 'checkbox';
    paused.checked = Boolean(feed.paused);
    paused.dataset.action = 'server-feed-paused';
    paused.dataset.feedId = feed.id;
    pausedLabel.append(paused, document.createTextNode('暂停'));
    statusCell.append(enabledLabel, pausedLabel);

    const timeCell = document.createElement('td');
    timeCell.append(
        createText('div', 'server-feed-time', isServerFeedRefreshing(feed) ? '服务端刷新中' : feed.nextFetchAt ? formatNextFetchZh(feed.nextFetchAt) : '等待刷新'),
        createText('div', 'server-feed-time', feed.lastFetchedAt ? formatLastFetched(feed.lastFetchedAt) : 'Not fetched yet')
    );

    const actionCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'server-feed-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.dataset.action = 'save-server-feed';
    save.dataset.feedId = feed.id;
    save.textContent = '保存';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.dataset.action = 'refresh-server-feed';
    refresh.dataset.feedId = feed.id;
    refresh.textContent = '刷新';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'delete-server-feed';
    remove.dataset.feedId = feed.id;
    remove.textContent = '删除';
    actions.append(save, refresh, remove);
    actionCell.append(actions);

    row.append(selectCell, infoCell, intervalCell, statusCell, timeCell, actionCell);
    return row;
}

function renderServerFeedsModal() {
    elements.serverFeedsTableBody.replaceChildren();
    const feeds = state.feeds.toSorted((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    if (!feeds.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.append(createText('div', 'server-feed-time', '还没有服务端订阅。'));
        row.append(cell);
        elements.serverFeedsTableBody.append(row);
        return;
    }
    feeds.forEach((feed) => {
        elements.serverFeedsTableBody.append(createServerFeedRow(feed));
    });
}

async function openServerFeedsModal() {
    closeSettingsMenu();
    await loadServerFeeds({ quiet: true });
    renderServerFeedsModal();
    elements.serverFeedsModal.hidden = false;
}

function closeServerFeedsModal() {
    elements.serverFeedsSelectAllInput.checked = false;
    elements.serverFeedsModal.hidden = true;
}

function getServerFeedRowValues(feedId) {
    const row = elements.serverFeedsTableBody.querySelector('tr[data-feed-id="' + CSS.escape(feedId) + '"]');
    return {
        paused: row?.querySelector('[data-action="server-feed-paused"]')?.checked || false,
        refreshSeconds: Number(row?.querySelector('[data-action="server-feed-interval"]')?.value) || defaultRefreshMinutes * 60,
        serverSyncEnabled: row?.querySelector('[data-action="server-feed-enabled"]')?.checked || false,
    };
}

async function saveServerFeedRow(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    const patch = getServerFeedRowValues(feedId);
    const updated = serverFeedToLocal(await updateServerFeed(feedId, patch));
    Object.assign(feed, updated);
    renderServerFeedsModal();
    render();
    setStatus('已保存 ' + feed.title + '。');
}

async function refreshServerFeedRow(feedId) {
    const result = await refreshServerFeed(feedId);
    if (result.feed) {
        const feed = getFeed(feedId);
        if (feed) {
            Object.assign(feed, serverFeedToLocal(result.feed));
        }
    }
    await loadServerFeeds({ quiet: true });
    renderServerFeedsModal();
    await renderCounts();
    await resetArticlePagination();
    await renderReader();
    setStatus('已刷新服务端订阅。');
}

async function deleteServerFeedRow(feedId) {
    await deleteFeed(feedId);
    renderServerFeedsModal();
}

async function applyServerFeedsBulkInterval() {
    const feedIds = [...elements.serverFeedsTableBody.querySelectorAll('.server-feed-select:checked')].map((input) => input.dataset.feedId).filter(Boolean);
    if (!feedIds.length) {
        setStatus('请选择要修改的订阅。');
        return;
    }
    const refreshSeconds = Number(elements.serverFeedsBulkIntervalInput.value);
    const result = await bulkUpdateServerFeeds(feedIds, { refreshSeconds });
    const updatedFeeds = result.feeds || [];
    updatedFeeds.forEach((serverFeed) => {
        const feed = getFeed(serverFeed.id);
        if (feed) {
            Object.assign(feed, serverFeedToLocal(serverFeed));
        }
    });
    saveState();
    renderServerFeedsModal();
    render();
    setStatus('已更新 ' + updatedFeeds.length + ' 个订阅。');
}

function openAiSummaryModal(feedId) {
    const feed = getFeed(feedId);
    if (!feed) {
        return;
    }
    openAiSummaryForFeeds([feed.id], feed.title || feed.url);
}

function getDefaultAiSummaryPrompt(feedIds) {
    return feedIds.length === 1 ? defaultAiSummaryPrompt : defaultMultiAiSummaryPrompt;
}

function getAiSummaryPromptForFeeds(feedIds, { fallbackPrompt = '', preferSaved = true } = {}) {
    const savedPrompt = preferSaved ? (feedIds.length === 1 ? getFeed(feedIds[0])?.aiSummaryPrompt : savedMultiAiSummaryPrompt) : '';
    return savedPrompt || fallbackPrompt || getDefaultAiSummaryPrompt(feedIds);
}

function saveAiSummaryPromptToLocalCache(feedIds, prompt) {
    if (feedIds.length !== 1) {
        savedMultiAiSummaryPrompt = prompt;
        return;
    }
    const feed = getFeed(feedIds[0]);
    if (!feed) {
        return;
    }
    feed.aiSummaryPrompt = prompt;
    saveState();
}

function getCurrentAiSummaryFeedIds() {
    if (summarizingUsesChannelPicker) {
        return getAiSummarySelectedFeedIds();
    }
    if (summarizingFeedIds.length) {
        return summarizingFeedIds;
    }
    return summarizingFeedId ? [summarizingFeedId] : [];
}

function getBrowserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
}

function setAiSummaryPushEditorVisibility() {
    const mode = elements.aiSummaryPushModeInput.value;
    const scheduled = mode === aiSummaryPushSummaryMode;
    const eventMonitoring = mode === aiSummaryPushEventMode;
    const weekly = elements.aiSummaryPushCadenceInput.value === 'weekly';
    elements.aiSummaryPushScheduleFields.hidden = !scheduled;
    elements.aiSummaryPushEventFields.hidden = !eventMonitoring;
    elements.aiSummaryPushWeekdayField.hidden = !scheduled || !weekly;
    elements.aiSummaryPushPromptLabel.textContent = eventMonitoring ? '产品背景与识别要求' : '推送提示词';
    const prompt = elements.aiSummaryPushPromptInput.value.trim();
    if (eventMonitoring && (!prompt || [defaultAiSummaryPrompt, defaultMultiAiSummaryPrompt, initialAiSummaryPrompt].includes(prompt))) {
        elements.aiSummaryPushPromptInput.value = defaultEventMonitorPrompt;
    } else if (!eventMonitoring && prompt === defaultEventMonitorPrompt) {
        elements.aiSummaryPushPromptInput.value = initialAiSummaryPrompt || getDefaultAiSummaryPrompt(getCurrentAiSummaryFeedIds());
    }
    elements.aiSummaryPushTimezone.textContent = scheduled
        ? '发送时间按 ' + (editingAiSummaryPushTimezone || '服务器本地时区') + ' 计算。'
        : eventMonitoring
          ? '新内容先由 AI 判断；命中级别与可信度要求后立即推送。'
          : '有新内容时立即推送，不使用定时设置。';
}

function closeAiSummaryPushEditor() {
    editingAiSummaryPushId = '';
    editingAiSummaryPushRevision = 0;
    editingAiSummaryPushTimezone = '';
    elements.aiSummaryPushEditor.hidden = true;
    elements.aiSummaryPushPreviewResult.hidden = true;
    elements.aiSummaryPushPreviewResult.replaceChildren();
}

function resetAiSummaryPushForm(status = '') {
    aiSummaryPushes = [];
    closeAiSummaryPushEditor();
    elements.aiSummaryPushList.replaceChildren(createText('p', 'ai-summary-push-empty', '还没有推送任务。'));
    elements.aiSummaryPushModeInput.value = aiSummaryPushSummaryMode;
    elements.aiSummaryPushCadenceInput.value = 'daily';
    elements.aiSummaryPushWeekdayInput.value = '1';
    elements.aiSummaryPushDaysInput.value = '1';
    elements.aiSummaryPushDedupeMinutesInput.value = '10';
    elements.aiSummaryPushMinimumSeverityInput.value = 'medium';
    elements.aiSummaryPushTimeInput.value = defaultAiSummaryPushTime;
    elements.aiSummaryWebhookInput.value = '';
    elements.aiSummaryPushPromptInput.value = '';
    elements.aiSummaryPushEnabledInput.checked = true;
    setAiSummaryPushEditorVisibility();
    elements.aiSummaryPushStatus.textContent = status;
}

function getAiSummaryPushScheduleText(push) {
    if (push.mode === aiSummaryPushEventMode) {
        return '产品事件监控 · ' + getEventSeverityLabel(push.minimumSeverity) + ' 起';
    }
    if (push.mode === aiSummaryPushRealtimeMode) {
        return '原始内容实时推送';
    }
    const days = Number(push.days) === 7 ? 7 : 1;
    const sendTime = push.sendTime || defaultAiSummaryPushTime;
    if (push.cadence === 'weekly') {
        const weekday = Number(push.weekday);
        const weekdayLabel = aiSummaryPushWeekdayLabels[weekday] || aiSummaryPushWeekdayLabels[1];
        return '每' + weekdayLabel + ' ' + sendTime + ' · 汇总最近 ' + days + ' 天';
    }
    return '每天 ' + sendTime + ' · 汇总最近 ' + days + ' 天';
}

function createAiSummaryPushAction(label, action, pushId, className = 'secondary-button compact-action-button') {
    const button = createText('button', className, label);
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.pushId = pushId;
    return button;
}

function createAiSummaryPushItem(push) {
    const item = document.createElement('article');
    item.className = 'ai-summary-push-item';

    const header = document.createElement('div');
    header.className = 'ai-summary-push-item-header';
    header.append(createText('strong', '', getAiSummaryPushScheduleText(push)), createText('span', push.enabled ? 'ai-summary-push-badge enabled' : 'ai-summary-push-badge', push.enabled ? '已启用' : '已停用'));

    const configuration = push.mode === aiSummaryPushEventMode ? getEventSeverityLabel(push.minimumSeverity) + ' 起 · ' + (push.dedupeMinutes || 10) + ' 分钟免打扰' : push.timezone || '服务器本地时区';
    const details = createText('p', 'ai-summary-push-item-details', configuration + ' · ' + (push.webhookUrl || '未设置 Webhook'));
    details.title = push.webhookUrl || '';
    item.append(header, details);

    if (push.lastError) {
        item.append(createText('p', 'ai-summary-push-item-error', '上次失败：' + push.lastError));
    } else if (push.lastSentAt) {
        item.append(createText('p', 'ai-summary-push-item-status', (push.mode === aiSummaryPushEventMode ? '上次检查：' : '上次发送：') + formatDate(push.lastSentAt)));
    } else if (push.enabled && push.nextSendAt) {
        item.append(createText('p', 'ai-summary-push-item-status', '下次发送：' + formatDate(push.nextSendAt)));
    }

    const actions = document.createElement('div');
    actions.className = 'ai-summary-push-item-actions';
    actions.append(
        createAiSummaryPushAction(push.enabled ? '停用' : '启用', 'toggle-ai-summary-push', push.id),
        createAiSummaryPushAction('编辑', 'edit-ai-summary-push', push.id),
        createAiSummaryPushAction('删除', 'delete-ai-summary-push', push.id, 'secondary-button compact-action-button ai-summary-push-delete-button')
    );
    item.append(actions);
    return item;
}

function renderAiSummaryPushes(pushes) {
    aiSummaryPushes = pushes;
    elements.aiSummaryPushList.replaceChildren();
    if (!pushes.length) {
        elements.aiSummaryPushList.append(createText('p', 'ai-summary-push-empty', '还没有推送任务，可新增总结、实时推送或产品事件监控。'));
        return;
    }
    pushes.forEach((push) => {
        elements.aiSummaryPushList.append(createAiSummaryPushItem(push));
    });
}

function openAiSummaryPushEditor(push) {
    if (!getCurrentAiSummaryFeedIds().length) {
        elements.aiSummaryPushStatus.textContent = '请至少选择一个频道。';
        return;
    }
    editingAiSummaryPushId = push?.id || '';
    editingAiSummaryPushRevision = Number.isSafeInteger(push?.configRevision) ? push.configRevision : 0;
    editingAiSummaryPushTimezone = push ? (typeof push.timezone === 'string' ? push.timezone : '') : getBrowserTimezone();
    elements.aiSummaryPushEditorTitle.textContent = push ? '编辑推送' : '新增推送';
    elements.aiSummaryPushModeInput.value = [aiSummaryPushRealtimeMode, aiSummaryPushEventMode].includes(push?.mode) ? push.mode : aiSummaryPushSummaryMode;
    elements.aiSummaryPushCadenceInput.value = push?.cadence === 'weekly' ? 'weekly' : 'daily';
    const weekday = Number(push?.weekday);
    elements.aiSummaryPushWeekdayInput.value = Number.isSafeInteger(weekday) && weekday >= 0 && weekday <= 6 ? String(weekday) : '1';
    elements.aiSummaryPushDaysInput.value = Number(push?.days) === 7 ? '7' : '1';
    elements.aiSummaryPushDedupeMinutesInput.value = ['5', '10', '30', '60'].includes(String(push?.dedupeMinutes)) ? String(push.dedupeMinutes) : '10';
    elements.aiSummaryPushMinimumSeverityInput.value = ['low', 'medium', 'high'].includes(push?.minimumSeverity) ? push.minimumSeverity : 'medium';
    elements.aiSummaryPushTimeInput.value = push?.sendTime || defaultAiSummaryPushTime;
    elements.aiSummaryWebhookInput.value = push?.webhookUrl || '';
    elements.aiSummaryPushPromptInput.value = push?.prompt || (push?.mode === aiSummaryPushEventMode ? defaultEventMonitorPrompt : elements.aiSummaryPromptInput.value.trim() || initialAiSummaryPrompt);
    elements.aiSummaryPushEnabledInput.checked = push ? push.enabled !== false : true;
    elements.aiSummaryPushPreviewResult.hidden = true;
    elements.aiSummaryPushPreviewResult.replaceChildren();
    elements.aiSummaryPushEditor.hidden = false;
    setAiSummaryPushEditorVisibility();
    elements.aiSummaryPushStatus.textContent = '';
    window.setTimeout(() => elements.aiSummaryPushModeInput.focus(), 0);
}

function renderProductEventPreview(result) {
    const events = Array.isArray(result.events) ? result.events : [];
    elements.aiSummaryPushPreviewResult.hidden = false;
    elements.aiSummaryPushPreviewResult.replaceChildren(createText('strong', '', '检查 ' + (Number(result.inspectedCount) || 0) + ' 条，命中 ' + events.length + ' 个事件'));
    if (!events.length) {
        elements.aiSummaryPushPreviewResult.append(createText('p', '', '当前样本没有识别到产品事件。可以补充产品名称、模块和需要忽略的场景后重试。'));
        return;
    }
    events.slice(0, 5).forEach((event) => {
        const item = document.createElement('article');
        item.className = 'ai-summary-push-preview-item';
        const header = document.createElement('div');
        header.append(createText('span', 'event-severity-badge event-severity-' + (event.severity || 'medium'), String(event.severity || 'medium').toUpperCase()), createText('strong', '', event.title || '产品事件'));
        item.append(header, createText('p', '', event.summary || event.itemText || ''));
        const meta = [event.sourceTitle, event.platform, Math.round((Number(event.confidence) || 0) * 100) + '% 可信度'].filter(Boolean).join(' · ');
        item.append(createText('small', '', meta));
        elements.aiSummaryPushPreviewResult.append(item);
    });
}

async function runProductEventPreview() {
    const feedIds = getCurrentAiSummaryFeedIds();
    if (!feedIds.length) {
        elements.aiSummaryPushStatus.textContent = '请至少选择一个频道。';
        return;
    }
    elements.previewAiSummaryPushButton.disabled = true;
    elements.aiSummaryPushPreviewResult.hidden = false;
    elements.aiSummaryPushPreviewResult.replaceChildren(createText('p', '', 'AI 正在检查最近 20 条内容...'));
    try {
        const result = await previewProductEvents(feedIds, elements.aiSummaryPushPromptInput.value.trim() || defaultEventMonitorPrompt);
        renderProductEventPreview(result);
    } catch (error) {
        elements.aiSummaryPushPreviewResult.replaceChildren(createText('p', 'ai-summary-error', error instanceof Error ? error.message : '测试产品事件识别失败。'));
    } finally {
        elements.previewAiSummaryPushButton.disabled = false;
    }
}

async function loadAiSummaryPushForCurrentSelection() {
    const feedIds = getCurrentAiSummaryFeedIds();
    const token = ++aiSummaryPushLookupToken;
    closeAiSummaryPushEditor();
    if (!feedIds.length) {
        renderAiSummaryPushes([]);
        elements.aiSummaryPushStatus.textContent = '请至少选择一个频道。';
        return;
    }
    elements.aiSummaryPushList.replaceChildren(createText('p', 'ai-summary-push-empty', '正在读取推送任务...'));
    elements.aiSummaryPushStatus.textContent = '';
    try {
        const result = await lookupAiSummaryPush(feedIds);
        if (token !== aiSummaryPushLookupToken) {
            return;
        }
        renderAiSummaryPushes(Array.isArray(result.pushes) ? result.pushes : []);
    } catch (error) {
        if (token === aiSummaryPushLookupToken) {
            renderAiSummaryPushes([]);
            elements.aiSummaryPushStatus.textContent = error instanceof Error ? error.message : '读取推送任务失败。';
        }
    }
}

async function saveAiSummaryPushSettings() {
    const feedIds = getCurrentAiSummaryFeedIds();
    if (!feedIds.length) {
        elements.aiSummaryPushStatus.textContent = '请至少选择一个频道。';
        return;
    }

    const enabled = elements.aiSummaryPushEnabledInput.checked;
    const webhookUrl = elements.aiSummaryWebhookInput.value.trim();
    if (enabled && !webhookUrl) {
        elements.aiSummaryPushStatus.textContent = '请填写 Webhook 链接。';
        elements.aiSummaryWebhookInput.focus();
        return;
    }

    const selectedMode = elements.aiSummaryPushModeInput.value;
    const mode = selectedMode === aiSummaryPushRealtimeMode || selectedMode === aiSummaryPushEventMode ? selectedMode : aiSummaryPushSummaryMode;
    const cadence = mode === aiSummaryPushSummaryMode && elements.aiSummaryPushCadenceInput.value === 'weekly' ? 'weekly' : 'daily';
    const weekday = Number(elements.aiSummaryPushWeekdayInput.value);
    const payload = {
        cadence,
        days: Number(elements.aiSummaryPushDaysInput.value) === 7 ? 7 : 1,
        enabled,
        feedIds,
        dedupeMinutes: Number(elements.aiSummaryPushDedupeMinutesInput.value) || 10,
        minimumSeverity: elements.aiSummaryPushMinimumSeverityInput.value,
        mode,
        prompt: elements.aiSummaryPushPromptInput.value.trim() || (mode === aiSummaryPushEventMode ? defaultEventMonitorPrompt : initialAiSummaryPrompt || getDefaultAiSummaryPrompt(feedIds)),
        sendTime: elements.aiSummaryPushTimeInput.value || defaultAiSummaryPushTime,
        title: summarizingTitle,
        webhookUrl,
        weekday: Number.isSafeInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1,
    };
    if (editingAiSummaryPushId) {
        payload.configRevision = editingAiSummaryPushRevision;
    } else {
        payload.timezone = editingAiSummaryPushTimezone;
    }
    const wasEditing = Boolean(editingAiSummaryPushId);
    elements.saveAiSummaryPushButton.disabled = true;
    elements.aiSummaryPushStatus.textContent = wasEditing ? '正在更新推送任务...' : '正在创建推送任务...';
    try {
        await (editingAiSummaryPushId ? updateAiSummaryPush(editingAiSummaryPushId, payload) : createAiSummaryPush(payload));
        closeAiSummaryPushEditor();
        await loadAiSummaryPushForCurrentSelection();
        elements.aiSummaryPushStatus.textContent = wasEditing ? '推送任务已更新。' : '推送任务已创建。';
        setStatus('AI 推送任务已保存。');
    } catch (error) {
        elements.aiSummaryPushStatus.textContent = error instanceof Error ? error.message : '保存推送任务失败。';
    } finally {
        elements.saveAiSummaryPushButton.disabled = false;
    }
}

async function toggleAiSummaryPush(pushId) {
    const push = aiSummaryPushes.find((item) => item.id === pushId);
    if (!push) {
        return;
    }
    elements.aiSummaryPushStatus.textContent = push.enabled ? '正在停用推送任务...' : '正在启用推送任务...';
    await updateAiSummaryPush(pushId, { configRevision: push.configRevision, enabled: !push.enabled });
    await loadAiSummaryPushForCurrentSelection();
    elements.aiSummaryPushStatus.textContent = push.enabled ? '推送任务已停用。' : '推送任务已启用。';
}

async function removeAiSummaryPush(pushId) {
    if (!window.confirm('确定删除这条推送任务吗？')) {
        return;
    }
    elements.aiSummaryPushStatus.textContent = '正在删除推送任务...';
    await deleteAiSummaryPush(pushId);
    if (editingAiSummaryPushId === pushId) {
        closeAiSummaryPushEditor();
    }
    await loadAiSummaryPushForCurrentSelection();
    elements.aiSummaryPushStatus.textContent = '推送任务已删除。';
}

function setAiSummaryCopyEnabled(enabled) {
    elements.copyAiSummaryButton.hidden = !enabled;
}

function getDefaultGlobalAiSummaryFeedIds() {
    const feeds = state.selectedCategory === 'all' ? state.feeds : getVisibleFeeds();
    return feeds.map((feed) => feed.id);
}

function getAiSummarySelectedFeedIds() {
    return [...elements.aiSummaryChannelList.querySelectorAll('.ai-summary-channel-input:checked')].map((input) => input.dataset.feedId).filter(Boolean);
}

function updateAiSummaryChannelSelectionState() {
    const selectedFeedIds = getAiSummarySelectedFeedIds();
    summarizingFeedIds = selectedFeedIds;
    elements.aiSummarySelectedCount.textContent = '已选择 ' + selectedFeedIds.length + ' 个';
    elements.runAiSummaryButton.disabled = summarizingUsesChannelPicker && !selectedFeedIds.length;
    void loadAiSummaryPushForCurrentSelection();
}

function createAiSummaryChannelOption(feed, selectedFeedIds) {
    const label = document.createElement('label');
    label.className = 'ai-summary-channel-option';

    const input = document.createElement('input');
    input.className = 'ai-summary-channel-input';
    input.type = 'checkbox';
    input.dataset.feedId = feed.id;
    input.checked = selectedFeedIds.includes(feed.id);

    const text = document.createElement('span');
    text.className = 'ai-summary-channel-text';
    text.append(createText('strong', '', feed.title || getFeedTitleFallback(feed.url)));
    text.append(createText('small', '', [categoryLabels[getCategory(feed.category)], normalizeGroupName(feed.group), feed.url].filter(Boolean).join(' / ')));

    label.append(input, text);
    return label;
}

function renderAiSummaryChannelPicker(selectedFeedIds) {
    elements.aiSummaryChannelList.replaceChildren();
    state.feeds.forEach((feed) => {
        elements.aiSummaryChannelList.append(createAiSummaryChannelOption(feed, selectedFeedIds));
    });
    updateAiSummaryChannelSelectionState();
}

function setAiSummaryChannelPickerVisible(visible) {
    summarizingUsesChannelPicker = visible;
    elements.aiSummaryChannelField.hidden = !visible;
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.inset = '-1000px auto auto -1000px';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

async function copyAiSummaryMarkdown() {
    if (!currentAiSummaryMarkdown) {
        return;
    }
    await copyTextToClipboard(currentAiSummaryMarkdown);
    setStatus('AI 总结 Markdown 已复制。');
}

function openGlobalAiSummaryModal() {
    const feedIds = getDefaultGlobalAiSummaryFeedIds();
    openAiSummaryForFeeds(feedIds, '多频道总结', {
        fallbackPrompt: defaultMultiAiSummaryPrompt,
        showChannelPicker: true,
    });
}

function openAiSummaryForFeeds(feedIds, title, { fallbackPrompt = '', preferSavedPrompt = true, showChannelPicker = false } = {}) {
    summarizingFeedId = feedIds[0] || '';
    summarizingFeedIds = feedIds;
    summarizingTitle = title;
    elements.aiSummaryFeedTitle.textContent = title;
    elements.aiSummaryRangeInput.value = '1';
    setAiSummaryChannelPickerVisible(showChannelPicker);
    if (showChannelPicker) {
        renderAiSummaryChannelPicker(feedIds);
    }
    initialAiSummaryPrompt = getAiSummaryPromptForFeeds(feedIds, { fallbackPrompt, preferSaved: preferSavedPrompt });
    elements.aiSummaryPromptInput.value = initialAiSummaryPrompt;
    currentAiSummaryMarkdown = '';
    setAiSummaryCopyEnabled(false);
    resetAiSummaryPushForm();
    void loadAiSummaryPushForCurrentSelection();
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '选择范围后生成该订阅源的摘要。'));
    elements.aiSummaryModal.hidden = false;
    window.setTimeout(() => elements.aiSummaryRangeInput.focus(), 0);
}

function closeAiSummaryModal() {
    summarizingFeedId = '';
    summarizingFeedIds = [];
    summarizingTitle = '';
    summarizingUsesChannelPicker = false;
    elements.aiSummaryModal.hidden = true;
    elements.aiSummaryChannelField.hidden = true;
    elements.aiSummaryChannelList.replaceChildren();
    elements.runAiSummaryButton.disabled = false;
    elements.runAiSummaryButton.textContent = '生成总结';
    initialAiSummaryPrompt = defaultAiSummaryPrompt;
    currentAiSummaryMarkdown = '';
    elements.aiSummaryPromptInput.value = defaultAiSummaryPrompt;
    resetAiSummaryPushForm();
    setAiSummaryCopyEnabled(false);
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '选择范围后生成该订阅源的摘要。'));
}

function renderAiSummaryResult(data) {
    elements.aiSummaryResult.replaceChildren();
    currentAiSummaryMarkdown = '';
    setAiSummaryCopyEnabled(false);
    const daysText = '最近 ' + data.days + ' 天';
    const summarizedItemCount = data.summarizedItemCount ?? data.itemCount;
    const itemCountText = summarizedItemCount < data.itemCount ? ' / 共 ' + data.itemCount + ' 条，已总结 ' + summarizedItemCount + ' 条' : ' / ' + data.itemCount + ' 条内容';
    elements.aiSummaryResult.append(createText('p', 'ai-summary-meta', daysText + itemCountText));

    if (!data.itemCount) {
        elements.aiSummaryResult.append(createText('p', 'ai-summary-placeholder', '这个范围内还没有可总结的数据。'));
        return;
    }

    if (data.summary) {
        currentAiSummaryMarkdown = data.summary;
        setAiSummaryCopyEnabled(true);
        const summary = document.createElement('div');
        summary.className = 'ai-summary-markdown';
        summary.innerHTML = data.summaryHtml || '';
        if (!summary.innerHTML) {
            summary.textContent = data.summary;
        }
        elements.aiSummaryResult.append(summary);
        return;
    }

    elements.aiSummaryResult.append(createText('p', 'ai-summary-placeholder', data.message || 'AI 总结接口未配置。'));
}

function formatAiSummaryDuration(milliseconds) {
    const seconds = Math.max(1, Math.ceil(Number(milliseconds || 0) / 1000));
    if (seconds < 60) {
        return seconds + ' 秒';
    }
    return Math.ceil(seconds / 60) + ' 分钟';
}

function renderAiSummaryProgress(job) {
    const progress = job.progress || {};
    const totalBatches = Number(progress.totalBatches) || 1;
    const completedBatches = Math.min(Number(progress.completedBatches) || 0, totalBatches);
    let title;
    switch (progress.stage) {
        case 'batch':
            title = progress.currentBatch ? '正在生成第 ' + progress.currentBatch + '/' + totalBatches + ' 批' : '正在生成分批总结';
            break;
        case 'finalizing':
            title = '批次已完成 (' + completedBatches + '/' + totalBatches + ') ，正在生成最终报告';
            break;
        case 'retrying':
            title = progress.currentBatch ? '第 ' + progress.currentBatch + '/' + totalBatches + ' 批请求较慢，正在重试' : '正在重试总结请求';
            break;
        default:
            title = job.status === 'queued' ? '总结任务排队中' : '正在准备总结任务';
    }

    const details = [];
    if (progress.itemCount) {
        details.push('已纳入 ' + progress.itemCount + ' 条内容');
    }
    if (progress.stage === 'batch' || progress.stage === 'retrying') {
        details.push('已完成 ' + completedBatches + '/' + totalBatches + ' 批');
    }
    if (job.estimatedTotalMs) {
        details.push('预计总用时约 ' + formatAiSummaryDuration(job.estimatedTotalMs));
    }
    if (job.status === 'running' && job.estimatedRemainingMs) {
        details.push('预计剩余约 ' + formatAiSummaryDuration(job.estimatedRemainingMs));
    }

    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-progress-title', title), createText('p', 'ai-summary-progress-meta', details.join(' · ') || '正在收集内容...'));
}

async function submitAiSummary(event) {
    event.preventDefault();
    const feedIds = getCurrentAiSummaryFeedIds();
    if (!feedIds.length) {
        elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-error', '请至少选择一个频道。'));
        updateAiSummaryChannelSelectionState();
        return;
    }

    const days = Number(elements.aiSummaryRangeInput.value) === 7 ? 7 : 1;
    const prompt = elements.aiSummaryPromptInput.value.trim() || getDefaultAiSummaryPrompt(feedIds);
    const savePrompt = prompt !== initialAiSummaryPrompt;
    elements.aiSummaryPromptInput.value = prompt;
    elements.runAiSummaryButton.disabled = true;
    elements.runAiSummaryButton.textContent = '生成中...';
    currentAiSummaryMarkdown = '';
    setAiSummaryCopyEnabled(false);
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '正在收集内容并生成总结...'));
    try {
        const job = await createAiSummaryJobForFeeds(feedIds, days, prompt, savePrompt);
        renderAiSummaryProgress(job);
        const result = await waitForAiSummaryJob(job.id, renderAiSummaryProgress);
        if (savePrompt) {
            initialAiSummaryPrompt = result.promptTemplate || prompt;
            saveAiSummaryPromptToLocalCache(feedIds, initialAiSummaryPrompt);
        }
        renderAiSummaryResult(result);
        setStatus('AI summary ready for ' + summarizingTitle + '.');
    } catch (error) {
        elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-error', error instanceof Error ? error.message : 'AI summary failed.'));
    } finally {
        elements.runAiSummaryButton.disabled = false;
        elements.runAiSummaryButton.textContent = '生成总结';
    }
}

function tick() {
    renderSources();
    if (isChatView()) {
        void renderChatChannels();
    }
    if (Date.now() - lastServerFeedsLoadedAt > 15_000) {
        void loadServerFeeds({ quiet: true });
        void renderCounts();
    }
}

function bindEvents() {
    elements.addFeedForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitFeedForm();
    });
    elements.aiSummaryForm.addEventListener('submit', submitAiSummary);
    elements.addAiSummaryPushButton.addEventListener('click', () => {
        openAiSummaryPushEditor();
    });
    elements.aiSummaryPushModeInput.addEventListener('change', setAiSummaryPushEditorVisibility);
    elements.aiSummaryPushCadenceInput.addEventListener('change', setAiSummaryPushEditorVisibility);
    elements.previewAiSummaryPushButton.addEventListener('click', () => {
        void runProductEventPreview();
    });
    elements.cancelAiSummaryPushButton.addEventListener('click', closeAiSummaryPushEditor);
    elements.aiSummaryPushList.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-action][data-push-id]');
        if (!actionButton) {
            return;
        }
        const pushId = actionButton.dataset.pushId;
        if (actionButton.dataset.action === 'edit-ai-summary-push') {
            const push = aiSummaryPushes.find((item) => item.id === pushId);
            if (push) {
                openAiSummaryPushEditor(push);
            }
            return;
        }
        if (actionButton.dataset.action === 'toggle-ai-summary-push') {
            void toggleAiSummaryPush(pushId).catch((error) => {
                elements.aiSummaryPushStatus.textContent = error instanceof Error ? error.message : '更新推送任务失败。';
            });
            return;
        }
        if (actionButton.dataset.action === 'delete-ai-summary-push') {
            void removeAiSummaryPush(pushId).catch((error) => {
                elements.aiSummaryPushStatus.textContent = error instanceof Error ? error.message : '删除推送任务失败。';
            });
        }
    });
    elements.saveAiSummaryPushButton.addEventListener('click', () => {
        void saveAiSummaryPushSettings();
    });
    elements.copyAiSummaryButton.addEventListener('click', () => {
        void copyAiSummaryMarkdown().catch((error) => {
            setStatus(error instanceof Error ? error.message : 'Unable to copy AI summary.');
        });
    });
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
    elements.openServerFeedsButton.addEventListener('click', () => {
        void openServerFeedsModal();
    });
    elements.openGlobalAiSummaryButton.addEventListener('click', openGlobalAiSummaryModal);
    elements.aiSummaryChannelList.addEventListener('change', (event) => {
        if (event.target.closest('.ai-summary-channel-input')) {
            updateAiSummaryChannelSelectionState();
        }
    });
    elements.selectAllAiSummaryChannelsButton.addEventListener('click', () => {
        elements.aiSummaryChannelList.querySelectorAll('.ai-summary-channel-input').forEach((input) => {
            input.checked = true;
        });
        updateAiSummaryChannelSelectionState();
    });
    elements.clearAiSummaryChannelsButton.addEventListener('click', () => {
        elements.aiSummaryChannelList.querySelectorAll('.ai-summary-channel-input').forEach((input) => {
            input.checked = false;
        });
        updateAiSummaryChannelSelectionState();
    });
    elements.closeServerFeedsButton.addEventListener('click', closeServerFeedsModal);
    elements.serverFeedsModal.addEventListener('click', (event) => {
        if (event.target === elements.serverFeedsModal) {
            closeServerFeedsModal();
        }
    });
    elements.serverFeedsSelectAllInput.addEventListener('change', () => {
        elements.serverFeedsTableBody.querySelectorAll('.server-feed-select').forEach((input) => {
            input.checked = elements.serverFeedsSelectAllInput.checked;
        });
    });
    elements.applyServerFeedsBulkIntervalButton.addEventListener('click', () => {
        void applyServerFeedsBulkInterval().catch((error) => {
            setStatus(error instanceof Error ? error.message : '批量更新失败。');
        });
    });
    elements.serverFeedsTableBody.addEventListener('click', (event) => {
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) {
            return;
        }
        const feedId = actionButton.dataset.feedId;
        if (actionButton.dataset.action === 'save-server-feed') {
            void saveServerFeedRow(feedId).catch((error) => {
                setStatus(error instanceof Error ? error.message : '保存服务端订阅失败。');
            });
        }
        if (actionButton.dataset.action === 'refresh-server-feed') {
            void refreshServerFeedRow(feedId).catch((error) => {
                setStatus(error instanceof Error ? error.message : '刷新服务端订阅失败。');
            });
        }
        if (actionButton.dataset.action === 'delete-server-feed') {
            void deleteServerFeedRow(feedId).catch((error) => {
                setStatus(error instanceof Error ? error.message : '删除服务端订阅失败。');
            });
        }
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
            nextFetchAt: state.globalRefreshEnabled ? new Date(Date.now() + getRefreshSeconds(feed) * 1000).toISOString() : '',
            serverSyncEnabled: state.globalRefreshEnabled,
        }));
        void bulkUpdateServerFeeds(
            state.feeds.map((feed) => feed.id),
            {
                serverSyncEnabled: state.globalRefreshEnabled,
            }
        ).catch((error) => {
            setStatus(error instanceof Error ? error.message : 'Unable to update server refresh state.');
        });
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
            void toggleFeedPaused(actionButton.dataset.feedId);
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
            const selectedFeed = getFeed(feedButton.dataset.feedId);
            if (isChatChannelFeed(selectedFeed)) {
                state.selectedChatGuildKey = getChatGuildKey(selectedFeed);
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
                void toggleFeedPaused(actionButton.dataset.feedId);
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

        if (isEventView()) {
            const card = event.target.closest('.event-card');
            if (card?.dataset.eventId) {
                selectItem(card.dataset.eventId);
            }
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
        if (isEventView()) {
            const status = {
                'false-positive-event': 'falsePositive',
                'resolve-event': 'resolved',
            }[actionButton?.dataset.action];
            if (!status || !state.selectedItemId) {
                return;
            }
            await updateReaderEvent(state.selectedItemId, status);
            state.selectedItemId = '';
            saveState();
            setStatus(status === 'resolved' ? '产品事件已标记为处理完成。' : '产品事件已标记为误报。');
            await renderCounts();
            await resetArticlePagination();
            await renderReader();
            return;
        }
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
    await loadServerFeeds({ quiet: true });
    await loadMultiAiSummaryPrompt({ quiet: true });
    bindEvents();
    if (shouldPersistLoadedState) {
        saveState();
    }
    render();
    window.setInterval(tick, 1000);
}

void initialize();
