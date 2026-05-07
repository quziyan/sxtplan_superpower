# Slice 0 客户演示 Runbook

> **演示时长**:60–90 分钟 · 演示对象:客户方 IT / 业务负责人 · 演示目标:在客户机器上跑通从 Watchlist → 预测 → 审批 → 派单 → Webhook 回包 → 媒体回流 → 复盘 的完整闭环。
>
> **真实性声明(必读)**:Slice 0 的"摄像头后端"是 `SimulatedGuangzhouPoliceCamAdapter`(代码位于 `src/dispatch/adapters/simulated-gzp.ts`),它是**进程内的模拟器**,不是真实的广东省警务摄像头平台。模拟器会按真实平台的 webhook 协议(HMAC 签名 + idempotency key)反向回调本服务,假图片由本服务的 `/static/sim-media/:filename` 端点托管。Slice 0 的目的是验证流程正确性、节奏与 UI,**不是验证真实摄像头联调**。真实联调放在 m4 / Slice 1。

---

## 1. 目标 + 前置准备

### 演示要达成什么

- 客户能亲眼看到一条预测从被系统提出 → 决策审批 → 模拟派单 → 模拟回包 → 复盘留档的完整链路。
- 三个角色视角(分析师 / 决策者 / 复盘者)在同一份数据上各自工作,UI 一致、数据一致。
- 异常路径(取消、不可派单状态)也走一遍,证明系统不是"只跑 happy path"。

### 演示机器需要装好

| 工具 | 版本 | 说明 |
|---|---|---|
| **bun** | ≥ 1.3 | `bun --version` 确认。仓库脚本一律走 `bun`,不要用 npm/yarn/pnpm。 |
| **Docker + docker compose** | Docker Desktop / OrbStack 都行 | 跑 Postgres(PostGIS 16-3.4)+ Redis 7。 |
| **Git + 仓库代码** | 本仓库 main 分支最新版 | 假设代码已 clone 到演示机。 |
| **空闲端口** | 3000(后端)、5173(前端)、5432(Postgres,可改)、6379(Redis,可改) | 用 `lsof -i :3000` 确认未被占用。 |

### `.env` 文件就位

仓库根目录复制一份:`cp .env.example .env`,然后照下面三组改。**所有变量名**与 `.env.example` 严格一致(别自己造):

```bash
# --- 数据库(本机演示直接用默认即可)---
POSTGRES_USER=cnp
POSTGRES_PASSWORD=cnp_dev
POSTGRES_DB=cnp
POSTGRES_PORT=5432
DATABASE_URL=postgres://cnp_app:cnp_app_pwd@localhost:5432/cnp
DATABASE_ADMIN_URL=postgres://cnp:cnp_dev@localhost:5432/cnp

# --- Redis ---
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# --- App ---
PORT=3000
NODE_ENV=development           # 关键:NODE_ENV != production 才会挂载 /__demo/* 助手路由
SESSION_SECRET=<64 位随机 hex,生成命令见下>
COOKIE_DOMAIN=localhost

# --- LLM(m2 起读)---
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=<阿里云 dashscope key,演示前先 curl 一下确认通>
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT_MS=30000

# --- Webhook(模拟器与真实摄像头共用同一个 HMAC 协议)---
WEBHOOK_HMAC_SECRET=dev-secret-32-chars-replace-prod

# --- Simulated Guangzhou Police Cam(Slice 0 必开)---
SIMULATED_GZP_ENABLED=true
SIMULATED_GZP_API_KEY=test-key
SIMULATED_GZP_WEBHOOK_URL=http://localhost:3000/webhook/simulated-gzp
SIMULATED_GZP_FAKE_MEDIA_BASE=http://localhost:3000/static/sim-media/
```

`SESSION_SECRET` 生成:`openssl rand -hex 32`。

> **不需要在演示前配的**:`AMAP_API_KEY`、`SEARCH_API_KEY`、`OSS_*`、`DASHSCOPE_API_KEY`(后者已被 `LLM_*` 替代,留空可)。Slice 0 只需要 `LLM_*` 与 `SIMULATED_GZP_*`。

### 期望

- `bun --version` 输出 ≥ 1.3。
- `docker compose version` 不报错。
- `.env` 已存在,关键变量都已填。

---

## 2. 启动后端基础设施

### 2.1 拉起 Postgres + Redis

仓库根目录:

```bash
docker compose up -d
docker compose ps
```

**期望**:`cnp-postgres` 和 `cnp-redis` 两个容器都是 `Up (healthy)` 状态。

### 2.2 跑数据库迁移

```bash
bun run db:migrate
```

**期望**:打印一连串 `applying migration ...` 然后退出码 0。再次执行应该立刻退出(幂等)。

### 2.3 灌警务任务/车辆分类种子

```bash
bun run seed:taxonomy:police
```

**期望**:打印 `seeded N taxonomy nodes`(N 取决于种子文件,通常几十到一百多)。

### 2.4 灌系统初始账号

```bash
bun run seed:bootstrap
```

**期望**:打印 `[seed:bootstrap] admin created: admin@cnp.local / admin1234`(首次运行)或 `admin already exists`(再次)。这是后面登录用的超级账号,默认拥有 ANALYST / DECIDER / REVIEWER 三个角色。

---

## 3. 启动 server + workers + frontend(三个终端)

### 终端 A — HTTP server

```bash
bun src/server.ts
```

**期望日志**:

```
[info] server starting { port: 3000 }
[info] demo routes mounted { path: '/__demo' }
```

第二行是关键 —— 它证明 `NODE_ENV !== production` 生效、`/__demo/*` 助手已就绪。

健康检查:`curl http://localhost:3000/health` → `{"status":"ok",...}`。

### 终端 B — workers + ticks

```bash
bun src/scheduler/workers.ts
```

**期望日志**:依次打印 `refresh worker registered`、`full-recalc worker registered`、`dispatch worker registered`、`media-fetch worker registered`、`retrospective worker registered`、`cadence tick scheduled (60s)`、`retrospective tick scheduled (5m)`、`queues defined: ...`。

> 这一步连接 Redis;如果 Redis 没起来这里会立刻报错退出。

### 终端 C — frontend(Vite dev server)

```bash
cd frontend
bun install   # 首次需要
bun run dev
```

**期望**:打印 `VITE v5.x ready in NNNms · Local: http://localhost:5173/`。Vite 已通过 `vite.config.ts` 配置 `/api` 代理到 `http://localhost:3000`,前端代码写 `/api/auth/login` 即可。

---

## 4. 演示流程(约 30 分钟,8 步)

> **角色切换**:登录后用顶部的角色选择器在 ANALYST / DECIDER / REVIEWER 三个视角间切换。每个视角看到的卡片/按钮不同。

### 步骤 1 · 登录(2 分钟)

打开浏览器访问 `http://localhost:5173`。

- 邮箱:`admin@cnp.local`
- 密码:`admin1234`

**期望**:登录成功后落到分析师视角的主面板。Cookie `cnp_session` 已下发。

### 步骤 2 · 创建 Watchlist(4 分钟)

切到 ANALYST 视角 → 点 "新建关注 / NewWatchList" 按钮(组件 `frontend/src/routes/analyst/NewWatchListModal.tsx`)。在弹窗里:

1. **名称**:随便取,例如 `演示-机动巡逻-越秀-上午`。
2. **车辆类别 V**:从下拉选一个(种子已灌入,例如"机动巡逻车")。
3. **任务类别 T**:从下拉选一个(例如"路面巡查")。
4. **区域 R**:即时区域 / AD_HOC,在地图上画一个多边形,或者选已有行政区。
5. **K 范围**:默认 1–7 天即可。

提交。

**期望**:列表里多出一行 watchlist,带一个 UUID。后端日志显示 `POST /watchlists 201`。

### 步骤 3 · 触发一条预测(3 分钟)

> **重要**:Slice 0 的 PredictionAgent 与 cadence 链路仍部分桩接(m4 才完整),所以**不靠 cadence 自然产出**。我们用 `/__demo/seed-prediction` 一行命令注入一条已经写好 confidence_snapshot 的 PROPOSED 预测,这样切到决策视角时 InboxCard 上有真实的 reasoning 文本。

把上一步的 watchlistId 复制下来,在演示机的另一个终端跑:

```bash
COOKIE='<从浏览器 DevTools → Application → Cookies 复制 cnp_session=...>'
curl -X POST http://localhost:3000/__demo/seed-prediction \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"watchListId":"<上一步的 UUID>"}'
```

**期望响应**:`201 { "ok": true, "predictionId": "<新 UUID>" }`。

后端日志:`POST /__demo/seed-prediction 201`。

> **替代方案(不推荐做演示)**:不用助手路由的话只有两条退路 —— ① 直接 SQL `INSERT INTO predictions (...) VALUES (...)`(冗长且不会写 confidence_snapshot,InboxCard 推理为空);② 等 60 秒 cadence tick 推动相关 watchlist,但 m3 状态下 PredictionAgent 还不会自然吐出 PROPOSED 行。**演示就用 `/__demo/seed-prediction`**。

### 步骤 4 · 决策视角审批(4 分钟)

切到 DECIDER 视角(顶部角色切换器)。Decision view 的左边收件箱 `InboxCard` 应该出现刚刚那条预测,confidence_now=78,reasoning 文本是中文的"基于该 (V, T, R) 在 K=… 的历史命中分布…"。

点"批准 / Approve"。

**期望**:

- 卡片状态从 PROPOSED → APPROVED。
- 后端日志:`POST /predictions/<id>/approve 200`,紧接着 `[prediction] post-approval dispatch trigger ...`。
- workers 终端:`[dispatch] job picked up`,然后看到模拟派单的日志。
- 模拟器立即返回 `externalId = gzp-<uuid>`,数据库里写入一条 `dispatch_tasks` 行,state=QUEUED → SENT。

### 步骤 5 · Webhook 回包 + 媒体回流(5 分钟)

`SimulatedGuangzhouPoliceCamAdapter` 以"真实平台"的姿态反向 POST 本服务的 `/webhook/simulated-gzp`,带 HMAC 签名 + idempotency key。生产配置(`src/dispatch/adapter-pool.ts`)下:

- **5000ms** 后推送 `IN_PROGRESS`。
- **30000ms**(总耗时)后推送 `COMPLETED`,带 1–N 条假媒体 URL,指向本服务的 `/static/sim-media/<filename>`。

(测试套用的是 75ms / 200ms 的快版本以便 CI 快;现场演示走的是 5000ms / 30000ms 的常规版本,正好留出讲解时间。)

**期望**:

- 决策视图上该预测的状态条:APPROVED → DISPATCHED → IN_PROGRESS → COMPLETED。
- 媒体面板出现 1–N 张占位 JPG(本服务的 `/static/sim-media/:filename` 端点托管,见 `src/server.ts` 第 47–55 行的 `PLACEHOLDER_JPG`)。
- workers 日志:`[media-fetch] downloaded N assets`,DB 中 `media_assets` 表有对应行。

### 步骤 6 · 触发复盘(4 分钟)

复盘的常规调度路径是 `retrospectiveTick`(每 5 分钟扫一次,且要求 `window_date + 7 days < NOW()`)。**演示场景下我们不能等 7 天**,所以走助手路由 `POST /__demo/run-retro` 同步执行。

注意:这个助手会**先校验**预测状态必须是 COMPLETED 或 EXPIRED。如果你在步骤 5 之前就调用,会立刻返回 400 `prediction not in settled status` ——这是有意为之,防止演示半途打到 LLM。

```bash
curl -X POST http://localhost:3000/__demo/run-retro \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"predictionId":"<步骤 3 拿到的 predictionId>"}'
```

**期望响应**:`200 { "ok": true, "retrospectiveId": "<uuid>", "predictionOutcome": "HIT|MISS|NO_DATA", "captureOutcome": "CAPTURED|NOT_CAPTURED|NOT_DISPATCHED|UNKNOWN" }`。

后端日志:`POST /__demo/run-retro 200`,中间打 LLM 调用与 retrospective 写库日志。

### 步骤 7 · 复盘视角浏览(5 分钟)

切到 REVIEWER 视角,带客户走三个 Tab(都在 `frontend/src/routes/reviewer/` 下):

1. **Reports Tab**(`ReportsTab.tsx`):刚刚那条预测的复盘报告卡片 —— 4 段式产出(预测命中/捕获/根因/学习项)。
2. **Matrix Tab**(`MatrixTab.tsx`):预测命中 × 捕获结果的 2×2 矩阵,这条新预测应该让某一格 +1。
3. **Cases Tab**(`CasesTab.tsx`):case_library 已经多出一条对应这条预测的案例。点"覆写 / Override"按钮,改一下 outcome 标签,审计日志里会落一条 `override` 记录。

**期望**:三个 Tab 都不空,数据彼此一致(同一个 predictionId 在三处都能交叉对上)。

### 步骤 8 · 取消流程(可选,3 分钟)

新建第二条 watchlist + 走步骤 3 注入第二条预测,审批后**不等 webhook COMPLETED**,在 IN_PROGRESS 状态下:

```bash
curl -X POST http://localhost:3000/predictions/<predictionId>/cancel \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"reason":"演示取消"}'
```

**期望响应**:`200 { ok: true, dispatch: { state: 'CANCEL_PENDING', ... } }`。

模拟器的 `cancelDelayMs=5000` 内会反向推送 CANCELLED webhook,UI 上 dispatch state 跳 CANCEL_PENDING → CANCELLED。审计日志里能看到这一条 cancel 记录。

---

## 5. 故障排查

| 现象 | 排查 |
|---|---|
| `bun src/server.ts` 启动报 `DATABASE_URL` 未配置 / 连不上 | 检查 `.env` 里的 `DATABASE_URL`、`docker compose ps` 是否 healthy、`POSTGRES_PORT` 是否被占用 |
| 浏览器请求全 401 | 角色未激活。登录后要走过 `/auth/role-state` 把当前角色切到 ANALYST/DECIDER/REVIEWER —— 前端的角色切换器会代你做这一步,所以确认你**点过角色按钮** |
| 步骤 5 看不到 webhook 回来 | ① workers 终端是否还活着;② `SIMULATED_GZP_ENABLED=true` 是否在 `.env`;③ `WEBHOOK_HMAC_SECRET` 在两边对齐;④ 后端日志是否 `POST /webhook/simulated-gzp 200` —— 如果是 401,说明 HMAC 签名校验挂了,通常是 secret 不匹配 |
| 步骤 5 媒体面板空 | 看 workers 日志里 `media-fetch` 是否报错。Slice 0 的媒体下载源是本服务自己的 `/static/sim-media/`,应该不会失败;如果失败,先 `curl http://localhost:3000/static/sim-media/test.jpg` 验证占位图能下载 |
| 步骤 6 `/__demo/run-retro` 返回 400 `prediction not in settled status` | 步骤 5 的 webhook 还没把状态推到 COMPLETED。等 30 秒(模拟器 `completedDelayMs`),刷一下决策视图,看 status 到 COMPLETED 之后再调用 |
| 步骤 6 `/__demo/run-retro` 返回 400 + LLM 报错信息 | `LLM_API_KEY` 不对 / 不通 —— 演示前自检里要 `curl` 过 dashscope。换一个 key,重启 server 即可,**不需要重启 Postgres/Redis** |
| `/__demo/*` 返回 404 | 你的 `NODE_ENV=production`(server 启动日志里**没有** `demo routes mounted`)。改成 `development` 或 `test`,重启 server |

---

## 6. 关掉演示

按下面顺序,三个终端各 `Ctrl+C`:

1. 终端 C(frontend / Vite)
2. 终端 B(workers)—— 它有 SIGINT 处理器,会清理 BullMQ workers 与 ticks
3. 终端 A(server)

最后停容器:

```bash
docker compose down
```

如果想清掉数据库内容(下次完全重新演示):`docker compose down -v`(`-v` 会删除卷)。

---

## 7. 演示前自检 checklist

**演示前 30 分钟,演示人独立跑一遍,任何一项不绿都不能开始**:

- [ ] `bun test` 全绿(当前期望 ≥ 313 pass / 0 fail)。
- [ ] `bunx tsc --noEmit` 零错误。
- [ ] `curl -sS -o /dev/null -w '%{http_code}\n' "$LLM_BASE_URL/models" -H "Authorization: Bearer $LLM_API_KEY"` 返回 200(dashscope 可达且 key 正确)。
- [ ] `.env` 文件存在,且 `LLM_API_KEY`、`SESSION_SECRET`、`WEBHOOK_HMAC_SECRET`、`SIMULATED_GZP_ENABLED=true` 都已填。
- [ ] `docker compose ps` 两容器 healthy;`bun run db:migrate` 幂等通过;`bun run seed:taxonomy:police` 与 `bun run seed:bootstrap` 都跑过(再次跑会打印 `already exists`)。
- [ ] 端口 3000 / 5173 / 5432 / 6379 都未被其他进程占用(`lsof -i :3000` 等)。
- [ ] 三个终端各能独立启动并打印期望日志(server 看到 `demo routes mounted`,workers 看到所有 worker 注册行,frontend 看到 Vite ready)。
- [ ] 浏览器能用 `admin@cnp.local / admin1234` 登录,角色切换器能切到 ANALYST/DECIDER/REVIEWER 三档。
- [ ] 演示账号已在演示机以外的备用机器上预演过一次完整 8 步,记录了每步的 UI 状态。
