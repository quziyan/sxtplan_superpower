# 摄像头新闻预测 / 监控调度 / 复盘系统(camera-news-prediction)

> 当前阶段:**m3 Real End-to-End**(完整闭环已落地;Slice 0 可演示)
> 设计稿:`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`
> Plan-A:`docs/superpowers/plans/2026-05-05-m1-foundation.md`(主)+ `2026-05-06-m1-foundation-frontend-addendum.md`(前端覆写)
> Plan-B:`docs/superpowers/plans/2026-05-06-m2-prediction-core.md`(m2)
> Plan-C:`docs/superpowers/plans/2026-05-07-m3-real-end-to-end.md`(m3,本期)

## 快速启动

### 1. 准备 env

```bash
cp .env.example .env
# 必填:SESSION_SECRET 改成 64 位 hex(可用 `openssl rand -hex 32`)
# 端口冲突:若主机已有 Postgres 占用 5432,改 .env 中 POSTGRES_PORT=5433 + 同步改 DATABASE_URL/DATABASE_ADMIN_URL 端口
# 可选:AMAP_API_KEY(地图组件,无 key 走 .map-stub fallback)、DASHSCOPE_API_KEY(m2 起需要)
```

### 2. 起容器

```bash
docker compose up -d
docker compose ps   # 等到 cnp-postgres / cnp-redis 都 (healthy)
```

### 3. 初始化 DB

```bash
bun install
bun run db:migrate         # 跑 manual SQL(audit schema + cnp_app role)+ drizzle migrations
bun run seed:bootstrap     # 创建 3 个 role + admin@cnp.local / admin1234
# 可选:bun run seed:region <fixture.geojson>  (需要外部行政区划 GeoJSON,m1 阶段不必跑)
```

### 4. 起服务

```bash
# Terminal 1 — 后端
bun run dev              # http://localhost:3000

# Terminal 2 — 前端
cd frontend && bun install && bun run dev   # http://localhost:5173 (代理 /api → :3000)
```

打开 `http://localhost:5173`,登录 `admin@cnp.local` / `admin1234`,选择角色态后看到对应工作台占位骨架。

## 开发命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 后端开发服务(watch) |
| `bun run typecheck` | TS 编译检查 |
| `bun run lint` | biome 检查 |
| `bun run format` | biome 格式化 |
| `bun run test` | 运行所有 bun test |
| `bun run db:generate` | drizzle 根据 schema 产生 migration SQL |
| `bun run db:migrate` | 应用 migration(含 manual SQL) |
| `bun run db:push` | 直接同步 schema 到 DB(开发偷懒用) |
| `bun run seed:bootstrap` | 种 role + admin |
| `bun run seed:region` | 种行政区划(需外部 GeoJSON) |
| `cd frontend && bun run dev` | 前端开发服务 |
| `cd frontend && bun run build` | 前端 production 打包 |

## 项目结构

后端核心:
- `src/db/` — Drizzle ORM(schemas + client + migrate runner)
- `src/auth/` — argon2 + signed cookie + session + middleware + routes
- `src/audit/` — OperationAudit 写入 helper
- `src/modules/region/` — Region service + HTTP routes + seed CLI
- `src/modules/taxonomy/` — V/T 分类 service + routes
- `src/server.ts` — Hono app 入口
- `src/env.ts` — zod env 验证

前端核心(`frontend/`):
- `src/styles/` — 政务深色 design tokens + globals + components.css(从 Claude Design 原型移植)
- `src/components/` — Icon/Btn/IconBtn/Tag/Card/PageHeader/Status/Tabs/MapView/DetailPane + topbar
- `src/lib/` — api client + auth + useAuth hook
- `src/routes/` — Login + 三视图占位骨架(Analyst/Decision/Reviewer)
- `src/App.tsx` — 根:auth gate + role 路由

## 后续里程碑

- **m2(Plan-B,已完成)**:WatchList + PredictionAgent + 多信源 + mock 摄像头 adapter + 批准流(详见下方 m2 Prediction Core 段)
- **m3(Plan-C,本期完成)**:WebhookIngest + SimulatedGuangzhouPoliceCamAdapter + MediaFetcher + 真挂 BullMQ workers + 复盘 Agent + 二轴 outcome + Slice 0 验收(详见下方 m3 — Real End-to-End 段)
- **m4+**:真实甲方 backend 接入 + RSS/政务/社交/外文多通道 + AD_HOC→ADMIN_NAMED 晋升

## 端口约定

| 服务 | 端口 | 备注 |
|---|---|---|
| Postgres(docker) | **5433**(host) → 5432(container) | 因主机有 native Postgres 占用 5432 |
| Redis(docker) | 6379 | |
| 后端 Hono | 3000 | |
| 前端 Vite | 5173 | `/api` 代理到 :3000 |

---

## m2 Prediction Core 启动

> 当前阶段:**m2 Prediction Core**(预测核心闭环)
> 计划:`docs/superpowers/plans/2026-05-06-m2-prediction-core.md`(34 任务,约 4 周)

### 新增 env 变量

`.env` 需要新增以下字段(已在 `.env.example` 提供占位):

```
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=                    # EX-4:阿里云 dashscope key (LLMConfig.md 已有)
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT_MS=30000

SEARCH_API_KIND=mock            # mock | bing-news | rss | ddg | aggregator
SEARCH_API_KEY=                 # bing-news 需要 Azure key
SEARCH_API_BASE_URL=https://api.bing.microsoft.com/v7.0/news/search

AMAP_GEOCODE_KEY=               # EX-5:可空,fallback 走规则匹配
```

### m2 新增脚本(暂用)

m2 BullMQ workers 仍为 stub。本期暂不需要单独运行 worker。

### Agent 验证(可选)

```bash
# 配置好 LLM_API_KEY 后,直接跑一次 inference 客户端测试
bun test tests/inference/client.test.ts
```

### m2 范围与未实现部分

**已实现:**
- 9 张新 schema(predictions / confidence_snapshots / news_items / news_evidence / dispatch_tasks / dispatch_results / media_assets / watch_lists / task_cards)
- Inference 层(OpenAI 兼容 → dashscope) + JSON parser(支持 markdown 围栏 + 解释前缀)
- 三类 Agent prompt + 编排:PredictionAgent / NewsTriageAgent / Case retriever (m2 placeholder)
- News 管道:SearchAdapter (5 kinds — 3 真实 + 2 stub) / Normalizer / Geocoder (AMAP + rule fallback) / Matcher
- Scheduler:BullMQ + ioredis 队列定义 / K-自适应 cadence / agent_full P1-P5 触发 / 漂移检测器
- WatchList + TaskCard CRUD + Prediction list/detail/approve/reject/manual-confidence/recompute-now 路由
- Mock camera adapter + DispatchService(QUEUED → SENT;CANCEL_PENDING → CANCELLED)
- Frontend:7 业务组件(ConfBar/SourceMix/KpiRow/PredictionTable/InboxCard/ConfidenceTimeline/EvidenceList) + AnalystView/DecisionView 实数据 + PredictionDetail overlay

**未实现(m3+ 范围):**
- BullMQ workers 真实挂载(m2 仅定义 queues + 同步直调路径)
- approval → 自动 dispatch 投递(m2 通过显式 `enqueueDispatch` 完成)
- Webhook ingest(EX-2 真 backend 集成)
- Retrospective 表 + 二轴 outcome
- BM25 / 向量化案例库
- 真实信源接入(目前默认 mock,可切 rss / bing-news,但需配置)
- 撤单完整链路
- 任务卡 UI 创建(后端 API 已就位,前端 m3 加 modal)
- 监视清单 UI 创建(同上)
- D 角色 ReviewerView 真实数据(m3)

### 5 个外部依赖占位

- **EX-1** Slice 0 真实 (V, T, R) — 客户业务方提供
- **EX-2** 第一个真实摄像头 backend 契约 — 客户提供
- **EX-3** 信源选定 — 用户已确认多通道(mock/rss/bing/ddg/aggregator)
- **EX-4** 阿里云 dashscope key — `prds/LLMConfig.md` 已有,move 到 `.env`(用户明确允许明文)
- **EX-5** 高德 Geocode key — 客户决定;可空,fallback 已就位

---

## m3 — Real End-to-End

> 当前阶段:**m3 Real End-to-End**(把 m2 的 stub / mock 全部换成真实闭环)
> 详细计划:`docs/superpowers/plans/2026-05-07-m3-real-end-to-end.md`(37 任务)
> 范围:WebhookIngest + SimulatedGuangzhouPoliceCamAdapter + MediaFetcher (OSS) + 真挂 BullMQ workers + RetrospectiveAgent + 二轴 outcome + 案例库 + D 角色 ReviewerView

### 新增 env 变量(以 `.env.example` 为准)

```
# Webhook ingest(HMAC 共享密钥,>=16 chars)
WEBHOOK_HMAC_SECRET=dev-secret-32-chars-replace-prod

# Simulated 广州警务摄像头适配器(默认关闭;开启后启用模拟下发 + webhook 回调)
SIMULATED_GZP_ENABLED=false
SIMULATED_GZP_API_KEY=test-key                        # EX-8:任填一个 32 位 hex 即可
SIMULATED_GZP_WEBHOOK_URL=http://localhost:3000/webhook/simulated-gzp
SIMULATED_GZP_FAKE_MEDIA_BASE=http://localhost:3000/static/sim-media/

# 阿里云 OSS(EX-6;MediaFetcher 写入,空 AK 时 client 抛错)
OSS_ENDPOINT=https://oss-cn-shenzhen.aliyuncs.com
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=cnp-media-dev
```

### Worker 启动方式

```bash
# 单进程启动全部 worker(refresh / cadence tick / full-recalc / dispatch / media-fetch / retrospective + retro tick)
bun src/scheduler/workers.ts
```

- 依赖 Redis 在 `localhost:6379`(或由 `REDIS_URL` 指定)
- `SIGTERM` / `SIGINT` 触发 `stopWorkers()` 清队列 + `closeAllQueues()` 后再 `exit(0)`,可安全 ctrl-C / docker stop
- 队列定义:refresh / full-recalc / news-ingest / dispatch / media-fetch / retrospective(共 6 个 BullMQ queue)

### m3 关键流程概览

```
监视清单 → PredictionAgent(P1-P5 触发 + cadence) → confidence_snapshot
   ↓ (A 批准)
dispatch_task QUEUED → SimulatedGuangzhouPoliceCamAdapter 模拟下发
   ↓ (异步 webhook 回调)
WebhookIngest(HMAC 验签) → 状态机 IN_PROGRESS / COMPLETED → media-fetch worker
   ↓
MediaFetcher 拉取 → 阿里云 OSS(media_assets 落库)
   ↓ (T+K+M 后,retrospective tick 扫描)
RetrospectiveAgent → retrospectives + case_library
   ↓
D 角色 ReviewerView 看到二轴矩阵 + 漂移 → 反馈到 PredictionAgent 的 D 通道
```

### 外部依赖状态(EX-1..EX-8)

| 依赖 | 状态 | 备注 |
|---|---|---|
| **EX-1** 警务车辆 V/T 分类(C-1..C-5) | ✅ 已就绪 | `bun run seed:taxonomy:police` 一次性写入 |
| **EX-2** 真实甲方 backend | ⚠️ 待客户对接 | 当前用 `SimulatedGuangzhouPoliceCamAdapter` 顶替;契约文档到位即换 adapter |
| **EX-3** news adapter 多通道 | ⚠️ 部分就绪 | mock 为默认;bing-news / rss / ddg / aggregator 已有 adapter 骨架,真实信源种子留 m4 |
| **EX-4** Aliyun dashscope LLM | ✅ 已配置 | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`,key 在 `prds/LLMConfig.md` |
| **EX-5** 高德 Geocode key | ⚠️ 待申请 | 无 key 时 fallback 走规则匹配;广州市级地理化建议本期申请 |
| **EX-6** 阿里云 OSS bucket + AccessKey | ⚠️ 待申请 | MediaFetcher 必需;**Slice 0 acceptance 阶段必须有真 bucket** |
| **EX-7** 公网 webhook 域名 | ⚠️ 待准备 | 开发期 ngrok / cpolar 反向代理即可;正式部署前换签发证书的域名 |
| **EX-8** Simulated 测试 API key | ⚠️ 任填即可 | `SIMULATED_GZP_API_KEY` 任填一个 32 位 hex,与 adapter 内部对账 |

### Demo 启动脚本(简略;详细 runbook 见 Plan-C Task 37 / Slice 0 段)

```bash
# 1. 起 docker postgres + redis
docker compose up -d
docker compose ps   # 等到 cnp-postgres / cnp-redis 都 (healthy)

# 2. 跑 migration + seed
bun install
bun run db:migrate
bun run seed:bootstrap          # 3 个 role + admin@cnp.local / admin1234
bun run seed:taxonomy:police    # V/T 分类(C-1..C-5)

# 3. 起 backend + workers(各开一个 terminal,或 nohup 后台)
bun run dev &                   # backend on :3000
bun src/scheduler/workers.ts &  # 6 worker + 2 tick

# 4. 起 frontend dev server
cd frontend && bun install && bun run dev   # http://localhost:5173

# 5. 浏览器访问 http://localhost:5173,登录 admin@cnp.local / admin1234
#    打开监视清单 → 等 PredictionAgent 触发 → 批准 → 看 dispatch + webhook + media + 复盘
```

> 真实演示需要先把 `SIMULATED_GZP_ENABLED=true` 打开,否则 dispatch 走 mock-camera 默认 adapter,不会回调 webhook。

### m3 已知重构债务清单(留 m4 / 后续技术债)

- `logAudit` helper 应支持 `Db | PgTransaction` 联合类型(T23 期间累积,目前传 `Db` 工作但事务内调用绕过隔离)
- 测试 DB 事务级隔离(`BEGIN` / `ROLLBACK` 包测试)— T14 + T22 累积污染,目前靠手动 cleanup
- `createBullMQWorker(name, handler)` helper(6 worker 复制 connection / concurrency / 监听样板)
- `DEFAULT_ADAPTER_KEY` 共享常量(避免 `simulated-gzp` 与 `mock` 默认值在不同入口不一致)
- `GET /retrospectives/aggregate` 端点(T30 客户端用 `?limit=500` 暴露 N+1,服务端聚合更合适)
