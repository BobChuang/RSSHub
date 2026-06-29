# Telegram 服务端订阅同步与限速方案

日期：2026-06-29

## 目标

1. 所有成功拉取到的订阅条目都写入 reader 数据库，避免 RSS 响应生成后数据只停留在缓存或浏览器内存里。
2. 将 reader 的自动刷新从“浏览器前台页面驱动”改成“服务端订阅调度驱动”。
3. 本地 reader 仍然显示每个频道下次刷新的倒计时，但倒计时来源改为服务端的 `nextFetchAt`。
4. 在左下角设置菜单中新增一个“服务端订阅”入口，与“导入配置”“导出配置”同级。
5. 为 Telegram 按 key/session 做统一限速，避免多个频道同时使用同一个 key 导致请求过频。

## 当前状态

- `/reader` 的订阅配置主要保存在浏览器 `localStorage`。
- 前端通过 `tick()` 每秒检查是否需要刷新。
- `tick()` 中存在 `document.visibilityState === 'hidden'` 时直接跳过刷新，所以页面必须挂在前台才会继续更新。
- 前端拉取 feed 后，会通过 `/api/reader/items/bulk` 把条目写入 `reader_items`。
- RSSHub 路由本身有服务端缓存，但这个缓存不是 reader 的长期历史数据库。
- `/telegram/channel/:username` 目前有两种路径：
    - 未配置 `TELEGRAM_SESSION` 或带额外参数时，抓取 `https://t.me/s/:username` 页面。
    - 配置 `TELEGRAM_SESSION` 且基础路由时，走 Telegram API client。
- Telegram API 调用分散在多个文件里，限速逻辑需要抽成公共模块。

## 总体架构

新增三层能力：

1. 数据持久化层：统一负责 feed 元数据和 item 入库。
2. 服务端订阅调度器：定时扫描到期 feed，拉取、入库、更新下次刷新时间。
3. Telegram key 限速层：所有 Telegram API 请求进入同一个按 key 分组的队列。

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

## Telegram key 限速方案

新增 Telegram 专用限速模块，例如：

- `lib/routes/telegram/tglib/rate-limit.ts`

建议配置：

```env
TELEGRAM_REQUEST_INTERVAL=1
TELEGRAM_RATE_LIMIT_QUEUE_SIZE=1000
TELEGRAM_RATE_LIMIT_BACKEND=auto
```

含义：

- `TELEGRAM_REQUEST_INTERVAL=1` 表示同一个 Telegram key/session 的请求至少间隔 1 秒。
- 1 秒内进来的第二个请求不会直接打 Telegram，而是进入队列等待。
- `auto` 表示有 Redis 就用 Redis 做跨进程限速，没有 Redis 就用内存限速。

key 身份计算：

- 不记录、不打印原始 `TELEGRAM_SESSION`、`TELEGRAM_API_HASH` 或 token。
- 使用 hash 后的身份作为 limiter key：

```text
sha256(apiId + ':' + apiHash + ':' + sessionOrToken)
```

单进程部署：

- 使用内存队列即可。
- 每个 Telegram key 一个队列。

多进程或多容器部署：

- 必须使用 Redis-backed limiter。
- 如果检测到没有 Redis，只能保证当前进程内串行，需要打 warning。

需要包裹的 Telegram API 调用：

- `client.getInputEntity(...)`
- `client.getEntity(...)`
- `client.getMessages(...)`
- `client.invoke(...)`
- 如果媒体下载也会触发 Telegram API 请求，也要进入同一个 limiter。

重点文件：

- `lib/routes/telegram/tglib/channel.ts`
- `lib/routes/telegram/topic.ts`
- `lib/routes/telegram/topics.ts`
- `lib/routes/telegram/stories.ts`
- `lib/routes/telegram/channel-media.ts`

`https://t.me/s/...` 网页抓取路径不使用 Telegram key，所以不需要进入这个 key limiter；它继续依赖 RSSHub 路由缓存和全局请求限速。

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

### 阶段 5：Telegram 限速

- 加配置项。
- 先实现内存 limiter。
- Redis 可用时自动切到 Redis limiter。
- 包裹所有 Telegram API 调用点。
- 加测试：两个 Telegram feed 同时刷新时，第二个请求至少晚 `TELEGRAM_REQUEST_INTERVAL` 执行。

### 阶段 6：验收

- 使用测试 PostgreSQL 启动服务。
- 配置同一个 Telegram session。
- 添加两个 Telegram 服务端订阅。
- 设置 `TELEGRAM_REQUEST_INTERVAL=1`。
- 同时触发两个订阅刷新。
- 验证：
    - 两个请求最终都完成。
    - 第二个 Telegram API 请求至少晚 1 秒开始。
    - 两个 feed 的 item 都进入 `reader_items`。
    - `reader_feeds.next_fetch_at` 正确更新。
    - `/reader` 关闭后服务端仍继续刷新。

## 风险和决策

- 当前 reader 数据库是实例级共享的。如果实例公开访问，服务端订阅链接和历史条目也可能被别人看到。公开部署前建议增加 `READER_ADMIN_TOKEN` 或其他鉴权。
- “所有路由结果入库”可能保存带私密参数的 route 内容。自用实例这是合理的，但需要在配置说明中写清楚。
- 多进程限速必须依赖 Redis；没有 Redis 时只能保证单进程内限速。
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
- 同一 Telegram key/session 的 API 请求按 `TELEGRAM_REQUEST_INTERVAL` 排队执行。
- Redis 存在时限速跨进程生效；没有 Redis 时单进程生效并打印提醒。
