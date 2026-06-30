# Telegram 服务端订阅同步与公开网页抓取方案

日期：2026-06-30

## 目标

1. 所有成功拉取到的订阅条目都写入 reader 数据库，避免 RSS 响应生成后数据只停留在缓存或浏览器内存里。
2. 将 reader 的自动刷新从“浏览器前台页面驱动”改成“服务端订阅调度驱动”。
3. 本地 reader 仍然显示每个频道下次刷新的倒计时，但倒计时来源改为服务端的 `nextFetchAt`。
4. 在左下角设置菜单中新增一个“服务端订阅”入口，与“导入配置”“导出配置”同级。
5. Telegram 公开频道改为强制使用 `https://t.me/s/:username` 公开网页抓取，不再依赖 `TELEGRAM_SESSION`、`TELEGRAM_API_ID`、`TELEGRAM_API_HASH` 换取或维持用户 session。

## 当前状态

- `/reader` 的订阅配置主要保存在浏览器 `localStorage`。
- 前端通过 `tick()` 每秒检查是否需要刷新。
- `tick()` 中存在 `document.visibilityState === 'hidden'` 时直接跳过刷新，所以页面必须挂在前台才会继续更新。
- 前端拉取 feed 后，会通过 `/api/reader/items/bulk` 把条目写入 `reader_items`。
- RSSHub 路由本身有服务端缓存，但这个缓存不是 reader 的长期历史数据库。
- `/telegram/channel/:username` 目前有两种路径：
    - 未配置 `TELEGRAM_SESSION` 或带额外参数时，抓取 `https://t.me/s/:username` 页面。
    - 配置 `TELEGRAM_SESSION` 且基础路由时，走 Telegram API client。
- 由于本需求不需要历史数据，长期同步不应再走 Telegram API client；公开频道统一使用 `https://t.me/s/:username` 页面抓取。
- `TELEGRAM_SESSION`、`TELEGRAM_API_ID`、`TELEGRAM_API_HASH` 仅保留给其他明确需要 MTProto 的路由或临时补历史场景，不作为 reader 服务端订阅的默认链路。

## 总体架构

新增三层能力：

1. 数据持久化层：统一负责 feed 元数据和 item 入库。
2. 服务端订阅调度器：定时扫描到期 feed，拉取、入库、更新下次刷新时间。
3. Telegram 公开网页抓取层：公开频道统一通过 `https://t.me/s/:username` 获取最新消息，避免用户 session 掉线。

前端从“刷新执行者”改成“状态展示和配置管理者”。

## 数据库设计

继续复用现有 `reader_items` 存条目，新增服务端订阅表。

### `reader_feeds`

用于保存所有服务端订阅链接和刷新状态。

建议字段：

- `id TEXT PRIMARY KEY`
- `url TEXT NOT NULL UNIQUE`
- `title TEXT NOT NULL DEFAULT ''`
- `home_url TEXT NOT NULL DEFAULT ''`
- `category TEXT NOT NULL DEFAULT 'articles'`
- `group_name TEXT NOT NULL DEFAULT ''`
- `refresh_seconds INTEGER NOT NULL DEFAULT 300`
- `server_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `paused BOOLEAN NOT NULL DEFAULT FALSE`
- `last_fetched_at TIMESTAMPTZ`
- `next_fetch_at TIMESTAMPTZ`
- `last_error TEXT NOT NULL DEFAULT ''`
- `sync_locked_until TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### `reader_fetch_runs`

可选，但推荐加，方便排查为什么某个频道没刷新。

建议字段：

- `id BIGSERIAL PRIMARY KEY`
- `feed_id TEXT NOT NULL`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `finished_at TIMESTAMPTZ`
- `status TEXT NOT NULL`
- `item_count INTEGER NOT NULL DEFAULT 0`
- `error TEXT NOT NULL DEFAULT ''`

## 持久化方案

新增一个后端 store 模块，例如：

- `lib/api/reader/store.ts`

职责：

- 初始化 schema。
- 新增或更新 feed。
- 查询 feed 列表。
- 修改 feed 的刷新间隔、暂停状态、分类、分组。
- 删除 feed。
- 批量 upsert item。
- 记录每次刷新结果。

ID 生成规则需要服务端化，并与现有 reader 前端逻辑兼容：

- feedId：对规范化后的 feed URL 做稳定 hash。
- itemId：对 `feedId + ':' + (guid || link || title)` 做稳定 hash。
- 入库使用 `ON CONFLICT (id) DO UPDATE`，避免重复条目。

条目只保存 RSSHub item 中 reader 已支持的字段：

- `title`
- `link`
- `author`
- `pubDate`
- `pubDateMs`
- `description`
- `summary`
- `categories`
- `category`
- `isRead`
- `isStarred`
- `searchText`

不保存媒体二进制内容，只保存 HTML、链接、封面、enclosure URL 等元数据。

## 所有拉取结果入库

需要覆盖两类来源。

### 1. reader/server subscription 拉取

服务端调度器每次拉取后，必须调用统一 store 写入 `reader_items`。

这是最重要路径，也是后续 reader 历史数据的主来源。

### 2. 普通 RSSHub 路由请求

在 RSSHub 路由成功返回 `Data` 后加一个持久化 hook：

- 如果数据库已配置，提取 `Data.item` 并入库。
- 如果命中路由缓存，也可以对缓存中的 `Data` 做一次幂等 upsert。
- 如果入库失败，不影响正常 RSS 响应，只记录日志。
- 如果没有配置 `READER_DATABASE_URL` 或 `DATABASE_URL`，跳过入库。

建议加一个开关：

```env
READER_PERSIST_FETCHED_ITEMS=1
```

本需求中可以默认在 reader 数据库存在时开启，同时保留这个变量作为紧急关闭开关。

## 服务端订阅调度器

新增调度模块，例如：

- `lib/api/reader/scheduler.ts`

调度流程：

1. 应用启动且 reader 数据库可用时启动 scheduler。
2. 每隔几秒扫描 `reader_feeds`。
3. 找出满足条件的订阅：
    - `server_sync_enabled = TRUE`
    - `paused = FALSE`
    - `next_fetch_at IS NULL OR next_fetch_at <= NOW()`
4. 使用数据库锁认领任务，避免多进程同时刷新同一个 feed。
5. 拉取 feed。
6. 将拉取到的 item 写入 `reader_items`。
7. 更新 `last_fetched_at`、`next_fetch_at`、`last_error`。
8. 写入 `reader_fetch_runs`。

任务认领建议：

- PostgreSQL 中使用 `FOR UPDATE SKIP LOCKED`。
- 对长时间任务增加 `sync_locked_until`，避免进程崩溃后永久卡住。

刷新时间规则：

- `refresh_seconds` 是服务端唯一可信来源。
- 成功后：`next_fetch_at = NOW() + refresh_seconds`。
- 失败后：记录错误，并仍然按 `refresh_seconds` 安排下次尝试。
- 第一版不做复杂退避，保持行为可预测。

拉取策略：

- 如果 URL 是当前 RSSHub 实例的本地 route，可以通过本机 HTTP 地址请求，复用现有路由、缓存和鉴权逻辑。
- 如果 URL 是 Telegram 公开频道 route，scheduler 请求本机 route 时必须强制选择公开网页抓取路径，避免因为实例配置了 `TELEGRAM_SESSION` 而自动切到 Telegram API client。
- 如果 URL 是外部 RSS/Atom/JSON Feed，则由 scheduler 自己解析并入库。
- 解析后的 item shape 与当前 reader 前端 `parseFeed`/`normalizeParsedItems` 保持一致。

## reader 前端调整

前端不再负责定时刷新，只负责展示、配置和手动触发。

### 订阅配置来源

- 新增 `/api/reader/feeds` 系列接口。
- 添加、编辑 feed 时写入 `reader_feeds`。
- 本地 `localStorage` 只保留 UI 状态，例如选中的分类、搜索词、折叠分组。
- feed URL、标题、分类、分组、刷新间隔、暂停状态、上次刷新时间、下次刷新时间都以后端为准。

### 倒计时

- 页面仍然每秒刷新 UI。
- 倒计时使用服务端返回的 `nextFetchAt`。
- 页面隐藏或关闭后，服务端仍继续刷新。
- 手动刷新按钮改为调用：

```text
POST /api/reader/feeds/:feedId/refresh
```

### 新增“服务端订阅”弹窗

在左下角设置菜单中新增：

- `导入配置`
- `导出配置`
- `服务端订阅`

弹窗展示字段：

- 链接
- 标题
- 分类
- 分组
- 刷新间隔
- 是否启用服务端同步
- 是否暂停
- 上次刷新时间
- 下次刷新时间和倒计时
- 最后错误

弹窗操作：

- 修改单个链接的刷新时间。
- 批量修改刷新时间。
- 暂停或恢复订阅。
- 立即刷新。
- 删除订阅。

建议 API：

- `GET /api/reader/feeds`
- `POST /api/reader/feeds`
- `PATCH /api/reader/feeds/:feedId`
- `DELETE /api/reader/feeds/:feedId`
- `POST /api/reader/feeds/:feedId/refresh`
- `PATCH /api/reader/feeds/bulk`

## Telegram 公开网页抓取方案

本方案不需要历史数据，因此公开频道不再使用 `app_id + api_hash + session` 的 MTProto 用户会话。

目标行为：

- `/telegram/channel/:username` 在 reader 服务端订阅场景中始终使用 `https://t.me/s/:username` 公开网页抓取。
- 即使实例配置了 `TELEGRAM_SESSION`，服务端订阅也不能因为基础路由而自动切到 Telegram API client。
- 不再新增 Telegram key/session 级别限速；公开网页抓取继续依赖 RSSHub 路由缓存、HTTP 请求限速和 scheduler 的 `refresh_seconds`。

建议做法：

1. 给 Telegram channel route 增加显式参数，例如 `?mode=web`、`?force_web=1` 或内部 scheduler-only 标记。
2. scheduler 发现 feed 是 `/telegram/channel/:username` 时，请求本机 route 自动追加该参数。
3. route 中的分支逻辑调整为：
    - 显式要求公开网页抓取时，直接走 `https://t.me/s/:username`。
    - 没有显式要求时，保留现有兼容行为，避免影响已有用户。
4. reader 服务端订阅只保存普通 feed URL；强制网页抓取参数可以在 scheduler 请求本机 route 时临时追加，避免污染用户看到的订阅链接。

网页抓取限制：

- 只适用于公开频道。
- 不保证完整历史，只用于持续获取最新可见消息。
- Telegram 网页 HTML 结构变化时需要维护 parser。
- 私有频道、群组、forum topic 若没有公开网页入口，不纳入本方案。

重点文件：

- `lib/routes/telegram/channel.ts` 或当前 `/telegram/channel/:username` route 实现文件。
- Telegram channel route 内部调用 `https://t.me/s/:username` 的抓取/parser 逻辑。
- `lib/api/reader/scheduler.ts`：识别 Telegram channel feed 并追加强制网页抓取参数。

保留但不作为本方案主路径：

- `TELEGRAM_SESSION`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `lib/routes/telegram/tglib/*`

这些配置和模块只服务于其他仍需要 MTProto 的 Telegram route，或未来需要一次性补历史时再单独使用。

## 实施阶段

### 阶段 1：抽出 reader store 和 schema

- 把现有 reader 数据库逻辑抽成公共 store。
- 新增 `reader_feeds`。
- 可选新增 `reader_fetch_runs`。
- 保持现有 `/api/reader/items/bulk` 可用。
- 给 feed upsert、item upsert 加测试。

### 阶段 2：所有路由结果入库

- 在 RSSHub route 成功返回 `Data` 后增加持久化 hook。
- 普通 RSS 请求入库失败不影响 RSS 响应。
- 验证直接请求 `/telegram/channel/...` 后，`reader_items` 中能看到条目。

### 阶段 3：服务端 scheduler

- 增加调度循环。
- 增加任务认领和刷新状态更新。
- 增加手动刷新接口。
- 验证 `/reader` 关闭或隐藏后，服务端仍持续刷新。

### 阶段 4：前端弹窗和倒计时

- 前端从 `/api/reader/feeds` 加载服务端订阅。
- 左下角设置菜单加入“服务端订阅”。
- 弹窗支持列表、修改间隔、暂停、恢复、立即刷新、删除。
- 倒计时改为使用服务端 `nextFetchAt`。

### 阶段 5：Telegram 公开网页抓取

- 在 Telegram channel route 中增加显式强制网页抓取参数或内部标记。
- 确保强制网页抓取时不会读取或使用 `TELEGRAM_SESSION`。
- 在 scheduler 请求 Telegram channel feed 时自动追加该参数或标记。
- 加测试：即使配置了 `TELEGRAM_SESSION`，服务端订阅刷新 `/telegram/channel/:username` 仍走 `https://t.me/s/:username` 路径。
- 加测试：用户直接访问原 route 时保持现有兼容行为，除非显式传入强制网页抓取参数。

### 阶段 6：验收

- 使用测试 PostgreSQL 启动服务。
- 可故意配置一组 `TELEGRAM_SESSION` / `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`，用于验证服务端订阅不会误走 MTProto。
- 添加两个公开 Telegram channel 服务端订阅。
- 同时触发两个订阅刷新。
- 验证：
    - 两个请求最终都完成。
    - 请求路径使用 `https://t.me/s/:username` 公开网页抓取。
    - 不初始化 Telegram API client，不读取 user session。
    - 两个 feed 的 item 都进入 `reader_items`。
    - `reader_feeds.next_fetch_at` 正确更新。
    - `/reader` 关闭后服务端仍继续刷新。

## 风险和决策

- 当前 reader 数据库是实例级共享的。如果实例公开访问，服务端订阅链接和历史条目也可能被别人看到。公开部署前建议增加 `READER_ADMIN_TOKEN` 或其他鉴权。
- “所有路由结果入库”可能保存带私密参数的 route 内容。自用实例这是合理的，但需要在配置说明中写清楚。
- 公开网页抓取依赖 Telegram Web 页面结构，HTML 改版会导致 parser 失效，需要保留错误记录和告警。
- 公开网页抓取只覆盖公开频道，不覆盖私有频道、普通群组和没有公开网页的 forum topic。
- scheduler 通过 HTTP 拉取本机 route 时，要避免循环触发问题。因为 item upsert 是幂等的，可以接受 route persistence 和 scheduler persistence 都执行。
- 现有缓存仍然有价值。scheduler 默认不应绕过缓存，除非用户点击“立即刷新”并明确需要刷新上游。

## 验收标准

- reader 数据库配置存在时，成功拉取到的 item 会进入 PostgreSQL。
- 服务端订阅刷新得到的 item 会进入 `reader_items`。
- 普通 RSSHub route 请求成功后，也会尽量入库。
- 自动刷新不再依赖 `/reader` 是否在前台。
- `/reader` 能显示服务端返回的下次刷新倒计时。
- 左下角设置菜单包含“服务端订阅”入口。
- 服务端订阅弹窗可查看所有链接和时间，并可修改刷新间隔。
- Telegram 公开频道服务端订阅强制走 `https://t.me/s/:username` 公开网页抓取。
- 即使配置了 `TELEGRAM_SESSION`，公开频道服务端订阅也不会初始化 Telegram API client 或使用用户 session。
