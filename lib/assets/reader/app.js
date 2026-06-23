/* oxlint-disable eslint-js/no-implicit-globals eslint/require-await eslint/no-unused-vars unicorn/no-array-callback-reference unicorn/no-array-for-each unicorn/no-useless-fallback-in-spread unicorn/numeric-separators-style unicorn/prefer-code-point unicorn/prefer-query-selector unicorn/prefer-set-has unicorn/prefer-string-replace-all unicorn-js/no-computed-property-existence-check unicorn-js/prefer-else-if */

const storageKey = 'rsshub-reader-state-v1';
const legacyArticleCleanupKey = 'rsshub-reader-legacy-article-cleanup-v1';
const articlePageSize = 50;
const defaultRefreshMinutes = 5;
const globalRefreshOffValue = 'off';
const globalRefreshOnValue = 'on';
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
    feedCategoryInput: document.querySelector('#feedCategoryInput'),
    feedGroupInput: document.querySelector('#feedGroupInput'),
    feedIntervalInput: document.querySelector('#feedIntervalInput'),
    feedModalTitle: document.querySelector('#feedModalTitle'),
    feedUrlInput: document.querySelector('#feedUrlInput'),
    globalIntervalSelect: document.querySelector('#globalIntervalSelect'),
    markAllReadButton: document.querySelector('#markAllReadButton'),
    openAddFeedButton: document.querySelector('#openAddFeedButton'),
    readerPane: document.querySelector('#readerPane'),
    readerStatus: document.querySelector('#readerStatus'),
    refreshButton: document.querySelector('#refreshButton'),
    runAiSummaryButton: document.querySelector('#runAiSummaryButton'),
    searchInput: document.querySelector('#searchInput'),
    sourceList: document.querySelector('#sourceList'),
};

let legacyItemsToMigrate = [];
let shouldPersistLoadedState = false;

const state = loadState();
const fetchingFeedIds = new Set();
let editingFeedId = '';
let summarizingFeedId = '';
let articleOffset = 0;
let hasMoreArticles = true;
let isLoadingArticles = false;
let renderToken = 0;

function loadState() {
    const fallback = {
        baseUrl: window.location.origin,
        collapsedGroups: {},
        feeds: [],
        globalRefreshEnabled: true,
        items: [],
        readFilter: 'all',
        search: '',
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

async function markCurrentListRead() {
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
    if (state.selectedSource !== 'all') {
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
    if (state.selectedSource !== 'all') {
        params.set('feedId', state.selectedSource);
    }
    if (state.search) {
        params.set('search', state.search);
    }
    return readerApi('/items/counts' + (params.size ? '?' + params.toString() : ''));
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
        const counts = await getItemCounts();
        document.querySelectorAll('[data-category-count]').forEach((countElement) => {
            countElement.textContent = String(counts[countElement.dataset.categoryCount] || 0);
        });
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Reader database request failed.');
    }
}

function renderSources() {
    document.querySelectorAll('.category-button').forEach((button) => {
        button.classList.toggle('active', button.dataset.category === state.selectedCategory);
    });

    elements.sourceList.innerHTML = '';
    const visibleFeeds = getVisibleFeeds();
    for (const group of getFeedGroups(visibleFeeds)) {
        if (group.key === ungroupedGroupKey) {
            group.feeds.forEach((feed) => elements.sourceList.append(createFeedRow(feed)));
            continue;
        }

        const section = document.createElement('section');
        section.className = 'feed-group';

        const collapsed = Boolean(state.collapsedGroups[group.key]);
        const toggle = document.createElement('button');
        toggle.className = 'feed-group-toggle';
        toggle.type = 'button';
        toggle.dataset.groupKey = group.key;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.append(createText('span', 'feed-group-arrow', collapsed ? '▸' : '▾'), createText('span', 'feed-group-title', group.label), createText('strong', 'feed-group-count', String(group.feeds.length)));
        section.append(toggle);

        if (!collapsed) {
            const body = document.createElement('div');
            body.className = 'feed-group-body';
            group.feeds.forEach((feed) => body.append(createFeedRow(feed)));
            section.append(body);
        }
        elements.sourceList.append(section);
    }

    if (!visibleFeeds.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.innerHTML = '<h2>No feeds</h2><p>Use + to add a feed to this category.</p>';
        elements.sourceList.append(empty);
    }
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

function createFeedRow(feed) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.classList.toggle('active', state.selectedSource === feed.id);

    const button = document.createElement('button');
    button.className = 'feed-button';
    button.type = 'button';
    button.dataset.feedId = feed.id;

    const title = document.createElement('span');
    title.className = 'feed-title';
    title.textContent = feed.title || feed.url;

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
    summarizingFeedId = feed.id;
    elements.aiSummaryFeedTitle.textContent = feed.title || feed.url;
    elements.aiSummaryRangeInput.value = '1';
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '选择范围后生成该订阅源的摘要。'));
    elements.aiSummaryModal.hidden = false;
    window.setTimeout(() => elements.aiSummaryRangeInput.focus(), 0);
}

function closeAiSummaryModal() {
    summarizingFeedId = '';
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
    const feed = getFeed(summarizingFeedId);
    if (!feed) {
        return;
    }

    const days = Number(elements.aiSummaryRangeInput.value) === 7 ? 7 : 1;
    elements.runAiSummaryButton.disabled = true;
    elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-placeholder', '正在收集内容并生成总结...'));
    try {
        const result = await getAiSummary(feed.id, days);
        renderAiSummaryResult(result);
        setStatus('AI summary ready for ' + feed.title + '.');
    } catch (error) {
        elements.aiSummaryResult.replaceChildren(createText('p', 'ai-summary-error', error instanceof Error ? error.message : 'AI summary failed.'));
    } finally {
        elements.runAiSummaryButton.disabled = false;
    }
}

function tick() {
    renderSources();
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
        const card = event.target.closest('.article-card');
        if (card?.dataset.itemId) {
            selectItem(card.dataset.itemId);
        }
    });
    elements.articleList.addEventListener('scroll', () => {
        const remaining = elements.articleList.scrollHeight - elements.articleList.scrollTop - elements.articleList.clientHeight;
        if (remaining < 160) {
            void loadMoreArticles();
        }
    });
    elements.readerPane.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-action]');
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
