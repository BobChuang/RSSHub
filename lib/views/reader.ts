export const readerHtml = String.raw`<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>RSSHub Reader</title>
        <link rel="icon" href="/favicon.png">
        <link rel="stylesheet" href="/reader/app.css?v=ai-summary-push-tasks">
        <script type="module" src="/reader/app.js?v=ai-summary-push-tasks"></script>
    </head>
    <body>
        <main class="app-shell">
            <aside class="sidebar">
                <header class="brand">
                    <a class="brand-mark" href="/" aria-label="RSSHub home">
                        <img src="/logo.svg" alt="">
                    </a>
                    <div>
                        <h1>RSSHub Reader</h1>
                        <p id="readerStatus">Ready</p>
                    </div>
                    <div class="brand-actions">
                        <label class="refresh-menu" for="globalIntervalSelect">
                            <span>Refresh</span>
                            <select id="globalIntervalSelect" aria-label="Global auto refresh">
                                <option value="on">ON</option>
                                <option value="off">OFF</option>
                            </select>
                        </label>
                        <button id="openAddFeedButton" class="round-button" type="button" title="Add feed" aria-label="Add feed">+</button>
                    </div>
                </header>

                <nav class="category-nav" aria-label="Categories">
                    <button class="category-button active" type="button" data-category="all">
                        <span>全部</span>
                        <strong data-category-count="all">0</strong>
                    </button>
                    <button class="category-button event-category-button" type="button" data-category="events">
                        <span>事件</span>
                        <strong data-category-count="events">0</strong>
                    </button>
                    <button class="category-button" type="button" data-category="articles">
                        <span>文章</span>
                        <strong data-category-count="articles">0</strong>
                    </button>
                    <button class="category-button" type="button" data-category="social">
                        <span>社媒</span>
                        <strong data-category-count="social">0</strong>
                    </button>
                    <button class="category-button" type="button" data-category="chat">
                        <span>聊天</span>
                        <strong data-category-count="chat">0</strong>
                    </button>
                    <button class="category-button" type="button" data-category="videos">
                        <span>视频</span>
                        <strong data-category-count="videos">0</strong>
                    </button>
                    <button class="category-button" type="button" data-category="notifications">
                        <span>通知</span>
                        <strong data-category-count="notifications">0</strong>
                    </button>
                </nav>

                <div class="source-list" id="sourceList" aria-label="Feed sources"></div>
                <footer class="sidebar-settings">
                    <button id="settingsButton" class="settings-button" type="button" title="Settings" aria-label="Settings" aria-expanded="false">⚙</button>
                    <button id="openGlobalAiSummaryButton" class="settings-button ai-summary-sidebar-button" type="button" title="AI 总结" aria-label="AI 总结">AI</button>
                    <div id="settingsMenu" class="settings-menu" hidden>
                        <button id="importConfigButton" class="settings-menu-button" type="button">导入配置</button>
                        <button id="exportConfigButton" class="settings-menu-button" type="button">导出配置</button>
                        <button id="openServerFeedsButton" class="settings-menu-button" type="button">服务端订阅</button>
                    </div>
                    <input id="importConfigInput" type="file" accept="application/json,.json" hidden>
                </footer>
            </aside>

            <section class="article-column">
                <div class="article-toolbar">
                    <div class="search-wrap">
                        <input id="searchInput" type="search" autocomplete="off" placeholder="Search articles">
                    </div>
                    <div id="readFilter" class="read-filter" aria-label="Read status">
                        <button class="read-filter-button active" type="button" data-read-filter="all">All</button>
                        <button class="read-filter-button" type="button" data-read-filter="unread">Unread</button>
                    </div>
                    <div class="toolbar-actions">
                        <button id="refreshButton" class="toolbar-button icon-toolbar-button" type="button" title="Refresh now" aria-label="Refresh now">↻</button>
                        <button id="markAllReadButton" class="toolbar-button icon-toolbar-button" type="button" title="Mark current list as read" aria-label="Mark current list as read">✓✓</button>
                    </div>
                </div>
                <div class="article-list" id="articleList"></div>
            </section>

            <article class="reader-pane" id="readerPane">
                <div class="empty-pane">
                    <h2>No article selected</h2>
                    <p>Add a feed or choose an article from the list.</p>
                </div>
            </article>
        </main>

        <div id="addFeedModal" class="modal" hidden>
            <form id="addFeedForm" class="modal-card">
                <header class="modal-header">
                    <h2 id="feedModalTitle">添加订阅</h2>
                    <button id="closeAddFeedButton" class="round-button" type="button" aria-label="Close">X</button>
                </header>
                <label class="modal-field" for="feedUrlInput">
                    <span>RSS 链接或 route</span>
                    <input id="feedUrlInput" type="text" autocomplete="off" spellcheck="false" placeholder="https://rsshub.app/github/trending/daily/javascript">
                </label>
                <label class="modal-field" for="feedGroupInput">
                    <span>分组</span>
                    <input id="feedGroupInput" type="text" autocomplete="off" placeholder="可选">
                </label>
                <div class="modal-grid">
                    <label class="modal-field" for="feedCategoryInput">
                        <span>分类</span>
                        <select id="feedCategoryInput">
                            <option value="articles">文章</option>
                            <option value="social">社媒</option>
                            <option value="chat">聊天</option>
                            <option value="videos">视频</option>
                            <option value="notifications">通知</option>
                        </select>
                    </label>
                    <label class="modal-field" for="feedIntervalInput">
                        <span>Refresh</span>
                        <select id="feedIntervalInput">
                            <option value="1">1 分钟</option>
                            <option value="3">3 分钟</option>
                            <option value="5">5 分钟</option>
                            <option value="10">10 分钟</option>
                            <option value="30">30 分钟</option>
                        </select>
                    </label>
                </div>
                <footer class="modal-actions">
                    <button id="deleteFeedButton" class="danger-icon-button" type="button" title="Delete feed" aria-label="Delete feed" hidden>🗑</button>
                    <div class="modal-action-group">
                        <button id="cancelAddFeedButton" class="secondary-button" type="button">Cancel</button>
                        <button id="addFeedButton" class="primary-button" type="submit">Add</button>
                    </div>
                </footer>
            </form>
        </div>

        <div id="serverFeedsModal" class="modal" hidden>
            <section class="modal-card server-feeds-card">
                <header class="modal-header">
                    <div>
                        <h2>服务端订阅</h2>
                        <p class="modal-subtitle">管理所有由服务器后台同步的链接。</p>
                    </div>
                    <button id="closeServerFeedsButton" class="round-button" type="button" aria-label="Close">X</button>
                </header>
                <div class="server-feeds-toolbar">
                    <label class="modal-field compact-field" for="serverFeedsBulkIntervalInput">
                        <span>批量间隔</span>
                        <select id="serverFeedsBulkIntervalInput">
                            <option value="60">1 分钟</option>
                            <option value="180">3 分钟</option>
                            <option value="300">5 分钟</option>
                            <option value="600">10 分钟</option>
                            <option value="1800">30 分钟</option>
                        </select>
                    </label>
                    <button id="applyServerFeedsBulkIntervalButton" class="secondary-button" type="button">应用到勾选</button>
                </div>
                <div class="server-feeds-table-wrap">
                    <table class="server-feeds-table">
                        <thead>
                            <tr>
                                <th><input id="serverFeedsSelectAllInput" type="checkbox" aria-label="Select all server feeds"></th>
                                <th>订阅</th>
                                <th>间隔</th>
                                <th>状态</th>
                                <th>时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="serverFeedsTableBody"></tbody>
                    </table>
                </div>
            </section>
        </div>

        <div id="aiSummaryModal" class="modal" hidden>
            <form id="aiSummaryForm" class="modal-card ai-summary-card">
                <header class="modal-header">
                    <div>
                        <h2>AI 总结</h2>
                        <p id="aiSummaryFeedTitle" class="modal-subtitle"></p>
                    </div>
                    <button id="closeAiSummaryButton" class="round-button" type="button" aria-label="Close">X</button>
                </header>
                <div class="ai-summary-config">
                    <div class="ai-summary-primary-config">
                        <label class="modal-field" for="aiSummaryRangeInput">
                            <span>总结范围</span>
                            <select id="aiSummaryRangeInput">
                                <option value="1">最近 1 天</option>
                                <option value="7">最近 7 天</option>
                            </select>
                        </label>
                        <div class="ai-summary-push-panel">
                            <div class="ai-summary-push-header">
                                <div>
                                    <strong>推送任务</strong>
                                    <small>可同时创建总结、原始实时推送和产品事件监控</small>
                                </div>
                                <button id="addAiSummaryPushButton" class="secondary-button compact-action-button" type="button">新增推送</button>
                            </div>
                            <div id="aiSummaryPushList" class="ai-summary-push-list" aria-live="polite"></div>
                            <div id="aiSummaryPushEditor" class="ai-summary-push-editor" hidden>
                                <div class="ai-summary-push-editor-header">
                                    <strong id="aiSummaryPushEditorTitle">新增推送</strong>
                                    <label class="ai-summary-push-toggle" for="aiSummaryPushEnabledInput">
                                        <input id="aiSummaryPushEnabledInput" type="checkbox" checked>
                                        <span>启用</span>
                                    </label>
                                </div>
                                <div class="ai-summary-push-editor-grid">
                                    <label class="modal-field" for="aiSummaryPushModeInput">
                                        <span>推送类型</span>
                                        <select id="aiSummaryPushModeInput">
                                            <option value="summary">定时总结</option>
                                            <option value="realtime">原始内容实时推送</option>
                                            <option value="event">产品事件监控</option>
                                        </select>
                                    </label>
                                    <div id="aiSummaryPushScheduleFields" class="ai-summary-push-schedule-fields">
                                        <label class="modal-field" for="aiSummaryPushCadenceInput">
                                            <span>发送频率</span>
                                            <select id="aiSummaryPushCadenceInput">
                                                <option value="daily">每天</option>
                                                <option value="weekly">每周</option>
                                            </select>
                                        </label>
                                        <label id="aiSummaryPushWeekdayField" class="modal-field" for="aiSummaryPushWeekdayInput" hidden>
                                            <span>星期</span>
                                            <select id="aiSummaryPushWeekdayInput">
                                                <option value="1">周一</option>
                                                <option value="2">周二</option>
                                                <option value="3">周三</option>
                                                <option value="4">周四</option>
                                                <option value="5">周五</option>
                                                <option value="6">周六</option>
                                                <option value="0">周日</option>
                                            </select>
                                        </label>
                                        <label class="modal-field" for="aiSummaryPushDaysInput">
                                            <span>回看范围</span>
                                            <select id="aiSummaryPushDaysInput">
                                                <option value="1">最近 1 天</option>
                                                <option value="7">最近 7 天</option>
                                            </select>
                                        </label>
                                        <label class="modal-field" for="aiSummaryPushTimeInput">
                                            <span>发送时间</span>
                                            <input id="aiSummaryPushTimeInput" type="time" value="09:00">
                                        </label>
                                    </div>
                                    <div id="aiSummaryPushEventFields" class="ai-summary-push-event-fields" hidden>
                                        <label class="modal-field" for="aiSummaryPushMinimumSeverityInput">
                                            <span>最低告警级别</span>
                                            <select id="aiSummaryPushMinimumSeverityInput">
                                                <option value="low">Low</option>
                                                <option value="medium" selected>Medium</option>
                                                <option value="high">High</option>
                                            </select>
                                        </label>
                                        <label class="modal-field" for="aiSummaryPushDedupeMinutesInput">
                                            <span>相似事件免打扰</span>
                                            <select id="aiSummaryPushDedupeMinutesInput">
                                                <option value="5">5 分钟</option>
                                                <option value="10" selected>10 分钟</option>
                                                <option value="30">30 分钟</option>
                                                <option value="60">60 分钟</option>
                                            </select>
                                        </label>
                                        <div class="ai-summary-push-preview">
                                            <button id="previewAiSummaryPushButton" class="secondary-button compact-action-button" type="button">用最近 20 条测试</button>
                                            <div id="aiSummaryPushPreviewResult" class="ai-summary-push-preview-result" aria-live="polite" hidden></div>
                                        </div>
                                    </div>
                                    <label class="modal-field ai-summary-push-webhook-field" for="aiSummaryWebhookInput">
                                        <span>Webhook</span>
                                        <input id="aiSummaryWebhookInput" type="url" placeholder="https://..." autocomplete="off">
                                    </label>
                                    <label class="modal-field ai-summary-push-prompt-field" for="aiSummaryPushPromptInput">
                                        <span id="aiSummaryPushPromptLabel">推送提示词</span>
                                        <textarea id="aiSummaryPushPromptInput" rows="3" spellcheck="false"></textarea>
                                    </label>
                                </div>
                                <small id="aiSummaryPushTimezone" class="ai-summary-push-timezone"></small>
                                <div class="ai-summary-push-editor-actions">
                                    <button id="cancelAiSummaryPushButton" class="secondary-button compact-action-button" type="button">取消</button>
                                    <button id="saveAiSummaryPushButton" class="primary-button compact-action-button" type="button">保存任务</button>
                                </div>
                            </div>
                            <p id="aiSummaryPushStatus" class="ai-summary-push-status"></p>
                        </div>
                    </div>
                    <div id="aiSummaryChannelField" class="modal-field ai-summary-channel-field" hidden>
                        <span>频道选择</span>
                        <div class="ai-summary-channel-toolbar">
                            <strong id="aiSummarySelectedCount">已选择 0 个</strong>
                            <div>
                                <button id="selectAllAiSummaryChannelsButton" class="secondary-button compact-action-button" type="button">全选</button>
                                <button id="clearAiSummaryChannelsButton" class="secondary-button compact-action-button" type="button">清空</button>
                            </div>
                        </div>
                        <div id="aiSummaryChannelList" class="ai-summary-channel-list"></div>
                    </div>
                </div>
                <label class="modal-field" for="aiSummaryPromptInput">
                    <span>AI 提示词</span>
                    <textarea id="aiSummaryPromptInput" class="ai-summary-prompt-input" spellcheck="false"></textarea>
                </label>
                <div class="ai-summary-result-wrap">
                    <button id="copyAiSummaryButton" class="ai-summary-copy-button" type="button" title="复制总结" aria-label="复制总结" hidden>⧉</button>
                    <div id="aiSummaryResult" class="ai-summary-result" aria-live="polite">
                        选择范围后生成该订阅源的摘要。
                    </div>
                </div>
                <footer class="modal-actions">
                    <div class="modal-action-group">
                        <button id="cancelAiSummaryButton" class="secondary-button" type="button">Cancel</button>
                        <button id="runAiSummaryButton" class="primary-button" type="submit">生成总结</button>
                    </div>
                </footer>
            </form>
        </div>
    </body>
</html>`;
