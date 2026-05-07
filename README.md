# 摄像头新闻预测 / 监控调度 / 复盘系统(camera-news-prediction)

> 当前阶段:**m1 Foundation**(应用壳 + 数据库 schema + Auth + 前端骨架)
> 设计稿:`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`
> Plan-A:`docs/superpowers/plans/2026-05-05-m1-foundation.md`(主)+ `2026-05-06-m1-foundation-frontend-addendum.md`(前端覆写)

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

- **m2(Plan-B,待写)**:WatchList + PredictionAgent + 1 信源 + 1 摄像头 adapter + 批准流
- **m3(Plan-C,待写)**:WebhookIngest + MediaFetcher + 复盘 Agent + 二轴 outcome + Slice 0 验收

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
