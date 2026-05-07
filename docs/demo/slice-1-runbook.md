# Slice 1 客户演示 Runbook(真客户联调升级版)

> **演示时长**:60–90 分钟 · 演示对象:客户方 IT / 业务负责人 + 客户摄像头平台对接负责人 · 演示目标:在客户机器上跑通从 Watchlist → 预测(真新闻信号) → 审批 → 真客户 Camera 后端派单 → 真 webhook 回包 → 媒体回流 → 自动撤单 → 复盘 的完整闭环。
>
> **真实性声明**:Slice 1 的"摄像头后端"是 **真客户的生产平台**(`real-gzp` adapter,`src/dispatch/adapters/real-gzp.ts`),**不是** Slice 0 用的进程内模拟器。Bing News v7 真接入、政务网爬虫(广东省 / 广州市 / 公安厅)也都是真请求。这是 m4 的真客户联调演示。
>
> **与 Slice 0 的差别**:Slice 0 验证流程正确性 + UI + 节奏(全部进程内模拟);Slice 1 在 Slice 0 的 8 步基础上,把摄像头后端切到 `real-gzp`、新闻源切到真 Bing + 真政务网,并新增 1 步:置信度跌破阈值触发自动撤单(B1)。

---

## 1. 前置准备

### 演示要达成什么(在 Slice 0 基础上加)

- 客户能亲眼看到一条预测从被系统提出 → 决策审批 → **真客户 Camera 平台**派单 → **真客户 webhook** 回包 → 媒体回流 → 复盘的完整链路。
- 真新闻源(Bing News + 政务网爬虫)能产出真实证据,不是 fixture 数据。
- B1 自动撤单的现场触发演示:置信度跌破阈值 + 滞后期满 → 系统自动 cancel + audit + inbox 通知。

### 演示机器需要装好

| 工具 | 版本 | 说明 |
|---|---|---|
| **bun** | ≥ 1.3 | `bun --version` 确认 |
| **Docker + docker compose** | 任一桌面版 | Postgres(PostGIS 16-3.4)+ Redis 7 |
| **Git + 仓库代码** | 本仓库 main 最新版 | 至少含 m4 的 27 个 commit |
| **公网出网** | TCP 443 → 客户 backend / api.bing.microsoft.com / *.gd.gov.cn / *.gz.gov.cn | 演示机不能锁死内网 |
| **空闲端口** | 3000 / 5173 / 5432 / 6379 | `lsof -i :3000` 等检查 |

### `.env` — Slice 0 配置之外,m4 必填项

```bash
# ── Slice 0 已有(完整列表见 slice-0-runbook.md §1)──
POSTGRES_USER=cnp
POSTGRES_PASSWORD=cnp_dev
DATABASE_URL=postgres://cnp_app:cnp_app_pwd@localhost:5432/cnp
REDIS_URL=redis://localhost:6379
SESSION_SECRET=<openssl rand -hex 32>
WEBHOOK_HMAC_SECRET=<32-char hex 给客户对齐>
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=<dashscope key>
LLM_MODEL=deepseek-v4-flash

# ── m4 新增,Slice 1 必填 ──
# 切换到真客户 Camera 后端
CAMERA_BACKEND_KIND=real-gzp

# EX-8:客户提供
REAL_GZP_BACKEND_URL=https://camera.<customer-domain>.com.cn
REAL_GZP_API_KEY=<客户给的 API key,演示前 curl 一下>
REAL_GZP_REQUEST_TIMEOUT_MS=30000

# Bing News v7 真接入(空 = degraded fallback,Slice 1 必填)
BING_NEWS_API_KEY=<Azure Bing Search v7 key>

# 政务网爬虫总开关(opt-in,Slice 1 必开)
GOV_SCRAPER_ENABLED=true
GOV_GD_PROVINCE_URL=https://www.gd.gov.cn/gdywdt/sxtt/
GOV_GZ_CITY_URL=https://www.gz.gov.cn/zwgk/zfxxgkml/
GOV_PUBLIC_SECURITY_URL=https://www.gd.gov.cn/zfxxgk/

# B1 自动撤单 — 演示场景下把 lag 调到 1 分钟,方便现场触发
AUTO_CANCEL_THRESHOLD=0.3
AUTO_CANCEL_LAG_MINUTES=1
AUTO_CANCEL_NOTIFY=true

# 关掉 Slice 0 用的模拟器,避免抢 webhook 路由
SIMULATED_GZP_ENABLED=false
```

> **关键**:`WEBHOOK_HMAC_SECRET` 要和**客户那边对齐**(EX-7 spec sign-off 的一部分)。客户从他们的 backend 推 webhook 时用这个 secret 算 X-Signature,我方校验通不过的话整条链路就停在 SENT 状态。

### 期望

- `bun --version` ≥ 1.3
- `.env` 已填,且关键项 `REAL_GZP_*` / `BING_NEWS_API_KEY` / `GOV_SCRAPER_ENABLED=true` / `WEBHOOK_HMAC_SECRET` 都不空
- 客户已提供 `[TEST]`-前缀派单白名单(避免演示派单触发真摄像头部署)

---

## 2. 启动后端基础设施

### 2.1 拉起 Postgres + Redis

```bash
docker compose up -d
docker compose ps    # 期望 cnp-postgres / cnp-redis 都 (healthy)
```

### 2.2 跑数据库迁移(要确认含 m4 的 0009 migration — auto_cancel 列)

```bash
bun run db:migrate
```

**期望**:打印一连串 `applying migration ...`,**特别是 `0009_*_auto_cancel*.sql`**(predictions 表加 `auto_cancel_disabled` + `auto_cancel_below_since` 两列)。第二次执行幂等。

校验 migration 是否到位:

```bash
docker compose exec -T cnp-postgres psql -U cnp -d cnp -c "\\d predictions" | grep -E "auto_cancel"
```

期望输出包含:

```
auto_cancel_disabled    | boolean   | not null default false
auto_cancel_below_since | timestamp |
```

### 2.3 灌种子

```bash
bun run seed:taxonomy:police
bun run seed:bootstrap
```

期望同 Slice 0(`admin@cnp.local / admin1234` 三角色齐全)。

---

## 3. 启动 server + workers + frontend(三个终端)

### 终端 A — HTTP server

```bash
bun src/server.ts
```

**期望日志**(关键:除了 Slice 0 的几行外,新增):

```
[info] camera adapter pool initialized { keys: ['mock', 'real-gzp'] }
```

`real-gzp` 在列表里 = `CAMERA_BACKEND_KIND=real-gzp` 生效、`REAL_GZP_*` env 都被读到了。

### 终端 B — workers + ticks

```bash
bun src/scheduler/workers.ts
```

**期望日志**:除 Slice 0 的 6 worker / 2 tick 之外,新增 1 个 tick:

```
[info] auto-cancel tick scheduled (5m)
```

> 演示时为了能现场触发,我们演示前会 `AUTO_CANCEL_LAG_MINUTES=1`(env 里改),tick 还是 5 分钟一次,所以演示步骤 9 会等 1–5 分钟。如果赶时间,可以在终端 D 直接调 `tickAutoCancel({...})` 的 helper 路由(见步骤 9)。

### 终端 C — frontend

```bash
cd frontend && bun install && bun run dev
```

期望同 Slice 0,Vite 起在 :5173。

---

## 4. 演示流程(约 40 分钟,9 步)

> 步骤 1–8 与 Slice 0 同,只是数据源变成真实的;步骤 9 是 m4 新增。

### 步骤 1 · 登录(2 分钟)

浏览器 `http://localhost:5173` → `admin@cnp.local / admin1234`。

**期望**:落到分析师视角主面板,Cookie `cnp_session` 已下发。

### 步骤 2 · 创建 Watchlist(4 分钟)

切 ANALYST → 新建关注。区域选**真广州市内的多边形**(白云区、天河区都行,演示效果比远郊好,因为 Bing 和政务网更易匹配到信号)。

**期望**:列表多一行 watchlist。

### 步骤 3 · 等 PredictionAgent 自然产出(5 分钟,真新闻信号)

> Slice 0 这一步用 `/__demo/seed-prediction` 注入 fixture;**Slice 1 不再走 fixture** —— 我们演示真信号驱动。

留 5 分钟让 cadence tick(60s)+ refresh worker 推动:

1. Bing News 拉取关键词(V/T 派生),命中带"广州 + 应急 + 救援"等的新闻。
2. 3 个政务网爬虫各自抓一遍。
3. PredictionAgent 把这些 evidence 喂给 LLM,产出一条 `confidence_now` 在 50–80 之间的 PROPOSED 预测。

**期望**:1–2 分钟后决策视角的 InboxCard 出现该预测,reasoning 文本中能看到具体新闻标题(不是"该 (V, T, R) 在 K=… 的历史命中分布")。

**Plan B(若 5 分钟没自然产出)**:走 Slice 0 的 `/__demo/seed-prediction` 兜底,但要明确告知客户"这是兜底,不是真信号"。

### 步骤 4 · 决策视角审批(3 分钟)

切 DECIDER → 看到刚才那条预测 → 点"批准"。

**期望**:

- 卡片 PROPOSED → APPROVED
- 后端日志:`POST /predictions/<id>/approve 200`,紧接着 `[prediction] post-approval dispatch trigger`
- workers 日志:`[dispatch] job picked up`,然后是 `[real-gzp] POST /dispatch ...`
- **真客户 backend 日志**(对方那边):收到 `POST /dispatch` 带 `X-API-Key` + `X-Idempotency-Key`,body 含 `predictionId` + `regionPolygon` + `timeWindow` 等
- 真客户返回 `{externalId: "..."}` → `dispatch_tasks.state=SENT` 写入

> **演示话术**:这是和 Slice 0 最大的差别 —— 这条派单**真的发到客户的 backend 了**。客户那边能在他们的运维面板看到一条新进的 `[TEST]-pred-...` 任务。

### 步骤 5 · 客户 webhook 回包 + 媒体回流(8 分钟)

客户的 backend(按 customer-camera-api-v0.1.md §3.2)在他们的内部状态变化时,反向 POST 我方 `/webhook/real-gzp`,带:

- `X-Signature: sha256=<HMAC of body using WEBHOOK_HMAC_SECRET>`
- `X-Idempotency-Key: <client-supplied uuid>`

**典型时序**:

1. 派单后 ~10–60s:`POST /webhook/real-gzp { state: 'IN_PROGRESS' }` → UI 状态条 SENT → IN_PROGRESS
2. 调度完成时(因部署距离不同,可能 30s 到 5 分钟):`POST /webhook/real-gzp { state: 'COMPLETED', mediaUrls: [...] }` → IN_PROGRESS → COMPLETED
3. 我方收到 COMPLETED 后,`MediaFetcher` 把 mediaUrls 下载、扫毒、落 OSS,UI 媒体面板显示真照片

**期望**:

- 后端日志:`POST /webhook/real-gzp 200`(两次,IN_PROGRESS + COMPLETED)
- workers 日志:`[media-fetch] downloaded N assets`,`media_assets` 表有行
- UI 媒体面板出现真客户拍回来的照片

> **失败排查**:如果 webhook 一直不来,先确认客户那边 backend 日志显示有反推动作。再看我方日志是否 401(HMAC 不对齐)/ 400(body 格式错)。最常见是 `WEBHOOK_HMAC_SECRET` 两边不一致。

### 步骤 6 · 触发复盘(同 Slice 0,4 分钟)

走 `POST /__demo/run-retro`(NODE_ENV != production 才挂载):

```bash
curl -X POST http://localhost:3000/__demo/run-retro \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"predictionId":"<步骤 3 拿到的 predictionId>"}'
```

**期望**:`200 { ok: true, retrospectiveId: "...", predictionOutcome: "HIT", captureOutcome: "CAPTURED" }`(因为有真媒体回包,通常都是 HIT/CAPTURED)。

### 步骤 7 · 复盘视角浏览(5 分钟)

切 REVIEWER,带客户走 3 个 Tab:

1. **Reports Tab** — 该预测的复盘报告
2. **Matrix Tab** — 2×2 矩阵某格 +1。**注意**:m4 把 MatrixTab 切到了服务端聚合(`GET /retrospectives/aggregate`),响应应该是单次请求返回 byOutcome 计数,而不是客户端再 GROUP BY
3. **Cases Tab** — case_library 多了一条;点 Override 改 outcome 标签,审计日志落一条

### 步骤 8 · 取消流程(可选,2 分钟,同 Slice 0 但走真 backend)

新建第二条 watchlist + 等出预测 + 审批,然后:

```bash
curl -X POST http://localhost:3000/predictions/<predictionId>/cancel \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"reason":"演示取消"}'
```

**期望**:我方调 `real-gzp.cancel` → 客户 backend 收到 `POST /cancel` → 客户回 `{externalId, cancelledAt}` → 我方写 CANCEL_PENDING → 客户后续推 CANCELLED webhook → CANCELLED 终态。

### 步骤 9(m4 新)· 自动撤单演示(8 分钟)

> 这一步是 m4 B1 新功能。演示路径:再开第三条 watchlist + 等出预测 + 审批 → 派单 SENT 状态 → 人工把 confidence 拉低 → 等 1 分钟(`AUTO_CANCEL_LAG_MINUTES=1`)→ tickAutoCancel 触发 → 看 cancel + audit + inbox 通知。

#### 9.1 派单后,在演示终端把 confidence 拉低

```bash
docker compose exec -T cnp-postgres psql -U cnp -d cnp <<'SQL'
UPDATE predictions
SET confidence_now = 20,
    auto_cancel_below_since = NOW()
WHERE id = '<步骤 9 派单的 predictionId>'::uuid;
SQL
```

> **演示话术**:"假设 PredictionAgent 在派单后又拉了一轮新闻,新增的负向证据把置信度从 70 降到 20。系统不会让低置信度的派单悬着 —— 它会自动撤。"

#### 9.2 等 1 分钟(滞后期),让 auto-cancel tick 触发

`scheduleAutoCancelTick` 默认 5 分钟一跑,**演示场景下手动触发**比较高效。在 workers 终端 (B) 你会看到 5 分钟一次的 tick 日志;不想等的话:

```bash
# 演示终端 D — 手动跑一次 tick(用 ts-node-style 单脚本)
bun --bun -e "
import { tickAutoCancel } from './src/scheduler/workers/auto-cancel'
import { createDb } from './src/db/client'
const { db } = createDb('admin')
const r = await tickAutoCancel({ db, threshold: 0.3, lagMinutes: 1, notify: true })
console.log(JSON.stringify(r))
"
```

**期望输出**:`{"scanned":1,"cancelled":1,"errors":0}`。

#### 9.3 验证三个副作用

1. **dispatch_task** 状态从 SENT → CANCEL_PENDING:
   ```bash
   docker compose exec -T cnp-postgres psql -U cnp -d cnp -c "
   SELECT id, state FROM dispatch_tasks WHERE prediction_id = '<predictionId>'::uuid;
   "
   ```
2. **audit log** 落了一条 AUTO_CANCEL_DISPATCH:
   ```bash
   docker compose exec -T cnp-postgres psql -U cnp -d cnp -c "
   SELECT action, reason, after FROM audit.operation_audit
   WHERE target_kind = 'dispatch' AND action = 'AUTO_CANCEL_DISPATCH'
   ORDER BY ts DESC LIMIT 1;
   "
   ```
   `reason` 应该是 `[AUTO] confidence dropped to 0.200 at <ISO time>`。
3. **inbox 通知**:DECIDER 视角的收件箱应该多一条 `auto-cancel` 类型的事件,带 `predictionId` 和 `dispatchId` 链接。

> 客户问"如果是误撤怎么办"→ 回答:`predictions.auto_cancel_disabled` 列。Watchlist 创建时默认 false,审批时 DECIDER 可以勾"豁免自动撤单"。这条 prediction 就再也不会被这个 tick 选中。

---

## 5. 故障排查升级版

| 现象 | 排查 |
|---|---|
| 步骤 4 派单后 dispatch_task 卡在 QUEUED 永不到 SENT | ① workers 终端是否还活;② 日志是否 `[real-gzp] POST /dispatch failed: HTTP 5xx` —— 客户 backend 挂了 / 网络;③ HTTP 401 → `REAL_GZP_API_KEY` 不对;④ `AbortSignal.timeout` 超时(30s)→ 客户回包慢或 DNS 问题。`adapter` 抛错后 `enqueueDispatch` 写 `dispatch_tasks.state=FAILED`,审计日志含错误体 |
| 步骤 5 webhook 401 | HMAC 签名校验挂。两边 `WEBHOOK_HMAC_SECRET` 必须**字节一致**。客户那边算 sha256(body) 时用 raw body(包含 `\n` / 空格),不能 pretty-print 后再算 |
| 步骤 5 webhook 404 | URL 路径错。我方挂载的是 `POST /webhook/real-gzp`(`webhookRoutes` 里的 `:adapterKey` 通配),客户文档有可能拼成 `/webhook/realGzp` 或 `/webhooks/real-gzp` |
| 步骤 3 等 5 分钟还是没预测 | ① Bing 配额耗尽 → 后端日志会有 `[bing-news] HTTP 429`,降级到空数组 → PredictionAgent 拿不到信号;②政务网 robots.txt 禁了我方 path → 后端日志 `[gov-*] robots-disallow`,该 adapter 直接返回 [];③ LLM 不通 → `LLM_API_KEY` 失效;④ cadence tick 没跑 → workers 终端没 `[cadence-tick]` 日志,确认 workers 进程还活 |
| 步骤 9.2 手动触发 tick 报 `auto_cancel_below_since IS NOT NULL` 没匹配 | 9.1 SQL 必须把 `auto_cancel_below_since` 设为 `NOW()`(或更早)。如果之前 confidence 一直高,这列是 NULL,即使现在低也不会被选 —— 因为 tick 用"持续低多久"判断,不是"现在低不低" |
| 步骤 9.3 audit 表查不到 AUTO_CANCEL_DISPATCH | ① tick 是否真跑了(`r.cancelled` > 0);② `state` 选择条件是 `IN ('QUEUED','SENT','IN_PROGRESS')` —— 如果 dispatch 已经是 COMPLETED / CANCEL_PENDING,tick 会跳过,这是设计意图(防止双 cancel,ISC-Anti.3) |
| Bing API 配额超限 | `[bing-news] HTTP 429` → adapter 返回 degraded `[]`,不抛错。这是设计的 graceful degrade。如要恢复,要么换 key,要么等次月配额刷新 |
| 政务网 robots.txt 拒绝 | `[gov-gd-province] robots disallow / path: /gdywdt/sxtt/` → adapter 直接返回 `[]`。这是合规设计,不绕开 robots。如果**确认**站点策略允许,改 URL 配置或者跟站方协商 |
| `tickAutoCancel` 报错刷屏 | 单条 row 的错误是 try/catch 计数的,不会中断整个 tick。看 `r.errors > 0` + workers 日志 `[auto-cancel] failed dispatch=...` 找具体哪条挂了。常见是 `getAdapter('mock')` 找不到 —— 演示时若把 `CAMERA_BACKEND_KIND=real-gzp` 关了,某些遗留 dispatch_task 的 adapterKey 还是 mock,要么补回 mock factory,要么把那行删了 |

---

## 6. 关掉演示

按 Slice 0 一样的顺序:终端 C → 终端 B → 终端 A → `docker compose down`。

`docker compose down -v` 会清掉数据库,下次完全重新演示用。

---

## 7. 演示前自检 checklist(Slice 1 升级版)

**演示前 30–60 分钟,演示人独立跑一遍,任何一项不绿都不能开始**:

- [ ] `bun test` 全绿(当前期望 ≥ 389 pass / 1 skip / 0 fail)
- [ ] `bunx tsc --noEmit` 零错误
- [ ] `.env` 已填,且 **m4 必填项**(`CAMERA_BACKEND_KIND=real-gzp`、`REAL_GZP_API_KEY`、`REAL_GZP_BACKEND_URL`、`BING_NEWS_API_KEY`、`GOV_SCRAPER_ENABLED=true`、`WEBHOOK_HMAC_SECRET`)都已填
- [ ] `WEBHOOK_HMAC_SECRET` 与客户那边对齐(口头 / 文档双确认)
- [ ] **EX-8 真客户 backend 可达**:`curl -sS -o /dev/null -w '%{http_code}\n' "$REAL_GZP_BACKEND_URL/health"`(或客户提供的 ping 端点)返回 200
- [ ] **EX-8 API key 有效**:用客户文档里的 health-check 路径 + `-H "X-API-Key: $REAL_GZP_API_KEY"` 验证返回非 401/403
- [ ] **Bing API 配额充足**:`curl -sS "https://api.bing.microsoft.com/v7.0/news/search?q=test&count=1" -H "Ocp-Apim-Subscription-Key: $BING_NEWS_API_KEY"` 返回 200,响应头 `X-MSEdge-ClientID` 不为空
- [ ] **3 个政务网可达** + robots.txt 允许我方 path:对每个 URL 跑 `curl -sS -o /dev/null -w '%{http_code}\n' "$GOV_GD_PROVINCE_URL/robots.txt"` 等,200 + body 含 `User-agent: *` 不带禁我方 path 的 `Disallow:`
- [ ] **migration 0009** 已落库 — `\d predictions` 列含 `auto_cancel_disabled` 和 `auto_cancel_below_since`
- [ ] `docker compose ps` 两容器 healthy;`bun run db:migrate` 幂等通过;两个 seed 都跑过
- [ ] 端口 3000 / 5173 / 5432 / 6379 都未被占用
- [ ] 三个终端各能独立启动并打印期望日志(server 看到 `camera adapter pool initialized { keys: ['mock', 'real-gzp'] }`,workers 看到 `auto-cancel tick scheduled` + 其他 6 worker 注册行,frontend 看到 Vite ready)
- [ ] 浏览器能用 `admin@cnp.local / admin1234` 登录,角色切换器三档都能切
- [ ] 演示账号已在演示机以外的备用机器上预演过一次完整 9 步,并记录每步的预期 UI 状态 + 数据库行
- [ ] 演示当天客户值班对接人电话已备(步骤 5 webhook 回不来时第一时间联系)
- [ ] 客户已确认 `[TEST]`-前缀派单白名单生效(避免演示真触发摄像头部署)

---

## 8. 与 Slice 0 的对比速查

| 维度 | Slice 0(m3) | Slice 1(m4) |
|---|---|---|
| Camera 后端 | `simulated-gzp`(进程内模拟器) | `real-gzp`(真客户 backend) |
| 派单 wire | 进程内 ack | HTTP POST 到客户域 + X-API-Key |
| Webhook 来源 | 模拟器自己反推(setTimeout) | 客户 backend 真反推 |
| 媒体来源 | 本服务 `/static/sim-media/` 占位 JPG | 客户 mediaUrls 真照片 |
| 新闻信号 | RSS + DDG + Aggregator(mock 数据) | Bing News v7 真接入 + 3 个政务网爬虫 |
| 自动撤单 | ❌ 未实现 | ✅ B1 — confidence 跌破 + 滞后 → 自动 cancel + audit + inbox |
| Retrospective 聚合 | 客户端 N+1 | 服务端 `GET /retrospectives/aggregate`(C-5) |
| 预测注入路径 | `/__demo/seed-prediction` 助手路由(fixture 兜底) | 真信号 + cadence tick 自然产出(fixture 仅 plan B) |
| 客户参与度 | 低(全部我方 mock) | 高(EX-7 spec sign-off + EX-8 API key + 联调对接人) |
