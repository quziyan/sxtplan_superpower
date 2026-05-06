# m2 Prediction Core Implementation Plan (Plan-B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans。Steps 用 `- [ ]` 跟踪。

**Goal:** 在 m1 地基之上叠加预测核心闭环——监视清单/任务卡 → Agent 预测 → 每日置信度更新 + agent_full 全量重算 + 漂移检测 → A 角色一键批/驳 → mock 摄像头调度。完成时:用户可创建监视清单、Agent 自动产出预测、A 角色在 Inbox 看到带置信度的预测卡 + 一键批准。

**Architecture:** 复用 m1 modular monolith;新增三大子系统 — (1) Inference 层(PAI Inference wrapper → 阿里云 dashscope deepseek-v4-flash);(2) NewsIngest 层(SearchAdapter + Normalizer + Geocoder + Matcher);(3) Scheduler(BullMQ + cron,K-自适应 cadence + agent_full 触发表)。Mock camera adapter 替代真实 backend(契约待客户),v3 替换。

**Tech Stack:** 全栈复用 m1 + 新增 — `bullmq@^5` · `ioredis@^5` · `@google-cloud/...` 不要。LLM 走 OpenAI 兼容 API(`openai@^4`)调阿里云 dashscope。无新前端框架。

**Source Spec:** [`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`](../specs/2026-05-05-camera-news-prediction-design.md)(commit `72b1868`)

**Slice Position:** **Plan-B of A/B/C 三段**(B 路径垂直切片优先);本计划 = m2(4 周窗口)。前置 = Plan-A(m1 已完工,commit `1acc433`)。后续 = Plan-C(m3 真端到端)。

**Spec ISC 覆盖:** ISC-1 / ISC-2 / ISC-3 / ISC-4 / ISC-9 / ISC-10 / ISC-11 / ISC-12 / ISC-13 / ISC-15(单信源)/ ISC-25 / ISC-S0-1 / ISC-S0-2

---

## 占位清单(外部依赖,Plan-B 实施期间需客户提供)

执行到对应 Task 前必须填实下列占位,否则 implementer 应报 BLOCKED。

| ID | 占位内容 | 影响 Task | 默认行为(若未提供) |
|---|---|---|---|
| **EX-1** | Slice 0 真实 (V, T, R) 三元组 | Task 25, 28, 38 (E2E demo) | 用 `应急救援车 / 抢险救援 / 广东沿海某 ADMIN_NAMED 区` 占位 |
| **EX-2** | 第一个真实摄像头 backend 契约 | Task 30 (camera adapter) | 用 `MockCameraAdapter` 假调度,记录到 DB 但不真发请求 |
| **EX-3** | 选定的中文主流新闻源(信源 + 接入方式) | Task 14 (SearchAdapter) | 用 Bing News Search API + 关键词查询,不接 RSS |
| **EX-4** | 阿里云 dashscope API key | Task 8 (LLM 调用) | 用 mock LLM responder 跑测试,真实调用走 `BLOCKED` |
| **EX-5** | 高德地理编码 API key(NewsGeocoder 用) | Task 16 (Geocoder) | 用规则匹配回退(中文地名 → ADMIN_NAMED 子串匹配) |

---

## File Structure(本计划新增/修改)

```
排班系统设计-superpowers/
├── package.json                          # 加 bullmq/ioredis/openai
├── .env.example                          # 加 LLM_*/AMAP_GEOCODE_*/SEARCH_API_* 占位
├── docker-compose.yml                    # 不变
│
├── src/
│   ├── server.ts                         # 修改:加挂 watchlist/taskcard/prediction routes
│   ├── env.ts                            # 修改:加 LLM/SEARCH/AMAP env
│   │
│   ├── db/
│   │   └── schema/
│   │       ├── prediction.ts             # 新:predictions / confidence_snapshots / news_evidence
│   │       ├── dispatch.ts               # 新:dispatch_tasks / dispatch_results / media_assets
│   │       └── watchlist.ts              # 新:watch_lists / task_cards
│   │
│   ├── inference/                        # 新模块
│   │   ├── client.ts                     # OpenAI-compatible client → dashscope
│   │   ├── types.ts                      # InferenceRequest / Response / Message
│   │   ├── prompts/
│   │   │   ├── prediction-agent.ts       # PredictionAgent 系统提示 + 输出 JSON schema
│   │   │   ├── news-triage-agent.ts      # NewsTriageAgent
│   │   │   └── retrospective-agent.ts    # RetrospectiveAgent stub(留 m3)
│   │   └── parser.ts                     # JSON 输出严格校验 + 容错
│   │
│   ├── agents/                           # 新模块
│   │   ├── prediction-agent.ts           # 编排:载入证据 + 调 LLM + 解析 + 写 DB
│   │   ├── news-triage-agent.ts          # 单条新闻是否对预测有信息增量
│   │   └── case-retriever.ts             # 案例库 BM25 检索(简化版)
│   │
│   ├── news/                             # 新模块
│   │   ├── search-adapter.ts             # SearchAdapter(EX-3 占位:Bing News fallback)
│   │   ├── normalizer.ts                 # 去重(URL+sha256)+ 中文摘要 + 关键词标注
│   │   ├── geocoder.ts                   # 高德 + 规则 fallback
│   │   ├── matcher.ts                    # PredictionMatcher: 新入库 news → 候选 predictions
│   │   └── source-health.ts              # 错误率计数 → ACTIVE/DEGRADED/DEAD
│   │
│   ├── scheduler/                        # 新模块
│   │   ├── queue.ts                      # BullMQ queue 定义
│   │   ├── workers.ts                    # 各 worker 注册
│   │   ├── cadence.ts                    # K-自适应刷新 cadence 计算
│   │   ├── full-trigger.ts               # P1-P5 触发表评估
│   │   └── drift-detector.ts             # 漂移检测(P4)
│   │
│   ├── modules/
│   │   ├── watchlist/
│   │   │   ├── service.ts
│   │   │   └── routes.ts
│   │   ├── taskcard/
│   │   │   ├── service.ts
│   │   │   └── routes.ts
│   │   └── prediction/
│   │       ├── service.ts                # 业务编排
│   │       ├── routes.ts                 # /predictions GET/POST + /:id/approve|reject
│   │       └── confidence.ts             # ConfidenceSnapshot 写入 + 当前值派生
│   │
│   ├── dispatch/                         # 新模块
│   │   ├── service.ts                    # 调度编排 + 状态机
│   │   ├── adapter-pool.ts               # adapter 适配器池
│   │   └── adapters/
│   │       └── mock.ts                   # MockCameraAdapter(EX-2 占位)
│   │
│   └── lib/
│       └── ratelimit.ts                  # 简单 token bucket(给 SearchAdapter / Geocoder 用)
│
├── tests/
│   ├── inference/
│   │   ├── client.test.ts
│   │   └── parser.test.ts
│   ├── agents/
│   │   ├── prediction-agent.test.ts      # mock LLM,验证编排
│   │   └── news-triage-agent.test.ts
│   ├── news/
│   │   ├── search-adapter.test.ts
│   │   ├── normalizer.test.ts
│   │   ├── geocoder.test.ts
│   │   └── matcher.test.ts
│   ├── scheduler/
│   │   ├── cadence.test.ts
│   │   ├── full-trigger.test.ts
│   │   └── drift-detector.test.ts
│   ├── modules/
│   │   ├── watchlist.test.ts
│   │   ├── taskcard.test.ts
│   │   └── prediction.test.ts
│   ├── dispatch/
│   │   └── mock-adapter.test.ts
│   └── e2e/
│       └── prediction-flow.test.ts       # WatchList → Agent → Inbox → 批准 → MockDispatch
│
└── frontend/src/
    ├── lib/
    │   ├── prediction-api.ts             # 新:Prediction CRUD + approve/reject
    │   └── watchlist-api.ts              # 新:WatchList CRUD
    │
    ├── components/                       # 业务组件
    │   ├── ConfBar.tsx                   # 从原型移植:置信度条
    │   ├── SourceMix.tsx                 # 从原型:信源构成
    │   ├── KpiRow.tsx                    # 从原型:KPI 4 列
    │   ├── PredictionTable.tsx           # AnalystView 用
    │   ├── InboxCard.tsx                 # DecisionView 用
    │   ├── ConfidenceTimeline.tsx        # PredictionDetail 用(自定义 SVG 图)
    │   ├── EvidenceList.tsx              # PredictionDetail 用
    │   └── PredictionDetail.tsx          # 详情滑入面板内容
    │
    ├── routes/
    │   ├── analyst/
    │   │   ├── AnalystView.tsx           # 重写:真实数据 + sidebar 监视清单 + 表
    │   │   ├── WatchListPanel.tsx
    │   │   ├── NewWatchListModal.tsx
    │   │   └── NewTaskCardModal.tsx
    │   ├── decision/
    │   │   └── DecisionView.tsx          # 重写:Inbox 卡列表
    │   └── reviewer/
    │       └── ReviewerView.tsx          # 不动(m3 实装)
    │
    └── App.tsx                           # 修改:加 PredictionDetail overlay state
```

---

## Tasks

### Section 1 — DB Schemas(Prediction / Dispatch / WatchList)

#### Task 1: Prediction / ConfidenceSnapshot / NewsEvidence schemas

**Files:**
- Create: `src/db/schema/prediction.ts`
- Modify: `src/db/schema/index.ts:1` — add export
- Create: `tests/db/prediction.test.ts`

**Spec ISC:** ISC-1, ISC-2

- [ ] **Step 1: Implement schema**

```ts
// src/db/schema/prediction.ts
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const predictionStatusEnum = pgEnum('prediction_status', [
  'PROPOSED', 'APPROVED', 'REJECTED', 'DISPATCHED', 'EXPIRED', 'COMPLETED',
])

export const predictionSourceEnum = pgEnum('prediction_source', ['WATCHLIST', 'TASKCARD'])

export const halfDayEnum = pgEnum('half_day', ['AM', 'PM'])

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceKind: predictionSourceEnum('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(), // 指向 watch_lists.id 或 task_cards.id
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    windowDate: timestamp('window_date', { withTimezone: false, mode: 'date' }).notNull(),
    windowHalf: halfDayEnum('window_half').notNull(),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    confidenceNow: integer('confidence_now').notNull().default(0),
    kDays: integer('k_days').notNull(),
    status: predictionStatusEnum('status').notNull().default('PROPOSED'),
    cadenceMinutes: integer('cadence_minutes').notNull().default(1440),
    lastFullAt: timestamp('last_full_at', { withTimezone: true }),
    lastIncrAt: timestamp('last_incr_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('confidence_in_range', sql`${t.confidenceNow} >= 0 AND ${t.confidenceNow} <= 100`),
    index('predictions_status_idx').on(t.status),
    index('predictions_source_idx').on(t.sourceKind, t.sourceId),
    index('predictions_window_idx').on(t.windowDate, t.windowHalf),
    index('predictions_vrt_idx').on(t.vehicleClassId, t.regionId, t.taskClassId),
  ]
)

export const confidenceKindEnum = pgEnum('confidence_kind', ['INCR', 'FULL', 'MANUAL'])

export const confidenceSnapshots = pgTable(
  'confidence_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }),
    kind: confidenceKindEnum('kind').notNull(),
    confidence: integer('confidence').notNull(),
    confidenceCiLow: integer('confidence_ci_low'),
    confidenceCiHigh: integer('confidence_ci_high'),
    evidenceIds: jsonb('evidence_ids').notNull().default(sql`'[]'::jsonb`),
    reasoning: text('reasoning'),
    operator: text('operator'), // 'PredictionAgent' | userId 字符串
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('snapshot_confidence_in_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 100`),
    index('snapshots_pred_ts_idx').on(t.predictionId, t.occurredAt),
  ]
)

export const newsSourceKindEnum = pgEnum('news_source_kind', ['MAINSTREAM', 'GOV', 'SOCIAL', 'FOREIGN'])

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    url: text('url').notNull().unique(),
    sourceKind: newsSourceKindEnum('source_kind').notNull(),
    sourceLabel: text('source_label').notNull(), // 例:"南方日报"
    title: text('title').notNull(),
    summaryZh: text('summary_zh'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: text('content_hash').notNull(),
    contentOrigin: text('content_origin').notNull().default('domestic'), // 'domestic' | 'cross_border'
    rawSnippet: text('raw_snippet'),
    matchedRegions: jsonb('matched_regions').notNull().default(sql`'[]'::jsonb`),
    extractedEntities: jsonb('extracted_entities').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index('news_hash_idx').on(t.contentHash),
    index('news_source_idx').on(t.sourceKind),
    index('news_published_idx').on(t.publishedAt),
  ]
)

export const evidenceWeightEnum = pgEnum('evidence_weight', ['HIGH', 'MED', 'LOW'])

export const newsEvidence = pgTable(
  'news_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }),
    newsId: uuid('news_id').notNull().references(() => newsItems.id, { onDelete: 'restrict' }),
    weight: evidenceWeightEnum('weight').notNull().default('MED'),
    cited: boolean('cited').notNull().default(true),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('evidence_pred_idx').on(t.predictionId),
    index('evidence_news_idx').on(t.newsId),
  ]
)

export type Prediction = typeof predictions.$inferSelect
export type NewPrediction = typeof predictions.$inferInsert
export type ConfidenceSnapshot = typeof confidenceSnapshots.$inferSelect
export type NewsItem = typeof newsItems.$inferSelect
export type NewsEvidence = typeof newsEvidence.$inferSelect
```

- [ ] **Step 2: Add to `src/db/schema/index.ts`**

```ts
export * from './prediction'
```

- [ ] **Step 3: Generate + apply migration**

```bash
bun run db:generate && bun run db:migrate
```

- [ ] **Step 4: Write failing test `tests/db/prediction.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  confidenceSnapshots, newsEvidence, newsItems, predictions,
} from '@/db/schema/prediction'
import { regions } from '@/db/schema/region'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

describe('prediction schema', () => {
  test('insert prediction + snapshot + news + evidence', async () => {
    const { db } = ctx
    const stamp = Date.now()

    // Setup: region, vehicle class, task class
    const [reg] = await db.execute<{ id: string; version: number }>(
      // @ts-expect-error -- raw SQL ok in test
      `INSERT INTO regions (kind, name, version, geom) VALUES
       ('AD_HOC', 'pred-test-${stamp}', 1, ST_GeomFromGeoJSON('${JSON.stringify(poly)}'))
       RETURNING id, version`
    )
    const [vc] = await db.insert(vehicleClasses).values({ name: `应急车-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `抢险-${stamp}`, level: 1 }).returning()

    // Insert prediction
    const [p] = await db.insert(predictions).values({
      sourceKind: 'WATCHLIST',
      sourceId: vc!.id, // dummy uuid (FK not enforced cross-table here)
      regionId: (reg as { id: string }).id,
      regionVersion: 1,
      windowDate: new Date('2026-05-15'),
      windowHalf: 'AM',
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      kDays: 9,
      expiresAt: new Date(Date.now() + 9 * 86400_000),
    }).returning()
    expect(p!.confidenceNow).toBe(0)
    expect(p!.status).toBe('PROPOSED')

    // Insert snapshot
    const [snap] = await db.insert(confidenceSnapshots).values({
      predictionId: p!.id, kind: 'FULL', confidence: 50,
      reasoning: '初次锚点', operator: 'PredictionAgent',
    }).returning()
    expect(snap!.confidence).toBe(50)

    // Insert news + evidence
    const [news] = await db.insert(newsItems).values({
      url: `https://news.example/${stamp}`,
      sourceKind: 'MAINSTREAM',
      sourceLabel: '南方日报',
      title: 'Test news',
      contentHash: `hash-${stamp}`,
    }).returning()
    const [ev] = await db.insert(newsEvidence).values({
      predictionId: p!.id, newsId: news!.id, weight: 'HIGH',
    }).returning()
    expect(ev!.cited).toBe(true)
  })

  test('CHECK rejects confidence > 100', async () => {
    const { db } = ctx
    const stamp = Date.now()
    const [reg] = await db.execute<{ id: string }>(
      // @ts-expect-error -- raw SQL ok
      `INSERT INTO regions (kind, name, version, geom) VALUES
       ('AD_HOC', 'pred-bad-${stamp}', 1, ST_GeomFromGeoJSON('${JSON.stringify(poly)}'))
       RETURNING id`
    )
    const [vc] = await db.insert(vehicleClasses).values({ name: `v-bad-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `t-bad-${stamp}`, level: 1 }).returning()
    await expect(Promise.resolve(db.insert(predictions).values({
      sourceKind: 'WATCHLIST', sourceId: vc!.id,
      regionId: (reg as { id: string }).id, regionVersion: 1,
      windowDate: new Date('2026-05-20'), windowHalf: 'AM',
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      kDays: 14, confidenceNow: 150,
      expiresAt: new Date(Date.now() + 86400_000),
    }))).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Run test, verify passes**

`bun test tests/db/prediction.test.ts` → 2 pass

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/prediction.ts src/db/schema/index.ts \
        migrations/ tests/db/prediction.test.ts
git commit -m "feat(db): predictions / confidence_snapshots / news_items / news_evidence schemas"
```

---

#### Task 2: Dispatch / DispatchResult / MediaAsset schemas

**Files:**
- Create: `src/db/schema/dispatch.ts`
- Modify: `src/db/schema/index.ts:1`
- Create: `tests/db/dispatch.test.ts`

- [ ] **Step 1: Implement**

```ts
// src/db/schema/dispatch.ts
import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { predictions } from './prediction'

export const dispatchStateEnum = pgEnum('dispatch_state', [
  'QUEUED', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'FAILED',
  'REJECTED_BY_ADAPTER', 'CANCEL_PENDING', 'CANCELLED', 'TIMED_OUT',
])

export const dispatchTasks = pgTable(
  'dispatch_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'restrict' }),
    adapterKey: text('adapter_key').notNull(), // 'mock' | 'gov-cam-gd-01' | ...
    externalId: text('external_id'), // backend 自己的 id
    state: dispatchStateEnum('state').notNull().default('QUEUED'),
    paramsJson: jsonb('params_json').notNull().default(sql`'{}'::jsonb`),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    callbackAt: timestamp('callback_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    cost: text('cost'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dispatch_pred_idx').on(t.predictionId),
    index('dispatch_state_idx').on(t.state),
    index('dispatch_external_idx').on(t.adapterKey, t.externalId),
  ]
)

export const dispatchResults = pgTable(
  'dispatch_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispatchId: uuid('dispatch_id').notNull().references(() => dispatchTasks.id, { onDelete: 'cascade' }),
    payloadJson: jsonb('payload_json').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('result_dispatch_idx').on(t.dispatchId)]
)

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispatchId: uuid('dispatch_id').notNull().references(() => dispatchTasks.id, { onDelete: 'cascade' }),
    ossUri: text('oss_uri').notNull(),
    sourceUrl: text('source_url').notNull(),
    mediaType: text('media_type').notNull(), // 'image' | 'video' | 'metadata'
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    scanStatus: text('scan_status').notNull().default('PENDING'), // PENDING | OK | FETCH_FAILED | SCAN_BLOCKED
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('media_dispatch_idx').on(t.dispatchId),
    index('media_scan_idx').on(t.scanStatus),
  ]
)

export type DispatchTask = typeof dispatchTasks.$inferSelect
export type NewDispatchTask = typeof dispatchTasks.$inferInsert
export type DispatchResult = typeof dispatchResults.$inferSelect
export type MediaAsset = typeof mediaAssets.$inferSelect
```

- [ ] **Step 2: Add to schema/index + migrate + test**

(Same pattern as Task 1 — write a minimal test inserting `dispatchTasks` with FK to a real `predictions` row, verify `state='QUEUED'` default, commit.)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(db): dispatch_tasks / dispatch_results / media_assets schemas"
```

---

#### Task 3: WatchList / TaskCard schemas

**Files:**
- Create: `src/db/schema/watchlist.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/watchlist.test.ts`

- [ ] **Step 1: Implement**

```ts
// src/db/schema/watchlist.ts
import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { halfDayEnum } from './prediction'

export const watchLists = pgTable(
  'watch_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    kRangeMin: integer('k_range_min').notNull().default(1),
    kRangeMax: integer('k_range_max').notNull().default(14),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('watchlist_active_idx').on(t.isActive),
    index('watchlist_vrt_idx').on(t.vehicleClassId, t.regionId, t.taskClassId),
  ]
)

export const taskCards = pgTable(
  'task_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    targetWindowDate: timestamp('target_window_date', { withTimezone: false, mode: 'date' }).notNull(),
    targetWindowHalf: halfDayEnum('target_window_half').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('taskcard_target_idx').on(t.targetWindowDate, t.targetWindowHalf)]
)

export type WatchList = typeof watchLists.$inferSelect
export type NewWatchList = typeof watchLists.$inferInsert
export type TaskCard = typeof taskCards.$inferSelect
export type NewTaskCard = typeof taskCards.$inferInsert
```

- [ ] **Step 2: Migrate + write minimal test (insert + select)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(db): watch_lists / task_cards schemas"
```

---

### Section 2 — Inference Layer(LLM 调用)

#### Task 4: Env additions for LLM + Search + Geocoder

**Files:**
- Modify: `.env.example`
- Modify: `src/env.ts`

- [ ] **Step 1: Update `.env.example`** — append:

```
# --- LLM(阿里云 dashscope OpenAI 兼容) ---
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=                  # EX-4 占位
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT_MS=30000

# --- News Search(EX-3 占位:Bing News Search v7 fallback)---
SEARCH_API_KIND=bing-news     # bing-news | mock
SEARCH_API_KEY=               # EX-3 占位
SEARCH_API_BASE_URL=https://api.bing.microsoft.com/v7.0/news/search

# --- 高德地理编码 ---
AMAP_GEOCODE_KEY=             # EX-5 占位(可空,fallback 走规则匹配)
```

- [ ] **Step 2: Add to `src/env.ts` schema**

```ts
LLM_BASE_URL: z.string().url(),
LLM_API_KEY: z.string().default(''),
LLM_MODEL: z.string().default('deepseek-v4-flash'),
LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
SEARCH_API_KIND: z.enum(['bing-news', 'mock']).default('mock'),
SEARCH_API_KEY: z.string().default(''),
SEARCH_API_BASE_URL: z.string().url().default('https://api.bing.microsoft.com/v7.0/news/search'),
AMAP_GEOCODE_KEY: z.string().default(''),
```

- [ ] **Step 3: Run `bun test` — env tests should still pass**

- [ ] **Step 4: Commit**

```bash
git add .env.example src/env.ts
git commit -m "feat(env): add LLM / Search / Geocoder env keys"
```

---

#### Task 5: Inference client — OpenAI-compat to dashscope

**Files:**
- Create: `src/inference/types.ts`
- Create: `src/inference/client.ts`
- Create: `src/inference/parser.ts`
- Create: `tests/inference/client.test.ts`
- Create: `tests/inference/parser.test.ts`

- [ ] **Step 1: `src/inference/types.ts`**

```ts
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export type InferenceRequest = {
  messages: Message[]
  temperature?: number
  responseFormat?: 'json_object' | 'text'
  maxTokens?: number
}

export type InferenceResponse = {
  text: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
}

export class InferenceError extends Error {
  constructor(public readonly kind: 'NETWORK' | 'API' | 'TIMEOUT' | 'PARSE', msg: string) {
    super(msg)
  }
}
```

- [ ] **Step 2: `src/inference/client.ts`** — minimal OpenAI-compat fetch

```ts
import { loadEnv } from '@/env'
import { InferenceError, type InferenceRequest, type InferenceResponse } from './types'

export async function infer(req: InferenceRequest): Promise<InferenceResponse> {
  const env = loadEnv()
  if (!env.LLM_API_KEY) {
    throw new InferenceError('API', 'LLM_API_KEY not set; set it in .env or use mock dispatcher')
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), env.LLM_TIMEOUT_MS)
  try {
    const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: req.messages,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ac.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new InferenceError('API', `LLM ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
      model: string
    }
    return {
      text: json.choices[0]?.message.content ?? '',
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
      totalTokens: json.usage.total_tokens,
      model: json.model,
    }
  } catch (e) {
    if (e instanceof InferenceError) throw e
    if ((e as Error).name === 'AbortError') throw new InferenceError('TIMEOUT', 'LLM request timed out')
    throw new InferenceError('NETWORK', (e as Error).message)
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 3: `src/inference/parser.ts`** — strict JSON extract with fallback

```ts
import { InferenceError } from './types'

// LLM 输出的 JSON 偶尔会被 ```json ... ``` 包裹或前后带解释文本。
// 提取首个 {...} 或 [...] 整体子串后 JSON.parse;失败抛 InferenceError('PARSE')
export function extractJson<T>(text: string): T {
  const trimmed = text.trim()
  // 优先尝试整体解析
  try { return JSON.parse(trimmed) as T } catch {}

  // 找第一个 { 或 [ 开始,匹配最近的 } 或 ]
  const start = Math.min(
    ...['{', '['].map(c => {
      const i = trimmed.indexOf(c)
      return i < 0 ? Number.POSITIVE_INFINITY : i
    })
  )
  if (!isFinite(start)) throw new InferenceError('PARSE', 'no JSON object/array found in response')

  const open = trimmed[start]!
  const close = open === '{' ? '}' : ']'
  // 简单括号计数;跳过字符串内引号
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i]!
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1)
        try { return JSON.parse(slice) as T }
        catch (e) { throw new InferenceError('PARSE', `JSON.parse failed: ${(e as Error).message}`) }
      }
    }
  }
  throw new InferenceError('PARSE', `unterminated ${open}…${close}`)
}
```

- [ ] **Step 4: Tests for parser(纯函数,无网络)**

```ts
// tests/inference/parser.test.ts
import { describe, expect, test } from 'bun:test'
import { extractJson } from '@/inference/parser'

describe('extractJson', () => {
  test('plain JSON object', () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
  })
  test('JSON wrapped in markdown fence', () => {
    expect(extractJson<{ b: string }>('```json\n{"b": "x"}\n```')).toEqual({ b: 'x' })
  })
  test('JSON with explanation prefix', () => {
    expect(extractJson<{ c: number }>('Here is the result: {"c": 42}')).toEqual({ c: 42 })
  })
  test('throws on no JSON', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON/)
  })
  test('handles strings with curly braces', () => {
    expect(extractJson<{ s: string }>('{"s": "{not real}"}')).toEqual({ s: '{not real}' })
  })
})
```

- [ ] **Step 5: Test for client (skip if no API key)**

```ts
// tests/inference/client.test.ts
import { describe, expect, test } from 'bun:test'
import { infer } from '@/inference/client'
import { InferenceError } from '@/inference/types'

const HAS_KEY = !!process.env.LLM_API_KEY

describe.skipIf(!HAS_KEY)('inference client (real LLM)', () => {
  test('roundtrip with dashscope', async () => {
    const r = await infer({
      messages: [{ role: 'user', content: 'reply with the single character: A' }],
      temperature: 0,
    })
    expect(r.text).toContain('A')
    expect(r.totalTokens).toBeGreaterThan(0)
  }, 60_000)
})

describe('inference client (no key)', () => {
  test('throws InferenceError when API key missing', async () => {
    const orig = process.env.LLM_API_KEY
    delete process.env.LLM_API_KEY
    await expect(infer({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(InferenceError)
    if (orig) process.env.LLM_API_KEY = orig
  })
})
```

- [ ] **Step 6: Run, verify(parser tests pass; client tests skip if no key)**

- [ ] **Step 7: Commit**

```bash
git add src/inference/ tests/inference/
git commit -m "feat(inference): OpenAI-compat client to dashscope + JSON parser"
```

---

### Section 3 — Agent Layer

#### Task 6: PredictionAgent prompts + parser

**Files:**
- Create: `src/inference/prompts/prediction-agent.ts`
- Create: `tests/inference/prompts.test.ts`

- [ ] **Step 1: Prompt template**

```ts
// src/inference/prompts/prediction-agent.ts
import { z } from 'zod'

export const PREDICTION_AGENT_SYSTEM = `
你是一个新闻情报分析 Agent,任务是基于一组新闻证据,评估在未来某天某时段(AM/PM),
某区域内,某类车辆为执行某任务而出动的概率。

输出 JSON,包含:
- confidence: 0-100 整数(出动概率)
- ci_low / ci_high: 0-100 整数(置信区间下/上界)
- reasoning: 1-3 段中文,解释判断依据
- evidence_ids: 引用的新闻 id 数组(从输入中选)
- key_signals: 决定性信号短语数组,每条 ≤ 30 字

不要输出 markdown 围栏,只输出原始 JSON 对象。
`.trim()

export type PredictionAgentInput = {
  vehicleClass: string  // "应急救援车 / 高喷消防车"
  taskClass: string     // "抢险救援"
  region: { name: string; adminChain: string }
  windowDate: string    // ISO
  windowHalf: 'AM' | 'PM'
  evidence: Array<{
    id: string
    sourceLabel: string
    sourceKind: 'mainstream' | 'gov' | 'social' | 'foreign'
    title: string
    summary: string
    publishedAt?: string
  }>
  pastCases?: Array<{
    outcome: 'HIT' | 'MISS' | 'NO_DATA'
    summary: string
    confidence: number
  }>
}

export const PredictionAgentOutputSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  ci_low: z.number().int().min(0).max(100),
  ci_high: z.number().int().min(0).max(100),
  reasoning: z.string().min(10),
  evidence_ids: z.array(z.string()),
  key_signals: z.array(z.string().max(60)),
}).refine(d => d.ci_low <= d.confidence && d.confidence <= d.ci_high, {
  message: 'ci must satisfy low ≤ confidence ≤ high',
})

export type PredictionAgentOutput = z.infer<typeof PredictionAgentOutputSchema>

export function renderPredictionUserMsg(input: PredictionAgentInput): string {
  const evidenceBlock = input.evidence
    .map((e, i) => `[${e.id}] (${e.sourceLabel} · ${e.sourceKind}${e.publishedAt ? ` · ${e.publishedAt}` : ''}) ${e.title}\n  摘要: ${e.summary}`)
    .join('\n\n')
  const pastBlock = (input.pastCases ?? [])
    .map(c => `- 历史 ${c.outcome}(预测 ${c.confidence}):${c.summary}`)
    .join('\n') || '(无历史)'
  return `
预测目标:
- 车类: ${input.vehicleClass}
- 任务: ${input.taskClass}
- 区域: ${input.region.name}(${input.region.adminChain})
- 时段: ${input.windowDate} ${input.windowHalf === 'AM' ? '上午' : '下午'}

证据:
${evidenceBlock}

历史相似案例:
${pastBlock}

请评估并输出 JSON。
`.trim()
}
```

- [ ] **Step 2: Tests** — render + schema parse

```ts
// tests/inference/prompts.test.ts
import { describe, expect, test } from 'bun:test'
import { PredictionAgentOutputSchema, renderPredictionUserMsg } from '@/inference/prompts/prediction-agent'

describe('PredictionAgent prompt', () => {
  test('renders without past cases', () => {
    const msg = renderPredictionUserMsg({
      vehicleClass: '应急救援车', taskClass: '抢险救援',
      region: { name: '粤西沿海', adminChain: '中国/广东省/茂名市' },
      windowDate: '2026-05-11', windowHalf: 'AM',
      evidence: [{ id: 'n1', sourceLabel: '南方日报', sourceKind: 'mainstream', title: '...', summary: '...' }],
    })
    expect(msg).toContain('粤西沿海')
    expect(msg).toContain('[n1]')
    expect(msg).toContain('(无历史)')
  })

  test('schema rejects ci_low > confidence', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 50, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明', evidence_ids: ['n1'], key_signals: ['signal'],
    })
    expect(r.success).toBe(false)
  })

  test('schema accepts valid output', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 65, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明', evidence_ids: ['n1'], key_signals: ['signal'],
    })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(inference): PredictionAgent prompt + zod output schema"
```

---

#### Task 7: NewsTriageAgent prompts(同样模式)

**Files:**
- Create: `src/inference/prompts/news-triage-agent.ts`
- Create: `tests/inference/news-triage.test.ts`

NewsTriageAgent 判断:给定一条新闻 + 一个 (V,T,R) 候选预测目标,这条新闻是否对该预测有信息增量?输出 `{ relevant: boolean; weight: 'HIGH'|'MED'|'LOW'; reasoning: string }`。同样写 prompt + zod schema + 渲染函数 + 测试。

(细节略,与 Task 6 同结构。)

```bash
git commit -m "feat(inference): NewsTriageAgent prompt + schema"
```

---

#### Task 8: PredictionAgent 编排(调 LLM + 解析 + 写 DB)

**Files:**
- Create: `src/agents/prediction-agent.ts`
- Create: `tests/agents/prediction-agent.test.ts`

- [ ] **Step 1: 实现编排**

```ts
// src/agents/prediction-agent.ts
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { predictions, confidenceSnapshots, newsItems, newsEvidence } from '@/db/schema/prediction'
import { regions } from '@/db/schema/region'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import {
  PREDICTION_AGENT_SYSTEM,
  PredictionAgentOutputSchema,
  renderPredictionUserMsg,
  type PredictionAgentInput,
  type PredictionAgentOutput,
} from '@/inference/prompts/prediction-agent'

export type RunInput = {
  predictionId: string
  kind: 'INCR' | 'FULL'
  newEvidenceIds?: string[]  // INCR 时传新证据;FULL 忽略,拉全部
}

export async function runPredictionAgent(db: Db, input: RunInput): Promise<PredictionAgentOutput> {
  // 1. 拉预测元数据
  const [p] = await db.select().from(predictions).where(eq(predictions.id, input.predictionId))
  if (!p) throw new Error(`prediction ${input.predictionId} not found`)
  const [vc] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, p.vehicleClassId))
  const [tc] = await db.select().from(taskClasses).where(eq(taskClasses.id, p.taskClassId))
  if (!vc || !tc) throw new Error('class lookup failed')

  // 2. 拉 region (绑版本)
  const regResult = await db.execute(/* SELECT ... FROM regions WHERE id=$1 AND version=$2 */
    // 实际用 sql\`...\`,这里伪代码
    {} as never
  )
  // 3. 拉证据
  // FULL: prediction 关联的全部 evidence;INCR: 只取 newEvidenceIds + 当前 confidence summary
  // 4. 拼 PredictionAgentInput
  // 5. 调 infer({ messages: [{role:system,...}, {role:user,...}], responseFormat:'json_object' })
  // 6. extractJson + zod parse
  // 7. 写 confidenceSnapshots(kind=INCR/FULL, confidence, reasoning, evidenceIds)
  // 8. 更新 predictions.confidenceNow + lastIncrAt|lastFullAt
  // 9. 返回 output

  // (具体实现见 Task 8 完整 step;这里给出函数签名 + 步骤注释)
  throw new Error('Task 8 implement details')
}
```

- [ ] **Step 2: 编写编排具体步骤(查询 region 当前版本、拉 evidence、拼 input、调 infer、解析、写 snapshot 与 prediction 当前值)**

- [ ] **Step 3: Tests with mocked infer**

```ts
// tests/agents/prediction-agent.test.ts
import { mock } from 'bun:test'
import * as inference from '@/inference/client'

// 用 bun:test 的 mock 替换 infer:
mock.module('@/inference/client', () => ({
  infer: async () => ({
    text: JSON.stringify({
      confidence: 75, ci_low: 70, ci_high: 80,
      reasoning: '基于茂名应急局公告 + 主流报道...',
      evidence_ids: ['n1', 'n2'], key_signals: ['II 级响应启动'],
    }),
    promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'mock',
  }),
}))

// 然后:setup region/vc/tc/prediction/news/evidence in test DB,call runPredictionAgent,verify:
// - 写入了一条 confidenceSnapshots(kind 与 input 一致)
// - predictions.confidenceNow 更新到 75
// - 返回的 output 通过 zod parse
```

- [ ] **Step 4: Run, verify passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agents): PredictionAgent orchestration with LLM + DB writes"
```

---

#### Task 9: NewsTriageAgent 编排(同上)

类似 Task 8,产出 `runNewsTriageAgent(db, { newsId, predictionTarget }) → { relevant, weight }`,写入 `news_evidence`(若 relevant)。

```bash
git commit -m "feat(agents): NewsTriageAgent orchestration"
```

---

#### Task 10: Case retriever(BM25 简化版)

**Files:**
- Create: `src/agents/case-retriever.ts`
- Create: `tests/agents/case-retriever.test.ts`

m1 还没有 retrospective 表,所以 Plan-B 的案例库用预测的 `(vehicleClassId, taskClassId, regionAdminChain, kBucket, status)` 做硬规则匹配 — 找过去同 V/T 同区域同 K 区间的预测,按相似度排序返回 top-5。`status='COMPLETED'` 时算 HIT(占位,真正 HIT/MISS 由 m3 retrospective 提供)。Plan-C 升级到带 outcome 的真实案例库 + BM25。

```ts
// src/agents/case-retriever.ts
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { predictions } from '@/db/schema/prediction'

export type CaseSummary = {
  predictionId: string
  outcome: 'HIT' | 'MISS' | 'NO_DATA'  // m2 占位:status COMPLETED → HIT,EXPIRED 未调度 → MISS,其余 NO_DATA
  confidence: number
  summary: string
}

export async function retrieveCases(db: Db, q: {
  vehicleClassId: string; taskClassId: string;
  kDays: number; topK?: number;
}): Promise<CaseSummary[]> {
  const kMin = Math.max(1, q.kDays - 3), kMax = q.kDays + 3
  const rows = await db.execute<{ id: string; status: string; confidence_now: number; window_date: string }>(sql`
    SELECT id, status, confidence_now, window_date
    FROM predictions
    WHERE vehicle_class_id = ${q.vehicleClassId}::uuid
      AND task_class_id = ${q.taskClassId}::uuid
      AND k_days BETWEEN ${kMin} AND ${kMax}
      AND status IN ('COMPLETED', 'EXPIRED')
    ORDER BY window_date DESC
    LIMIT ${q.topK ?? 5}
  `)
  return rows.map(r => ({
    predictionId: r.id,
    outcome: r.status === 'COMPLETED' ? 'HIT' : 'MISS',
    confidence: r.confidence_now,
    summary: `${r.window_date} 窗口预测(${r.status})`,
  }))
}
```

- [ ] **Step 2: Test** — insert a few historical predictions with mixed status, call retrieveCases, verify ordering + filtering.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(agents): case retriever (m2 placeholder, m3 upgrades to BM25 + outcomes)"
```

---

### Section 4 — News Ingestion

#### Task 11: SearchAdapter — Bing News + mock

**Files:**
- Create: `src/news/search-adapter.ts`
- Create: `tests/news/search-adapter.test.ts`

EX-3:默认实现 Bing News v7,fallback `mock` kind 跑测试。

```ts
// src/news/search-adapter.ts
import { loadEnv } from '@/env'

export type SearchHit = {
  url: string
  title: string
  snippet: string
  publishedAt?: string
  source: { name: string; kind: 'mainstream' | 'gov' | 'social' | 'foreign' }
}

export interface SearchAdapter {
  query(keywords: string[], opts?: { count?: number; freshness?: 'Day' | 'Week' | 'Month' }): Promise<SearchHit[]>
}

class BingNewsAdapter implements SearchAdapter {
  async query(keywords: string[], opts: { count?: number; freshness?: 'Day' | 'Week' | 'Month' } = {}) {
    const env = loadEnv()
    const params = new URLSearchParams({
      q: keywords.join(' '),
      count: String(opts.count ?? 20),
      freshness: opts.freshness ?? 'Week',
      mkt: 'zh-CN',
    })
    const res = await fetch(`${env.SEARCH_API_BASE_URL}?${params}`, {
      headers: { 'Ocp-Apim-Subscription-Key': env.SEARCH_API_KEY },
    })
    if (!res.ok) throw new Error(`bing news ${res.status}`)
    const data = await res.json() as { value: Array<{ url: string; name: string; description: string; datePublished: string; provider?: Array<{ name: string }> }> }
    return data.value.map((v): SearchHit => ({
      url: v.url, title: v.name, snippet: v.description, publishedAt: v.datePublished,
      source: { name: v.provider?.[0]?.name ?? 'Unknown', kind: 'mainstream' },
    }))
  }
}

class MockSearchAdapter implements SearchAdapter {
  async query(keywords: string[]): Promise<SearchHit[]> {
    return [{
      url: `https://mock.example/${encodeURIComponent(keywords.join('-'))}-${Date.now()}`,
      title: `[Mock] ${keywords.join(' / ')}`,
      snippet: `mock 摘要 for: ${keywords.join(', ')}`,
      publishedAt: new Date().toISOString(),
      source: { name: 'MOCK', kind: 'mainstream' },
    }]
  }
}

export function getSearchAdapter(): SearchAdapter {
  const env = loadEnv()
  return env.SEARCH_API_KIND === 'bing-news' && env.SEARCH_API_KEY
    ? new BingNewsAdapter()
    : new MockSearchAdapter()
}
```

- [ ] **Tests:** mock returns at least 1 hit;Bing path skipped if no key.

```bash
git commit -m "feat(news): SearchAdapter with bing-news + mock fallback"
```

---

#### Task 12: NewsNormalizer — 去重 + 简单中文摘要

**Files:**
- Create: `src/news/normalizer.ts`
- Create: `tests/news/normalizer.test.ts`

```ts
// src/news/normalizer.ts
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsItems, type NewsItem } from '@/db/schema/prediction'
import type { SearchHit } from './search-adapter'

export async function ingestHit(db: Db, hit: SearchHit): Promise<{ news: NewsItem; isNew: boolean }> {
  const contentHash = createHash('sha256').update(hit.url + hit.title + hit.snippet).digest('hex')
  // 去重:按 url(unique) 或 contentHash
  const [existing] = await db.select().from(newsItems).where(eq(newsItems.url, hit.url))
  if (existing) return { news: existing, isNew: false }

  const [created] = await db.insert(newsItems).values({
    url: hit.url,
    sourceKind: hit.source.kind === 'mainstream' ? 'MAINSTREAM' : hit.source.kind === 'gov' ? 'GOV' : hit.source.kind === 'social' ? 'SOCIAL' : 'FOREIGN',
    sourceLabel: hit.source.name,
    title: hit.title,
    summaryZh: hit.snippet.slice(0, 280),  // 简单截断;m3 升级 LLM 摘要
    publishedAt: hit.publishedAt ? new Date(hit.publishedAt) : null,
    contentHash,
    rawSnippet: hit.snippet,
  }).returning()
  return { news: created!, isNew: true }
}
```

- [ ] **Tests:** insert one hit twice — second call returns isNew=false。

```bash
git commit -m "feat(news): NewsNormalizer with URL dedup + sha256 + simple summary"
```

---

#### Task 13: NewsGeocoder — 高德 API + 规则 fallback

**Files:**
- Create: `src/news/geocoder.ts`
- Create: `tests/news/geocoder.test.ts`

EX-5:`AMAP_GEOCODE_KEY` 缺失时走规则 fallback——把 region.name 子串和 news.title/summary 做 LIKE 匹配,命中即标 matched_regions[r.id]。

```bash
git commit -m "feat(news): NewsGeocoder with AMAP API + LIKE fallback"
```

---

#### Task 14: PredictionMatcher — 新入库 news → 候选 predictions

**Files:**
- Create: `src/news/matcher.ts`
- Create: `tests/news/matcher.test.ts`

匹配逻辑:对一条 newsItems,扫所有 PROPOSED 状态、未过期的 predictions,按 (region match) AND (V/T 关键词出现在 title 或 summary)选出候选;每条候选触发 NewsTriageAgent。

```bash
git commit -m "feat(news): PredictionMatcher routes new items to candidate predictions"
```

---

### Section 5 — Scheduler

#### Task 15: BullMQ + Redis bootstrap

**Files:**
- Modify: `package.json` 加 `bullmq`、`ioredis`
- Create: `src/scheduler/queue.ts`
- Create: `src/scheduler/workers.ts`
- Create: `tests/scheduler/queue.test.ts`

```ts
// src/scheduler/queue.ts
import { Queue } from 'bullmq'
import { loadEnv } from '@/env'

const env = loadEnv()
const connection = { url: env.REDIS_URL }

export const refreshQueue = new Queue('refresh', { connection })  // INCR 触发
export const fullRecalcQueue = new Queue('full-recalc', { connection })
export const newsIngestQueue = new Queue('news-ingest', { connection })
export const dispatchQueue = new Queue('dispatch', { connection })
```

- [ ] Workers register handlers + simple smoke test (enqueue + process).

```bash
git commit -m "feat(scheduler): bullmq queues and worker registry"
```

---

#### Task 16: K-自适应 cadence 计算

**Files:**
- Create: `src/scheduler/cadence.ts`
- Create: `tests/scheduler/cadence.test.ts`

设计稿 §3.1:
| K_days | cadence |
|---|---|
| ≤ 3 | 6h |
| 3 < K ≤ 14 | 24h |
| 14 < K ≤ 60 | 48h |
| > 60 | weekly |

```ts
export function cadenceMinutesForK(kDays: number): number {
  if (kDays <= 3) return 6 * 60
  if (kDays <= 14) return 24 * 60
  if (kDays <= 60) return 48 * 60
  return 7 * 24 * 60
}
```

测试覆盖边界。

```bash
git commit -m "feat(scheduler): K-adaptive cadence per spec §3.1"
```

---

#### Task 17: agent_full 触发表 P1-P5 评估

**Files:**
- Create: `src/scheduler/full-trigger.ts`
- Create: `tests/scheduler/full-trigger.test.ts`

设计稿 §3.1 触发表:
- P1: 距上次 FULL ≥ N 次 INCR(N=5)
- P2: 距上次 FULL ≥ D 天(D=7)
- P3: 累计新增证据 ≥ M 条(M=10)
- P4: |Σ Δ_incr| > X pp(X=25)→ 漂移检测
- P5: 分析师手动触发

```ts
export async function shouldTriggerFull(db: Db, predictionId: string, opts?: { thresholds?: Partial<TriggerThresholds> }): Promise<{ triggered: boolean; priority?: 'P1'|'P2'|'P3'|'P4'|'P5'; reason: string }>
```

实现 + 单测覆盖每条触发。

```bash
git commit -m "feat(scheduler): agent_full P1-P5 trigger evaluator"
```

---

#### Task 18: 漂移检测器(P4 详细实现)

**Files:**
- Create: `src/scheduler/drift-detector.ts`
- Create: `tests/scheduler/drift-detector.test.ts`

```ts
// 计算自上次 FULL 以来累计 Δ_incr,阈值 25pp
export async function computeDriftSinceLastFull(db: Db, predictionId: string): Promise<number>
```

```bash
git commit -m "feat(scheduler): drift detector for P4 trigger"
```

---

### Section 6 — WatchList / TaskCard / Prediction Services

#### Task 19: WatchList service + routes

**Files:**
- Create: `src/modules/watchlist/service.ts`
- Create: `src/modules/watchlist/routes.ts`
- Modify: `src/server.ts` mount /watchlists
- Modify: `tests/helpers/test-server.ts`
- Create: `tests/modules/watchlist.test.ts`

CRUD:create/list/get/update(toggle isActive)/delete (soft = isActive=false)。

```bash
git commit -m "feat(watchlist): CRUD service + routes"
```

---

#### Task 20: TaskCard service + routes

类似 Task 19,但 TaskCard 是单点查询,不带 isActive。create 时**立即触发首次 PredictionAgent**(走 BullMQ 投递 full-recalc job)。

```bash
git commit -m "feat(taskcard): CRUD service + routes + initial prediction trigger"
```

---

#### Task 21: Prediction service + ConfidenceSnapshot 写入

**Files:**
- Create: `src/modules/prediction/service.ts`
- Create: `src/modules/prediction/confidence.ts`

`writeConfidenceSnapshot(db, predictionId, kind, confidence, evidenceIds, reasoning, operator)` — 同时更新 predictions.confidenceNow + lastIncrAt|lastFullAt(根据 kind)。

```bash
git commit -m "feat(prediction): service + ConfidenceSnapshot write helper"
```

---

#### Task 22: Prediction routes + 批/驳/手动重算

**Files:**
- Create: `src/modules/prediction/routes.ts`
- Modify: `src/server.ts`、`tests/helpers/test-server.ts`
- Create: `tests/modules/prediction.test.ts`

路由:
- `GET /predictions` — 列表(带 status / 角色态过滤)
- `GET /predictions/:id` — 详情(含最新 snapshot 序列 + 证据)
- `POST /predictions/:id/approve`(A 角色,需 activeRole=DECIDER)→ 写 OperationAudit + status=APPROVED + 投递 dispatch job
- `POST /predictions/:id/reject` 同上
- `POST /predictions/:id/manual-confidence`(B 角色,需 reason)→ MANUAL snapshot
- `POST /predictions/:id/recompute-now` → 投递 full-recalc job

```bash
git commit -m "feat(prediction): routes for list/detail/approve/reject/manual-conf/recompute"
```

---

### Section 7 — Dispatch(Mock for m2)

#### Task 23: Mock camera adapter

**Files:**
- Create: `src/dispatch/adapters/mock.ts`
- Create: `tests/dispatch/mock-adapter.test.ts`

EX-2 占位:接到调度请求后,在 DB 中写一条 dispatch_tasks(state=SENT),不真发请求,3 秒后定时跳到 IN_PROGRESS,30 秒后 COMPLETED + 写一条 dispatch_results 与 1 条 mock media_assets。

```bash
git commit -m "feat(dispatch): MockCameraAdapter (EX-2 placeholder)"
```

---

#### Task 24: DispatchService + adapter pool 骨架

**Files:**
- Create: `src/dispatch/service.ts`
- Create: `src/dispatch/adapter-pool.ts`
- Create: `tests/dispatch/service.test.ts`

`enqueueDispatch(db, predictionId, adapterKey='mock')` — 写 dispatch_tasks(QUEUED)+ 投 BullMQ dispatch job。Worker 调 adapter.dispatch() 推进状态机。撤单(cancel) Plan-C 完整实现,m2 仅留空函数占位。

```bash
git commit -m "feat(dispatch): service + adapter pool skeleton (mock-only)"
```

---

### Section 8 — Frontend(Plan-B)

#### Task 25: Frontend API 客户端 — Prediction + WatchList + TaskCard

**Files:**
- Create: `frontend/src/lib/prediction-api.ts`
- Create: `frontend/src/lib/watchlist-api.ts`
- Create: `frontend/src/lib/taskcard-api.ts`

按 m1 `auth.ts` 模板写 fetch 包装。

```bash
git commit -m "feat(frontend): API clients for prediction / watchlist / taskcard"
```

---

#### Task 26: 移植业务组件 — ConfBar / SourceMix / KpiRow / Status

**Files:**
- Create: `frontend/src/components/ConfBar.tsx`
- Create: `frontend/src/components/SourceMix.tsx`
- Create: `frontend/src/components/KpiRow.tsx`

从原型 `components.jsx` 移植 ConfBar / SourceMix(显示置信度条与信源构成),保持 className 一致。KpiRow 是 4 列 KPI 卡。

```bash
git commit -m "feat(frontend): port ConfBar / SourceMix / KpiRow business components"
```

---

#### Task 27: PredictionTable — AnalystView 数据表

**Files:**
- Create: `frontend/src/components/PredictionTable.tsx`

字段:shortId / V / T / R / 时段 / K / confidence(用 ConfBar)/ status(用 Status 原子)/ 操作按钮(查看详情)。点行触发 onOpenPrediction(id)。

```bash
git commit -m "feat(frontend): PredictionTable component"
```

---

#### Task 28: AnalystView 重写——真实数据 + 监视清单 sidebar + 表

**Files:**
- Modify: `frontend/src/routes/analyst/AnalystView.tsx`
- Create: `frontend/src/routes/analyst/WatchListPanel.tsx`
- Create: `frontend/src/routes/analyst/NewWatchListModal.tsx`
- Create: `frontend/src/routes/analyst/NewTaskCardModal.tsx`

布局对照原型 `view-analyst.jsx`:左侧 sidebar(监视清单 + 任务卡 + 区域)+ 右侧 workspace(KPIRow + PredictionTable)。点行打开 PredictionDetail(Task 30)。

```bash
git commit -m "feat(analyst): real data + sidebar watchlists + KPIs + table"
```

---

#### Task 29: DecisionView 重写——Inbox 卡

**Files:**
- Modify: `frontend/src/routes/decision/DecisionView.tsx`
- Create: `frontend/src/components/InboxCard.tsx`

InboxCard 按原型 `view-decision-reviewer.jsx`(decision 部分):卡片 = 标题 + 关键字段 + ConfBar + 一句 reasoning + 批/驳两按钮。

```bash
git commit -m "feat(decision): Inbox cards with one-click approve/reject"
```

---

#### Task 30: PredictionDetail — DetailPane 内容(置信度时间线 + 证据链)

**Files:**
- Create: `frontend/src/components/ConfidenceTimeline.tsx`(SVG 自定义图)
- Create: `frontend/src/components/EvidenceList.tsx`
- Create: `frontend/src/components/PredictionDetail.tsx`(组装 DetailPane 内容)

ConfidenceTimeline 用原型 `.ctl` class + 内联 SVG 画一条折线 + 阈值线 + CI 带状区域。EvidenceList 用 `.evidence-row` 列表 + cited 高亮。PredictionDetail 在顶部显示元数据 + 中段时间线 + 下段证据 + 末段操作按钮(批/驳/手动调置信度)。

```bash
git commit -m "feat(prediction-detail): ConfidenceTimeline + EvidenceList + DetailPane content"
```

---

#### Task 31: App.tsx 接 PredictionDetail overlay state

**Files:**
- Modify: `frontend/src/App.tsx`

在 App 加 `openPredictionId` state + DetailPane:

```tsx
const [openPrediction, setOpenPrediction] = useState<string | null>(null)
// ...
<DetailPane open={!!openPrediction} onClose={() => setOpenPrediction(null)}>
  {openPrediction && <PredictionDetail predictionId={openPrediction} />}
</DetailPane>
```

把 setOpenPrediction 透传给 AnalystView / DecisionView。

```bash
git commit -m "feat(app): wire PredictionDetail overlay into role views"
```

---

### Section 9 — Integration + Smoke

#### Task 32: E2E prediction flow test

**Files:**
- Create: `tests/e2e/prediction-flow.test.ts`

完整路径:
1. 登录(seed admin + ANALYST role)
2. POST /watchlists 创建一份监视清单
3. 直接调 PredictionAgent 模拟产出一条 Prediction(用 mocked infer)
4. GET /predictions 看到列表
5. 切到 DECIDER → POST /predictions/:id/approve
6. 等 BullMQ 处理 → 检查 dispatch_tasks 出现一条 SENT
7. (mock adapter 自动跳到 IN_PROGRESS → COMPLETED)
8. 复盘(m3)留空

```bash
git commit -m "test(e2e): m2 prediction flow — watchlist → prediction → approval → mock dispatch"
```

---

#### Task 33: README 补 m2 启动说明

**Files:**
- Modify: `README.md`

加一节 "## m2 启动说明":新增 env(LLM/SEARCH/AMAP)、新 scripts(`agent:run-prediction <id>` 手动跑)、BullMQ worker 启动方式(`bun src/scheduler/workers.ts` 单独跑或 `bun run dev` 时自动起)。

```bash
git commit -m "docs: README m2 section — env / workers / agent scripts"
```

---

#### Task 34: m2 验收对照清单

**Files:**
- Create: `docs/superpowers/plans/2026-05-06-m2-prediction-core-acceptance.md`

ISC 勾选 + 功能验收(创 watchlist → 看到自动产 prediction → 切角色 → 批准 → mock dispatch 完成)+ 占位清单(EX-1 ~ EX-5 哪些已落地)。

```bash
git commit -m "docs(plan-b): m2 acceptance checklist"
```

---

## Self-Review

### Spec / placeholder scan

- 5 个 EX-* 占位均显式标注且关联到具体 task,impl 时知道在哪发现需要实参
- 每个 task 都有 commit 步骤 + 测试步骤
- TDD 模式贯穿(写 test → 跑失败 → 实现 → 跑通 → commit)

### Type consistency

- `Prediction.status` enum 串通到前端 `Status.tsx`(已定义于 m1)
- `confidenceKindEnum` 串通到 ConfidenceTimeline 组件
- `dispatchStateEnum` 状态机覆盖 m1 设计稿 §3.2 全部状态

### 已知缺口(留 Plan-C / m3)

- WebhookIngest(目前是 mock 自跳状态)
- MediaFetcher(mock adapter 直接写 mock OSS URI)
- RetrospectiveAgent + 二轴 outcome(留 m3)
- 撤单完整链路(m2 仅留 cancel 函数占位)
- 真实 adapter 接入(EX-2)
- D 角色 ReviewerView 数据接入(m3)
- AD_HOC → ADMIN_NAMED 晋升 UI(K1=做但 m2 不做,m4 实装)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-06-m2-prediction-core.md`(34 任务,~150 TDD steps,~4 周工作量)。**

执行选项与 Plan-A 同:**SUBAGENT-DRIVEN** / **INLINE EXECUTION** / **STOP**。

⚠️ **建议先把 EX-3 / EX-4 / EX-2 (V/T/R 三元组、LLM key、第一个真实 adapter)中**至少 2 个**确认到位再开干**。否则 Task 5-9(LLM 调用)、Task 11(SearchAdapter)、Task 23(Mock adapter)虽然能跑但产出价值打折——预测会全是 mock 文本,客户演示时容易戳穿。
