# m3 Real End-to-End Implementation Plan (Plan-C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans。Steps 用 `- [ ]` 跟踪。

**Goal:** 把 m2 留下的所有 stub / mock 全部换成可演示的真实闭环。完成时 = **客户能在浏览器里走完一条真实 Slice 0 链路**:登录 → 看监视清单上 Agent 自动产生的预测 → A 一键批准 → `SimulatedGuangzhouPoliceCamAdapter` 模拟下发摄像头任务 + webhook 异步回调 + media URL → MediaFetcher 拉到阿里云 OSS → T+K+M 后 RetrospectiveAgent 自动复盘 → D 角色看到二轴矩阵 + 案例库。

**Architecture:** 复用 m2 modular monolith。**所有变化都是把 stub 换成真实组件**,不重构。新增 6 类组件:(1) **V/T 警务分类 seed**(C-1..C-5 全覆盖);(2) **WebhookIngest** 公网入口子模块(同 process,不同 path,签名验证 + 持久信封队列);(3) **SimulatedGuangzhouPoliceCamAdapter**(取代 MockCameraAdapter,完整状态机 + 真 webhook 回调 + 模拟 media URL);(4) **MediaFetcher → 阿里云 OSS** 真接入;(5) **BullMQ workers** 真挂(cadence + agent_full + dispatch + retrospective);(6) **RetrospectiveAgent** + 二轴 outcome + case library 升级;(7) **D 角色 ReviewerView** + Outcome Matrix。

**Tech Stack:** 全栈复用 m1+m2;新增 `ali-oss` SDK + 公网 webhook endpoint。

**Source Spec:** [`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`](../specs/2026-05-05-camera-news-prediction-design.md)(commit `72b1868`)

**Slice Position:** **Plan-C of A/B/C 三段**(B 路径垂直切片优先);本计划 = m3(5 周窗口,v1 最终里程碑)。前置 = Plan-B(m2 已完工,commit `bcb68e4`)。后续 = m4-m6(横向加宽:RSS/政务/社交/外文 + AD_HOC→ADMIN_NAMED 晋升 + 多 adapter 真接入)。

**Spec ISC 覆盖(本计划):** ISC-14 / ISC-16 / ISC-17 / ISC-18 / ISC-19 / ISC-26 / ISC-27 / ISC-28 / ISC-29 / ISC-S0-3 / ISC-S0-4

**EX 决策已锁(全部解决):**

| ID | 决策 |
|---|---|
| EX-1 | V = 警务车辆(C-1 治安 / C-2 交警 / C-3 刑侦 / C-4 综治 / C-5 城管 全 5 子类);T = 对应 5 任务子类;R = 广东省签约,Slice 0 第一切片 = 广州市 |
| EX-2 | 客户既有 + API 双方共建;双向(POST + webhook);**API key 鉴权**(简单打通,合规留 m4);URL 拉取媒体 |
| EX-3 | 多通道 adapter:m3 信源种子选 RSS(广东省公安厅 + 广州公安官网 + 主流党媒)+ Bing News 关键词 |
| EX-4 | 阿里云 dashscope 已配置 |
| EX-5 | **建议本期获取 AMAP Geocode key**(广州内部地理化必要;rule fallback 在城市级会大量误匹配)— 客户/项目侧申请 |

**新增外部依赖(Plan-C 启动前):**

| ID | 内容 | 阻塞 task |
|---|---|---|
| **EX-6** | 阿里云 OSS bucket + AccessKey(写权限) | Task 14-15(MediaFetcher) |
| **EX-7** | 公网域名 + 证书(WebhookIngest 公网入口) | Task 6 真上线;开发期 ngrok / cpolar 代理可用 |
| **EX-8** | 客户 backend API key(给 SimulatedGuangzhou 模拟用,客户可任填一个) | Task 9 |

---

## File Structure(本计划新增/修改)

```
排班系统设计-superpowers/
├── package.json                           # 加 ali-oss
├── .env.example                           # 加 OSS_*/WEBHOOK_*/SIMULATED_GZP_*
│
├── src/
│   ├── server.ts                          # 改:挂 /webhook/* 路由 + /retrospectives
│   ├── env.ts                             # 改:加 OSS / Webhook / Simulated env
│   │
│   ├── db/schema/
│   │   ├── retrospective.ts               # 新:retrospectives + case_library + outcome enum
│   │   └── webhook.ts                     # 新:webhook_envelopes(持久信封)
│   │
│   ├── seeds/
│   │   └── police-taxonomy.ts             # 新:V/T 警务分类(C-1..C-5)初版 seed CLI
│   │
│   ├── webhook/                           # 新模块
│   │   ├── ingest.ts                      # WebhookIngest 主流程
│   │   ├── envelope.ts                    # 持久信封读写 + 重试调度
│   │   ├── signature.ts                   # HMAC-SHA256 签名验证
│   │   └── routes.ts                      # /webhook/:adapterKey 路由
│   │
│   ├── dispatch/
│   │   ├── adapters/
│   │   │   ├── mock.ts                    # 保留(测试用)
│   │   │   └── simulated-gzp.ts           # 新:SimulatedGuangzhouPoliceCamAdapter
│   │   ├── state-machine.ts               # 新:DispatchTask 完整状态转移
│   │   └── service.ts                     # 改:加 cancel 完整链路 + state advance
│   │
│   ├── media/
│   │   ├── oss-client.ts                  # 新:阿里云 OSS 包装(put/getStream)
│   │   ├── fetcher.ts                     # 新:URL → OSS 拉取
│   │   └── retention.ts                   # 新:retentionUntil 计算 + scan_status 流水
│   │
│   ├── scheduler/
│   │   ├── workers.ts                     # 改:真挂 4 类 worker
│   │   ├── workers/
│   │   │   ├── cadence.ts                 # 新:scan predictions → 投 INCR job
│   │   │   ├── refresh.ts                 # 新:消费 refresh queue → runPredictionAgent
│   │   │   ├── full-recalc.ts             # 新:消费 full-recalc → P1-P5 + run FULL
│   │   │   ├── dispatch.ts                # 新:消费 dispatch queue → adapter.dispatch
│   │   │   └── retrospective.ts           # 新:扫 T+K+M 到期 → run RetrospectiveAgent
│   │   └── triggers/
│   │       └── post-approval.ts           # 新:approve hook 自动 enqueue dispatch
│   │
│   ├── inference/prompts/
│   │   └── retrospective-agent.ts         # 改:m2 stub 升级为完整 prompt + zod
│   │
│   ├── agents/
│   │   ├── retrospective-agent.ts         # 新:编排(news + capture + notes → 4 件套)
│   │   └── case-retriever.ts              # 改:从 retrospective 真 outcome 取代 status proxy
│   │
│   └── modules/
│       ├── prediction/routes.ts           # 改:/cancel 完整路由
│       └── retrospective/                 # 新模块
│           ├── service.ts
│           └── routes.ts
│
├── tests/                                 # 对应所有新增 src 文件的测试
│
└── frontend/src/
    ├── lib/
    │   ├── retrospective-api.ts           # 新
    │   ├── dispatch-api.ts                # 新
    │   └── media-api.ts                   # 新
    │
    ├── components/
    │   ├── OutcomeMatrix.tsx              # 新:3×4 二轴矩阵 grid(2 impossible 格)
    │   ├── PatternHeatmap.tsx             # 新(可选,留 m4)
    │   ├── DispatchPanel.tsx              # 新:在 PredictionDetail 显示调度状态 + media
    │   ├── MediaGallery.tsx               # 新:从 MediaAsset 列表渲染缩略图
    │   ├── RetrospectiveCard.tsx          # 新:单条复盘 4 件套展示
    │   └── CancelButton.tsx               # 新:撤单 + 确认对话框
    │
    └── routes/
        ├── reviewer/
        │   ├── ReviewerView.tsx           # 改:真数据
        │   ├── ReportsTab.tsx             # 新:复盘报告列表
        │   ├── MatrixTab.tsx              # 新:二轴矩阵聚合视图
        │   └── CasesTab.tsx               # 新:案例库浏览 + 检索
        ├── analyst/
        │   ├── NewWatchListModal.tsx      # 新(m2 deferred)
        │   └── NewTaskCardModal.tsx       # 新(m2 deferred)
        └── decision/
            └── DecisionView.tsx           # 改:InboxCard 显示 latest snapshot reasoning
```

---

## Tasks

### Section 1 — V/T Police Taxonomy Seed

#### Task 1: 警务分类 seed CLI(C-1..C-5 全覆盖)

**Files:**
- Create: `src/seeds/police-taxonomy.ts`
- Modify: `package.json` 加 `seed:taxonomy:police` 脚本
- Create: `tests/seeds/police-taxonomy.test.ts`

**Spec ISC:** ISC-7(V/T 二级 + tag)

- [ ] **Step 1: Implement seed CLI**

```ts
// src/seeds/police-taxonomy.ts
import { eq } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { vehicleClasses, taskClasses, vehicleEdgeTags, taskEdgeTags } from '@/db/schema/taxonomy'

type Hierarchy = {
  parent: string
  children: string[]
  tags?: string[]  // EdgeTags
}

const VEHICLE_HIERARCHY: Hierarchy[] = [
  { parent: '警务车辆', children: [
    '治安巡逻车', '交警执法车', '刑侦专项车', '综治巡防车', '城管执法车',
  ], tags: ['指挥车', '便携设备车', '排查车'] },
]

const TASK_HIERARCHY: Hierarchy[] = [
  { parent: '警务执法', children: [
    '街面治安巡逻', '路面交通执法', '专项行动', '综合治理巡查', '城管执法巡查',
  ], tags: ['夜间巡逻', '节假日加强', '常态'] },
]

async function ensureClass(db: any, table: any, name: string, level: 1 | 2, parentId: string | null) {
  const where = parentId === null
    ? eq(table.name, name)
    : eq(table.name, name)  // 简化:同名子类按 parentId 区分,完整版要 AND
  const existing = await db.select().from(table)
    .where(where)
  for (const row of existing) {
    if ((row.level === level) && (row.parentId === parentId)) return row
  }
  const [row] = await db.insert(table).values({ name, level, parentId }).returning()
  return row
}

async function main() {
  const { db, sql } = createDb('admin')
  console.log('[seed:taxonomy:police] start')

  for (const h of VEHICLE_HIERARCHY) {
    const parent = await ensureClass(db, vehicleClasses, h.parent, 1, null)
    for (const child of h.children) {
      const c = await ensureClass(db, vehicleClasses, child, 2, parent.id)
      console.log(`[seed] vehicle ${h.parent} > ${child} (${c.id.slice(0, 8)})`)
      for (const tag of h.tags ?? []) {
        await db.insert(vehicleEdgeTags).values({
          vehicleClassId: c.id, tag,
        }).onConflictDoNothing?.() ?? null
      }
    }
  }
  for (const h of TASK_HIERARCHY) {
    const parent = await ensureClass(db, taskClasses, h.parent, 1, null)
    for (const child of h.children) {
      const c = await ensureClass(db, taskClasses, child, 2, parent.id)
      console.log(`[seed] task ${h.parent} > ${child} (${c.id.slice(0, 8)})`)
      for (const tag of h.tags ?? []) {
        await db.insert(taskEdgeTags).values({ taskClassId: c.id, tag }).onConflictDoNothing?.() ?? null
      }
    }
  }
  console.log('[seed:taxonomy:police] done')
  await sql.end()
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Add to package.json**

```json
"seed:taxonomy:police": "bun src/seeds/police-taxonomy.ts"
```

- [ ] **Step 3: Test fixture-based**

```ts
// tests/seeds/police-taxonomy.test.ts
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'

describe('police taxonomy seed', () => {
  test('seed creates 5 vehicle subclasses + 5 task subclasses (idempotent)', async () => {
    const ctx = await createTestDb()
    const r1 = spawnSync('bun', ['src/seeds/police-taxonomy.ts'], { env: process.env, encoding: 'utf8' })
    expect(r1.status).toBe(0)
    const r2 = spawnSync('bun', ['src/seeds/police-taxonomy.ts'], { env: process.env, encoding: 'utf8' })
    expect(r2.status).toBe(0)  // idempotent

    const vCount = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM vehicle_classes
      WHERE level = 2 AND parent_id IN (SELECT id FROM vehicle_classes WHERE name = '警务车辆')
    `)
    expect((vCount[0] as any).n).toBe(5)
    await ctx.cleanup()
  }, 30000)
})
```

- [ ] **Step 4: Commit**

```bash
git add src/seeds/police-taxonomy.ts package.json tests/seeds/police-taxonomy.test.ts
git commit -m "feat(seed): police V/T taxonomy (C-1..C-5) idempotent CLI"
```

---

### Section 2 — Retrospective + Webhook Schemas

#### Task 2: Retrospective + CaseLibrary schemas

**Files:**
- Create: `src/db/schema/retrospective.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/retrospective.test.ts`

**Spec ISC:** ISC-27(4 件套)/ ISC-28(2 不可能格 CHECK)

- [ ] **Step 1: Implement schema**

```ts
// src/db/schema/retrospective.ts
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { predictions } from './prediction'

export const predictionOutcomeEnum = pgEnum('prediction_outcome', ['HIT', 'MISS', 'NO_DATA'])
export const captureOutcomeEnum = pgEnum('capture_outcome', ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN'])

export const retrospectives = pgTable(
  'retrospectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }).unique(),
    predictionOutcome: predictionOutcomeEnum('prediction_outcome').notNull(),
    captureOutcome: captureOutcomeEnum('capture_outcome').notNull(),
    scoreV: integer('score_v').notNull(),
    scoreR: integer('score_r').notNull(),
    scoreW: integer('score_w').notNull(),
    scoreT: integer('score_t').notNull(),
    composite: integer('composite').notNull(),
    causalMd: text('causal_md').notNull(),
    summaryMd: text('summary_md').notNull(),
    evidenceNewsIds: jsonb('evidence_news_ids').notNull().default(sql`'[]'::jsonb`),
    captureDispatchIds: jsonb('capture_dispatch_ids').notNull().default(sql`'[]'::jsonb`),
    reviewerNotes: text('reviewer_notes'),
    outcomeOverridden: boolean('outcome_overridden').notNull().default(false),
    overriddenReason: text('overridden_reason'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 二轴矩阵 2 个不可能格:CAPTURED 必须对应 HIT
    check('outcome_capture_implies_hit',
      sql`NOT (${t.captureOutcome} = 'CAPTURED' AND ${t.predictionOutcome} <> 'HIT')`),
    check('scores_in_range',
      sql`${t.scoreV} BETWEEN 0 AND 100 AND ${t.scoreR} BETWEEN 0 AND 100
          AND ${t.scoreW} BETWEEN 0 AND 100 AND ${t.scoreT} BETWEEN 0 AND 100
          AND ${t.composite} BETWEEN 0 AND 100`),
    check('overridden_requires_reason',
      sql`(${t.outcomeOverridden} = FALSE) OR (${t.overriddenReason} IS NOT NULL)`),
    index('retrospectives_outcome_idx').on(t.predictionOutcome, t.captureOutcome),
    index('retrospectives_generated_idx').on(t.generatedAt),
  ]
)

export const caseLibraryEntries = pgTable(
  'case_library_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retrospectiveId: uuid('retrospective_id').notNull().references(() => retrospectives.id, { onDelete: 'cascade' }).unique(),
    predictionSnapshot: jsonb('prediction_snapshot').notNull(),  // V/T/R/K/conf 快照
    retrievalKeys: jsonb('retrieval_keys').notNull(),
    bm25Blob: text('bm25_blob').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('case_library_bm25_idx').on(t.bm25Blob)]
)

export type Retrospective = typeof retrospectives.$inferSelect
export type CaseLibraryEntry = typeof caseLibraryEntries.$inferSelect
```

- [ ] **Step 2: Add to index**

```ts
export * from './retrospective'
```

- [ ] **Step 3: db:generate + migrate**

- [ ] **Step 4: Test**

测试:
- 插入 HIT/CAPTURED 通过
- MISS/CAPTURED 被 CHECK 拦截
- score 越界拦截
- outcomeOverridden=true 没 reason 拦截

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): retrospectives + case_library_entries with 二轴 outcome CHECK"
```

---

#### Task 3: WebhookEnvelope schema(持久化信封)

**Files:**
- Create: `src/db/schema/webhook.ts`
- Modify: `src/db/schema/index.ts`
- Create: `tests/db/webhook.test.ts`

**Spec ISC:** ISC-15 / ISC-17

- [ ] **Step 1: Schema**

```ts
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const envelopeStatusEnum = pgEnum('envelope_status', ['RECEIVED', 'PROCESSED', 'INVALID_SIG', 'PROCESSING_FAILED'])

export const webhookEnvelopes = pgTable(
  'webhook_envelopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapterKey: text('adapter_key').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sigStatus: text('sig_status').notNull(), // 'OK' | 'INVALID' | 'MISSING'
    rawHeadersJson: jsonb('raw_headers_json').notNull(),
    rawBody: text('raw_body').notNull(),
    status: envelopeStatusEnum('status').notNull().default('RECEIVED'),
    processedDispatchId: uuid('processed_dispatch_id'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('envelope_idem_idx', { unique: true }).on(t.adapterKey, t.idempotencyKey),
    index('envelope_status_idx').on(t.status),
  ]
)

export type WebhookEnvelope = typeof webhookEnvelopes.$inferSelect
```

- [ ] **Step 2-5: same pattern** — index + migrate + test(insert + duplicate idempotency_key blocked) + commit

```bash
git commit -m "feat(db): webhook_envelopes for persistent retry queue"
```

---

### Section 3 — WebhookIngest

#### Task 4: HMAC-SHA256 signature utility

**Files:**
- Create: `src/webhook/signature.ts`
- Create: `tests/webhook/signature.test.ts`

```ts
// src/webhook/signature.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifySignature(rawBody: string, providedHex: string, secret: string): boolean {
  const expected = computeSignature(rawBody, secret)
  if (providedHex.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(providedHex, 'hex'), Buffer.from(expected, 'hex'))
  } catch { return false }
}
```

Tests:
- 同 secret + body → verify true
- 错 secret → false
- 篡改 body → false
- 篡改 sig → false

```bash
git commit -m "feat(webhook): HMAC-SHA256 signature compute + timing-safe verify"
```

---

#### Task 5: WebhookEnvelope service(持久信封 read/write/retry)

**Files:**
- Create: `src/webhook/envelope.ts`
- Create: `tests/webhook/envelope.test.ts`

```ts
// src/webhook/envelope.ts
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { webhookEnvelopes } from '@/db/schema/webhook'

export type IngestEnvelope = {
  adapterKey: string
  idempotencyKey: string
  sigStatus: 'OK' | 'INVALID' | 'MISSING'
  rawHeaders: Record<string, string>
  rawBody: string
}

export async function persistEnvelope(db: Db, e: IngestEnvelope): Promise<{ id: string; isDuplicate: boolean }> {
  // 通过唯一索引 (adapterKey, idempotencyKey) 实现幂等
  const result = await db.insert(webhookEnvelopes).values({
    adapterKey: e.adapterKey,
    idempotencyKey: e.idempotencyKey,
    sigStatus: e.sigStatus,
    rawHeadersJson: e.rawHeaders,
    rawBody: e.rawBody,
  }).onConflictDoNothing().returning()
  if (result.length === 0) {
    const [existing] = await db.select().from(webhookEnvelopes)
      .where(eq(webhookEnvelopes.idempotencyKey, e.idempotencyKey))
    return { id: existing!.id, isDuplicate: true }
  }
  return { id: result[0]!.id, isDuplicate: false }
}

export async function markProcessed(db: Db, envelopeId: string, dispatchId: string) {
  await db.update(webhookEnvelopes).set({
    status: 'PROCESSED', processedDispatchId: dispatchId, processedAt: new Date(),
  }).where(eq(webhookEnvelopes.id, envelopeId))
}

export async function markFailed(db: Db, envelopeId: string, err: string) {
  await db.update(webhookEnvelopes).set({
    status: 'PROCESSING_FAILED', error: err,
  }).where(eq(webhookEnvelopes.id, envelopeId))
}
```

Tests: insert / duplicate idempotency / markProcessed / markFailed.

```bash
git commit -m "feat(webhook): envelope persistence + idempotent insert + status updates"
```

---

#### Task 6: WebhookIngest 路由 + Hono mount

**Files:**
- Create: `src/webhook/ingest.ts`
- Create: `src/webhook/routes.ts`
- Modify: `src/server.ts` 挂 /webhook/*
- Modify: `tests/helpers/test-server.ts`
- Create: `tests/webhook/routes.test.ts`

```ts
// src/webhook/ingest.ts
import type { Db } from '@/db/client'
import { getAdapter } from '@/dispatch/adapter-pool'
import { persistEnvelope } from './envelope'
import { verifySignature } from './signature'

export type IngestRawRequest = {
  adapterKey: string
  rawBody: string
  headers: Record<string, string>
}

export type IngestResult = {
  envelopeId: string
  status: 'PROCESSED' | 'DUPLICATE' | 'INVALID_SIG' | 'INVALID_ADAPTER'
}

export async function processIngest(db: Db, secret: string, req: IngestRawRequest): Promise<IngestResult> {
  let adapter
  try { adapter = getAdapter(req.adapterKey) }
  catch { 
    return { envelopeId: '', status: 'INVALID_ADAPTER' }
  }
  const idempotencyKey = req.headers['x-idempotency-key'] ?? req.headers['X-Idempotency-Key'] ?? `auto-${Date.now()}-${Math.random()}`
  const sig = req.headers['x-signature'] ?? req.headers['X-Signature']
  let sigStatus: 'OK' | 'INVALID' | 'MISSING'
  if (!sig) sigStatus = 'MISSING'
  else if (verifySignature(req.rawBody, sig, secret)) sigStatus = 'OK'
  else sigStatus = 'INVALID'

  const env = await persistEnvelope(db, {
    adapterKey: req.adapterKey, idempotencyKey,
    sigStatus, rawHeaders: req.headers, rawBody: req.rawBody,
  })
  if (env.isDuplicate) return { envelopeId: env.id, status: 'DUPLICATE' }
  if (sigStatus !== 'OK') return { envelopeId: env.id, status: 'INVALID_SIG' }

  // 至此签名 OK + 非重复;真正消费由 dispatch worker 在 Task 13-15 接
  return { envelopeId: env.id, status: 'PROCESSED' }
}
```

```ts
// src/webhook/routes.ts
import { Hono } from 'hono'
import type { Db } from '@/db/client'
import { loadEnv } from '@/env'
import { processIngest } from './ingest'

export function webhookRoutes(db: Db) {
  const app = new Hono()
  app.post('/:adapterKey', async (c) => {
    const env = loadEnv()
    const adapterKey = c.req.param('adapterKey')
    const rawBody = await c.req.text()
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    const r = await processIngest(db, env.WEBHOOK_HMAC_SECRET, { adapterKey, rawBody, headers })
    if (r.status === 'INVALID_ADAPTER') return c.json({ error: 'unknown adapter' }, 404)
    if (r.status === 'INVALID_SIG') return c.json({ error: 'invalid signature' }, 401)
    return c.json({ ok: true, envelopeId: r.envelopeId, status: r.status })
  })
  return app
}
```

Add to `src/env.ts`:
```ts
WEBHOOK_HMAC_SECRET: z.string().min(16).default('dev-secret-32-chars-replace-prod'),
```

Mount `/webhook` in `src/server.ts` and `tests/helpers/test-server.ts`.

Tests:
- POST 合法签名 → 200
- POST 错签名 → 401
- POST 同 idempotency-key 第二次 → 200 + status=DUPLICATE
- POST 未知 adapter → 404

```bash
git commit -m "feat(webhook): public ingest route with sig verify + envelope persist + idempotency"
```

---

### Section 4 — SimulatedGuangzhouPoliceCamAdapter

#### Task 7: Adapter 接口扩展 — 加 webhook 签名生成

**Files:**
- Modify: `src/dispatch/types.ts`(加 `signOutgoing` 方法)
- Modify: `src/dispatch/adapters/mock.ts`

为模拟 backend 主动 POST 我们的 webhook 时,需要"签名外发的请求体"。

```ts
// types.ts 加:
export interface CameraAdapter {
  // ...existing
  /** 模拟 / 测试用:adapter 内部当作 backend 反向签 webhook payload */
  signOutgoing?(rawBody: string): string
}
```

mock.ts 加 stub `signOutgoing` 返回空(测试不会验)。

```bash
git commit -m "feat(dispatch): adapter interface adds signOutgoing for simulated webhooks"
```

---

#### Task 8: SimulatedGuangzhouPoliceCamAdapter 主体

**Files:**
- Create: `src/dispatch/adapters/simulated-gzp.ts`
- Create: `tests/dispatch/simulated-gzp.test.ts`

```ts
// src/dispatch/adapters/simulated-gzp.ts
import { randomUUID } from 'node:crypto'
import { computeSignature } from '@/webhook/signature'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '../types'

export type SimulatedGzpConfig = {
  apiKey: string                    // 客户给 EX-8(测试可任填)
  webhookSecret: string             // 与 WEBHOOK_HMAC_SECRET 一致
  webhookUrl: string                // 自身 webhook ingest URL,默认 http://localhost:3000/webhook/simulated-gzp
  fakeMediaBaseUrl: string          // 模拟 media URL prefix,默认 http://localhost:3000/static/sim-media/
  inProgressDelayMs: number         // 默认 5000(模拟到位时间)
  completedDelayMs: number          // 默认 30000(模拟拍摄时间)
}

/**
 * 模拟广东省警务摄像头 backend。
 * - dispatch() 立即 ack,返回 fake external_id
 * - 在内部 setTimeout 中模拟 IN_PROGRESS / COMPLETED 状态推进,通过反向 POST webhook
 * - 每次 webhook 请求带 HMAC 签名 + idempotency_key
 * - cancel() 接到后 5s 内反向 webhook CANCELLED 状态
 */
export class SimulatedGuangzhouPoliceCamAdapter implements CameraAdapter {
  readonly key = 'simulated-gzp'
  constructor(private cfg: SimulatedGzpConfig) {}

  async dispatch(req: DispatchRequest): Promise<DispatchAck> {
    const externalId = `gzp-${randomUUID()}`
    const acceptedAt = new Date().toISOString()
    setTimeout(() => this.fireProgress(externalId, req.predictionId), this.cfg.inProgressDelayMs)
    setTimeout(() => this.fireCompleted(externalId, req.predictionId), this.cfg.completedDelayMs)
    return { externalId, acceptedAt }
  }

  async cancel(externalId: string, idempotencyKey: string): Promise<CancelAck> {
    setTimeout(() => this.fireCancelled(externalId, idempotencyKey), 5000)
    return { externalId, cancelledAt: new Date().toISOString() }
  }

  async pollStatus(externalId: string): Promise<DispatchStatus> {
    return { externalId, state: 'IN_PROGRESS' }  // m3:status 改由 webhook 推
  }

  signOutgoing(rawBody: string): string {
    return computeSignature(rawBody, this.cfg.webhookSecret)
  }

  private async fireProgress(externalId: string, _predictionId: string) {
    const body = JSON.stringify({ externalId, state: 'IN_PROGRESS', ts: new Date().toISOString() })
    await this.postWebhook(body, `progress-${externalId}`)
  }

  private async fireCompleted(externalId: string, _predictionId: string) {
    const mediaUrls = [
      `${this.cfg.fakeMediaBaseUrl}${externalId}-1.jpg`,
      `${this.cfg.fakeMediaBaseUrl}${externalId}-2.jpg`,
    ]
    const body = JSON.stringify({
      externalId, state: 'COMPLETED', mediaUrls,
      capturedAt: new Date().toISOString(),
      meta: { vehicleType: 'detected', trackingPath: [[113.27, 23.13], [113.28, 23.14]] },
    })
    await this.postWebhook(body, `completed-${externalId}`)
  }

  private async fireCancelled(externalId: string, originalIdem: string) {
    const body = JSON.stringify({ externalId, state: 'CANCELLED', ts: new Date().toISOString() })
    await this.postWebhook(body, `cancelled-${externalId}-${originalIdem}`)
  }

  private async postWebhook(body: string, idempotencyKey: string) {
    const signature = this.signOutgoing(body)
    try {
      await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Idempotency-Key': idempotencyKey,
          'X-Adapter-Key': this.key,
        },
        body,
      })
    } catch (e) {
      console.error(`[simulated-gzp] webhook post failed:`, (e as Error).message)
    }
  }
}
```

Tests:用 `globalThis.fetch` swap 验证:
- dispatch() 返回 `gzp-` 前缀 external_id
- 5s 后 IN_PROGRESS webhook 触发
- 30s 后 COMPLETED webhook + mediaUrls
- cancel() 触发 5s 后 CANCELLED webhook

> 测试用 `inProgressDelayMs: 50` / `completedDelayMs: 100` 加速。

```bash
git commit -m "feat(dispatch): SimulatedGuangzhouPoliceCamAdapter with webhook callbacks + signed payloads"
```

---

#### Task 9: Adapter pool register simulated + env-driven

**Files:**
- Modify: `src/dispatch/adapter-pool.ts`
- Modify: `src/env.ts` 加 `SIMULATED_GZP_*`
- Modify: `.env.example`

`adapter-pool.ts` 改:依赖 env 决定是否注册 simulated adapter(测试中可禁用以避免后台 setTimeout 干扰)。

```ts
// 加:
import { SimulatedGuangzhouPoliceCamAdapter } from './adapters/simulated-gzp'
import { loadEnv } from '@/env'

// 末尾改成:
const env = loadEnv()
if (env.SIMULATED_GZP_ENABLED === 'true') {
  registerAdapter(new SimulatedGuangzhouPoliceCamAdapter({
    apiKey: env.SIMULATED_GZP_API_KEY,
    webhookSecret: env.WEBHOOK_HMAC_SECRET,
    webhookUrl: env.SIMULATED_GZP_WEBHOOK_URL,
    fakeMediaBaseUrl: env.SIMULATED_GZP_FAKE_MEDIA_BASE,
    inProgressDelayMs: 5000,
    completedDelayMs: 30000,
  }))
}
```

Env additions:
```
SIMULATED_GZP_ENABLED=false
SIMULATED_GZP_API_KEY=test-key
SIMULATED_GZP_WEBHOOK_URL=http://localhost:3000/webhook/simulated-gzp
SIMULATED_GZP_FAKE_MEDIA_BASE=http://localhost:3000/static/sim-media/
```

`.env`(本地)切到 `SIMULATED_GZP_ENABLED=true` 即上线。

```bash
git commit -m "feat(dispatch): env-driven simulated-gzp registration"
```

---

### Section 5 — MediaFetcher + 阿里云 OSS

#### Task 10: 阿里云 OSS client 包装

**Files:**
- Modify: `package.json` 加 `ali-oss`
- Modify: `src/env.ts` 加 OSS env
- Create: `src/media/oss-client.ts`
- Create: `tests/media/oss-client.test.ts`

```bash
bun add ali-oss@^6
bun add -d @types/ali-oss
```

```ts
// src/media/oss-client.ts
import OSS from 'ali-oss'
import { loadEnv } from '@/env'

let _client: OSS | null = null

export function getOssClient(): OSS {
  if (_client) return _client
  const env = loadEnv()
  if (!env.OSS_ENDPOINT || !env.OSS_ACCESS_KEY_ID) {
    throw new Error('OSS not configured; set OSS_ENDPOINT/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET/OSS_BUCKET')
  }
  _client = new OSS({
    endpoint: env.OSS_ENDPOINT,
    accessKeyId: env.OSS_ACCESS_KEY_ID,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    bucket: env.OSS_BUCKET,
  })
  return _client
}

export async function putObject(key: string, body: Buffer | NodeJS.ReadableStream): Promise<{ uri: string }> {
  const client = getOssClient()
  await client.put(key, body as any)
  const env = loadEnv()
  return { uri: `oss://${env.OSS_BUCKET}/${key}` }
}

export async function getSignedUrl(key: string, ttlSeconds = 3600): Promise<string> {
  const client = getOssClient()
  return client.signatureUrl(key, { expires: ttlSeconds })
}
```

Env additions:
```
OSS_ENDPOINT=https://oss-cn-shenzhen.aliyuncs.com
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=cnp-media-dev
```

Test: 跳过(需真 OSS),只验证 client 抛错 when env 缺失。

```bash
git commit -m "feat(media): ali-oss client wrapper"
```

---

#### Task 11: MediaFetcher

**Files:**
- Create: `src/media/fetcher.ts`
- Create: `src/media/retention.ts`
- Create: `tests/media/fetcher.test.ts`

```ts
// src/media/fetcher.ts
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { mediaAssets, type MediaAsset } from '@/db/schema/dispatch'
import { putObject } from './oss-client'

export type FetchTask = {
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}

export async function fetchAndPersist(db: Db, t: FetchTask): Promise<MediaAsset> {
  const res = await fetch(t.sourceUrl)
  if (!res.ok) throw new Error(`fetch ${t.sourceUrl} → ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const ext = t.mediaType === 'video' ? 'mp4' : (t.mediaType === 'image' ? 'jpg' : 'json')
  const key = `media/${t.dispatchId}/${sha256.slice(0, 12)}.${ext}`
  const { uri } = await putObject(key, buffer)
  const retentionUntil = new Date(Date.now() + 365 * 86400_000)
  const [row] = await db.insert(mediaAssets).values({
    dispatchId: t.dispatchId,
    ossUri: uri, sourceUrl: t.sourceUrl, mediaType: t.mediaType,
    sizeBytes: buffer.byteLength, sha256,
    scanStatus: 'OK',
    retentionUntil,
  }).returning()
  return row!
}
```

Tests with `globalThis.fetch` swap + mocked OSS client(`ali-oss` 太重,测试用 `mock.module` 替换 `getOssClient`)。

```bash
git commit -m "feat(media): MediaFetcher → URL → buffer → OSS → MediaAsset row"
```

---

#### Task 12: Static dev server for fake media URLs

**Files:**
- Modify: `src/server.ts` 加 `app.get('/static/sim-media/:filename', ...)` 路由

提供一个本地静态 endpoint,模拟 `SimulatedGuangzhouPoliceCamAdapter` 返回的 mediaUrls 实际可下载。返回 placeholder JPG 字节(可以是 1x1 像素 jpg base64)。

```ts
// src/server.ts 内加
const PLACEHOLDER_JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAA//9k=',
  'base64'
)

app.get('/static/sim-media/:filename', (c) => {
  c.header('Content-Type', 'image/jpeg')
  return c.body(PLACEHOLDER_JPG)
})
```

```bash
git commit -m "feat(server): static dev endpoint for simulated media URLs"
```

---

### Section 6 — BullMQ Workers Live

#### Task 13: refresh worker(消费 INCR/FULL job)

**Files:**
- Create: `src/scheduler/workers/refresh.ts`
- Modify: `src/scheduler/workers.ts` 注册

```ts
// src/scheduler/workers/refresh.ts
import { Worker } from 'bullmq'
import { loadEnv } from '@/env'
import { createDb } from '@/db/client'
import { runPredictionAgent } from '@/agents/prediction-agent'

export function createRefreshWorker() {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<{ predictionId: string; kind: 'INCR' | 'FULL'; newEvidenceNewsIds?: string[] }>(
    'refresh',
    async (job) => {
      const opts: any = { predictionId: job.data.predictionId, kind: job.data.kind }
      if (job.data.newEvidenceNewsIds) opts.newEvidenceNewsIds = job.data.newEvidenceNewsIds
      const out = await runPredictionAgent(db, opts)
      return { confidence: out.confidence }
    },
    { connection: { url: env.REDIS_URL } },
  )
}
```

测试用 BullMQ Worker 集成 + Redis 真连(如测试环境无 Redis,skip)。

```bash
git commit -m "feat(workers): refresh worker — runs PredictionAgent on queue jobs"
```

---

#### Task 14: cadence cron worker

**Files:**
- Create: `src/scheduler/workers/cadence.ts`

定时扫表(每分钟)→ 找当前 cadence 到期的 PROPOSED 预测 → 投 INCR job 到 refresh queue。

```ts
import { sql } from 'drizzle-orm'
import { Job, Queue } from 'bullmq'
import { loadEnv } from '@/env'
import { createDb } from '@/db/client'
import { refreshQueue } from '../queue'

export async function tickCadence() {
  const { db } = createDb('admin')
  // Find PROPOSED predictions where lastIncrAt + cadenceMinutes < NOW() (or never run)
  const due = await db.execute<{ id: string }>(sql`
    SELECT id FROM predictions
    WHERE status = 'PROPOSED'
      AND expires_at > NOW()
      AND (last_incr_at IS NULL
           OR last_incr_at + (cadence_minutes * INTERVAL '1 minute') < NOW())
    LIMIT 100
  `)
  for (const row of due as Array<{ id: string }>) {
    await refreshQueue.add('incr', { predictionId: row.id, kind: 'INCR' })
  }
  return due.length
}

export function scheduleCadenceTick(intervalMs = 60_000) {
  return setInterval(() => { tickCadence().catch(console.error) }, intervalMs)
}
```

测试:插入一条 PROPOSED 预测 lastIncrAt=null → 调用 tickCadence → refreshQueue 应有 1 个 job。

```bash
git commit -m "feat(workers): cadence tick — enqueue INCR jobs for due predictions"
```

---

#### Task 15: full-recalc worker(P1-P5 evaluator → FULL kind)

```ts
// src/scheduler/workers/full-recalc.ts
import { Worker } from 'bullmq'
import { loadEnv } from '@/env'
import { createDb } from '@/db/client'
import { shouldTriggerFull } from '../full-trigger'
import { refreshQueue } from '../queue'

export function createFullRecalcWorker() {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<{ predictionId: string; manualTrigger?: boolean }>(
    'full-recalc',
    async (job) => {
      const trigger = await shouldTriggerFull(db, job.data.predictionId, {
        manualTrigger: job.data.manualTrigger ?? false,
      })
      if (trigger.triggered) {
        await refreshQueue.add('full', { predictionId: job.data.predictionId, kind: 'FULL' })
      }
      return trigger
    },
    { connection: { url: env.REDIS_URL } },
  )
}
```

```bash
git commit -m "feat(workers): full-recalc worker — P1-P5 evaluator → FULL job"
```

---

#### Task 16: dispatch worker + post-approval trigger

**Files:**
- Create: `src/scheduler/workers/dispatch.ts`
- Create: `src/scheduler/triggers/post-approval.ts`
- Modify: `src/modules/prediction/routes.ts` 在 approve 后调用 trigger

```ts
// src/scheduler/triggers/post-approval.ts
import { dispatchQueue } from '../queue'

export async function triggerDispatchAfterApproval(predictionId: string, adapterKey: string = 'simulated-gzp') {
  await dispatchQueue.add('dispatch', { predictionId, adapterKey })
}
```

```ts
// src/scheduler/workers/dispatch.ts
import { Worker } from 'bullmq'
import { loadEnv } from '@/env'
import { createDb } from '@/db/client'
import { enqueueDispatch } from '@/dispatch/service'

export function createDispatchWorker() {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<{ predictionId: string; adapterKey: string }>(
    'dispatch',
    async (job) => {
      const task = await enqueueDispatch(db, {
        predictionId: job.data.predictionId,
        adapterKey: job.data.adapterKey,
      })
      return { dispatchId: task.id, externalId: task.externalId }
    },
    { connection: { url: env.REDIS_URL } },
  )
}
```

修改 `src/modules/prediction/routes.ts` 的 approve 路由,在 transitionStatus 后调 `triggerDispatchAfterApproval`。

```bash
git commit -m "feat(workers): dispatch worker + post-approval trigger wires approve→dispatch"
```

---

### Section 7 — Webhook → Dispatch State Machine

#### Task 17: Dispatch state-machine 完整版

**Files:**
- Create: `src/dispatch/state-machine.ts`
- Modify: `src/dispatch/service.ts` 加 `advanceFromWebhook`
- Create: `tests/dispatch/state-machine.test.ts`

```ts
// src/dispatch/state-machine.ts
export type DispatchState = 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
                          | 'REJECTED_BY_ADAPTER' | 'CANCEL_PENDING' | 'CANCELLED' | 'TIMED_OUT'

const TRANSITIONS: Record<DispatchState, DispatchState[]> = {
  QUEUED: ['SENT', 'REJECTED_BY_ADAPTER', 'CANCEL_PENDING', 'TIMED_OUT'],
  SENT: ['IN_PROGRESS', 'FAILED', 'CANCEL_PENDING', 'TIMED_OUT', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCEL_PENDING', 'TIMED_OUT'],
  CANCEL_PENDING: ['CANCELLED', 'TIMED_OUT'],
  COMPLETED: [], FAILED: [], REJECTED_BY_ADAPTER: [],
  CANCELLED: [], TIMED_OUT: [],
}

export function canTransition(from: DispatchState, to: DispatchState): boolean {
  return TRANSITIONS[from].includes(to)
}
```

```ts
// service.ts 加:
export async function advanceFromWebhook(db: Db, params: {
  externalId: string; adapterKey: string;
  newState: DispatchState; payload?: object; mediaUrls?: string[];
}): Promise<DispatchTask> {
  const [task] = await db.select().from(dispatchTasks).where(
    and(eq(dispatchTasks.adapterKey, params.adapterKey), eq(dispatchTasks.externalId, params.externalId)))
  if (!task) throw new Error(`unknown dispatch ${params.adapterKey}/${params.externalId}`)
  if (!canTransition(task.state as DispatchState, params.newState)) {
    throw new Error(`invalid transition ${task.state} → ${params.newState}`)
  }
  // Update state
  const updates: any = { state: params.newState, updatedAt: new Date() }
  if (params.newState === 'IN_PROGRESS') updates.callbackAt = new Date()
  if (params.newState === 'COMPLETED' || params.newState === 'FAILED') updates.completedAt = new Date()
  const [updated] = await db.update(dispatchTasks).set(updates).where(eq(dispatchTasks.id, task.id)).returning()
  // If COMPLETED + payload, write dispatch_results + enqueue media fetch
  if (params.newState === 'COMPLETED' && params.payload) {
    await db.insert(dispatchResults).values({ dispatchId: task.id, payloadJson: params.payload as object, capturedAt: new Date() })
    // Note: media fetch enqueue 由 webhook ingest 触发,不在此函数 — 简化职责
  }
  return updated!
}
```

Tests:
- canTransition QUEUED→SENT true
- canTransition SENT→QUEUED false
- advanceFromWebhook 写状态成功
- 非法转移抛错

```bash
git commit -m "feat(dispatch): full state-machine + advanceFromWebhook"
```

---

#### Task 18: Webhook → Dispatch advance(连接 ingest 与 state machine)

**Files:**
- Modify: `src/webhook/ingest.ts`(成功签名后,根据 payload state 调用 advanceFromWebhook + media fetch enqueue)
- Modify: `tests/webhook/routes.test.ts` 加 e2e 测试

webhook ingest 处理 OK 信封后,解析 body,根据 state 调用 advanceFromWebhook + 投 media-fetch job(如有 mediaUrls)。

```ts
// 在 processIngest 末尾加:
if (sigStatus === 'OK') {
  try {
    const parsed = JSON.parse(req.rawBody) as { externalId: string; state: string; mediaUrls?: string[]; meta?: object }
    await advanceFromWebhook(db, {
      adapterKey: req.adapterKey, externalId: parsed.externalId,
      newState: parsed.state as DispatchState,
      ...(parsed.meta ? { payload: parsed.meta } : {}),
    })
    // Enqueue media fetch
    if (parsed.mediaUrls && parsed.mediaUrls.length > 0) {
      const dispatchId = (await db.select().from(dispatchTasks).where(...)).pop().id
      for (const url of parsed.mediaUrls) {
        await mediaFetchQueue.add('fetch', { dispatchId, sourceUrl: url, mediaType: 'image' })
      }
    }
    await markProcessed(db, env.envelopeId, dispatchId)
  } catch (e) {
    await markFailed(db, env.envelopeId, (e as Error).message)
  }
}
```

(具体实现稍微整理,确保事务性 + idempotency。)

Add `mediaFetchQueue` to `src/scheduler/queue.ts`.

```bash
git commit -m "feat(webhook): connect ingest → dispatch state machine + media fetch enqueue"
```

---

#### Task 19: media-fetch worker

```ts
// src/scheduler/workers/media-fetch.ts
import { Worker } from 'bullmq'
import { loadEnv } from '@/env'
import { createDb } from '@/db/client'
import { fetchAndPersist } from '@/media/fetcher'

export function createMediaFetchWorker() {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<{ dispatchId: string; sourceUrl: string; mediaType: 'image' | 'video' | 'metadata' }>(
    'media-fetch',
    async (job) => fetchAndPersist(db, job.data),
    { connection: { url: env.REDIS_URL } },
  )
}
```

```bash
git commit -m "feat(workers): media-fetch worker — pulls URL → OSS → MediaAsset"
```

---

### Section 8 — RetrospectiveAgent + 二轴 outcome

#### Task 20: RetrospectiveAgent prompt + zod schema

**Files:**
- Create: `src/inference/prompts/retrospective-agent.ts`
- Create: `tests/inference/retrospective-prompt.test.ts`

```ts
import { z } from 'zod'

export const RETROSPECTIVE_SYSTEM = `
你是一个新闻情报复盘 Agent,任务是基于一条预测 + 关联的新闻 + 摄像头实拍数据 + 分析师备注,
评估这条预测在事后的真实情况。

输出 JSON,包含两轴 outcome:
- prediction_outcome: 'HIT' | 'MISS' | 'NO_DATA'
  HIT — 新闻或实拍至少一方证实预测的出动确实发生
  MISS — 新闻反证 / 全无证据且综合判定未发生
  NO_DATA — 证据不足以判定
- capture_outcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  CAPTURED — dispatch 成功且摄像头回传有目标 metadata
  NOT_CAPTURED — dispatch 完成但没拍到目标
  NOT_DISPATCHED — 该预测从未被批准
  UNKNOWN — adapter 失败 / 状态不明

约束:CAPTURED 必须对应 prediction_outcome=HIT。

四维匹配分(0-100):
- score_v / score_r / score_w / score_t:车类 / 区域 / 时段 / 任务 各自匹配度
- composite: 平均

字段:
- causal_md: markdown,1-3 段,关键证据 + 误判信源 + 漏读信号
- summary_md: 30 秒可读简报
- evidence_news_ids: 引用的 news.id
- key_signals: 决定性短语 ≤ 30 字

不要输出 markdown 围栏。
`.trim()

export type RetrospectiveInput = {
  prediction: { id: string; vehicleClass: string; taskClass: string; region: { name: string }; windowDate: string; windowHalf: 'AM' | 'PM'; confidenceFinal: number }
  news: Array<{ id: string; sourceLabel: string; sourceKind: string; title: string; summary: string; publishedAt?: string }>
  capture: Array<{ dispatchId: string; state: string; mediaCount: number; metadata?: object }>
  reviewerNotes?: string
}

export const RetrospectiveOutputSchema = z.object({
  prediction_outcome: z.enum(['HIT', 'MISS', 'NO_DATA']),
  capture_outcome: z.enum(['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN']),
  score_v: z.number().int().min(0).max(100),
  score_r: z.number().int().min(0).max(100),
  score_w: z.number().int().min(0).max(100),
  score_t: z.number().int().min(0).max(100),
  composite: z.number().int().min(0).max(100),
  causal_md: z.string().min(20),
  summary_md: z.string().min(10),
  evidence_news_ids: z.array(z.string()),
  key_signals: z.array(z.string().max(60)),
}).refine(o => !(o.capture_outcome === 'CAPTURED' && o.prediction_outcome !== 'HIT'),
  { message: 'CAPTURED implies prediction_outcome=HIT' })

export function renderRetrospectiveUserMsg(input: RetrospectiveInput): string {
  // 类似 PredictionAgent renderer,组装 prompt body
  // ...
  return `预测 ${input.prediction.id} ...` // 完整版略,参考 prediction-agent.ts 风格
}
```

Tests:渲染 + schema parse + CHECK 拒绝 CAPTURED+MISS 组合。

```bash
git commit -m "feat(inference): RetrospectiveAgent prompt + zod schema with 二轴 + CHECK"
```

---

#### Task 21: RetrospectiveAgent orchestration

**Files:**
- Create: `src/agents/retrospective-agent.ts`
- Create: `tests/agents/retrospective-agent.test.ts`

```ts
// 编排:load prediction + news (T+K±2 days) + dispatch_results + reviewer_notes
//      → renderRetrospectiveUserMsg → infer → extractJson → zod parse
//      → 写 retrospectives 表 + case_library_entry
```

形态完全参照 m2 Task 8(PredictionAgent orchestration),用 DI mock 测。

```bash
git commit -m "feat(agents): RetrospectiveAgent orchestration — 4-piece + case library entry"
```

---

#### Task 22: Retrospective scheduler worker

**Files:**
- Create: `src/scheduler/workers/retrospective.ts`

每 5 分钟扫:`status IN (COMPLETED, EXPIRED) AND retrospectives 不存在 AND windowDate + M_default(7) < NOW()` → 投 retrospective job。

```ts
export async function tickRetrospective() {
  const { db } = createDb('admin')
  const due = await db.execute<{ id: string }>(sql`
    SELECT p.id FROM predictions p
    LEFT JOIN retrospectives r ON r.prediction_id = p.id
    WHERE p.status IN ('COMPLETED', 'EXPIRED')
      AND r.id IS NULL
      AND p.window_date + INTERVAL '7 days' < NOW()
    LIMIT 50
  `)
  for (const row of due as Array<{ id: string }>) {
    await retrospectiveQueue.add('retro', { predictionId: row.id })
  }
  return due.length
}
```

`retrospectiveQueue` 加到 `src/scheduler/queue.ts`。

```bash
git commit -m "feat(workers): retrospective tick — find due predictions + enqueue"
```

---

#### Task 23: Retrospective routes(GET / D-override)

**Files:**
- Create: `src/modules/retrospective/service.ts`
- Create: `src/modules/retrospective/routes.ts`
- Modify: `src/server.ts` 挂 /retrospectives
- Create: `tests/modules/retrospective.test.ts`

Routes:
- `GET /retrospectives?status=...` 列表
- `GET /retrospectives/:id` 详情
- `POST /retrospectives/:id/override`(REVIEWER 角色,改 outcome,必填 reason → audit log + outcomeOverridden=true)

```bash
git commit -m "feat(retrospective): list/get/override service + routes"
```

---

### Section 9 — 撤单完整链路

#### Task 24: Cancel routes + state transitions

**Files:**
- Modify: `src/dispatch/service.ts` 已有 `requestCancel` from m2,需要升级走 webhook 真撤单
- Modify: `src/modules/prediction/routes.ts` 加 `POST /predictions/:id/cancel`
- Create: `tests/dispatch/cancel-flow.test.ts`

Cancel 完整路径:
1. POST /predictions/:id/cancel → 找该 prediction 关联的 active dispatch (state in QUEUED/SENT/IN_PROGRESS)
2. 调用 `requestCancel(db, dispatchId, reason)` → CANCEL_PENDING + adapter.cancel()
3. SimulatedGuangzhouPoliceCamAdapter 5s 后 webhook CANCELLED → ingest 路径推进 state to CANCELLED
4. UI 实时更新

```bash
git commit -m "feat(cancel): full cancellation flow — analyst trigger → adapter → webhook → CANCELLED"
```

---

### Section 10 — Frontend §1: API + 业务组件

#### Task 25: 三个新 API client

**Files:**
- Create: `frontend/src/lib/retrospective-api.ts`
- Create: `frontend/src/lib/dispatch-api.ts`
- Create: `frontend/src/lib/media-api.ts`

```bash
git commit -m "feat(frontend): API clients for retrospective / dispatch / media"
```

---

#### Task 26: OutcomeMatrix component(3×4 grid + 2 impossible 格)

**Files:**
- Create: `frontend/src/components/OutcomeMatrix.tsx`

布局参照原型 `view-decision-reviewer.jsx`(reviewer 部分)的 `.matrix` class 用法。

```tsx
const PREDICTION_OUTCOMES = ['HIT', 'MISS', 'NO_DATA'] as const
const CAPTURE_OUTCOMES = ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN'] as const

// 12 cells; 2 impossible: MISS+CAPTURED, NO_DATA+CAPTURED
const IMPOSSIBLE = new Set(['MISS+CAPTURED', 'NO_DATA+CAPTURED'])

export function OutcomeMatrix({ counts, onCellClick }: {
  counts: Record<string, number>  // key = `${pOutcome}+${cOutcome}`
  onCellClick?: (key: string) => void
}) {
  return (
    <div className="matrix" style={{ gridTemplateColumns: '120px repeat(4, 1fr)' }}>
      <div className="matrix__cell matrix__cell--head">P\C</div>
      {CAPTURE_OUTCOMES.map(co => <div key={co} className="matrix__cell matrix__cell--head">{co}</div>)}
      {PREDICTION_OUTCOMES.map(po => (
        <>
          <div key={po} className="matrix__cell matrix__cell--head">{po}</div>
          {CAPTURE_OUTCOMES.map(co => {
            const k = `${po}+${co}`
            const isImpossible = IMPOSSIBLE.has(k)
            return (
              <div key={k}
                className={`matrix__cell ${isImpossible ? 'matrix__cell--impossible' : ''}`}
                onClick={!isImpossible ? () => onCellClick?.(k) : undefined}
                style={{ cursor: isImpossible ? 'default' : 'pointer' }}>
                {isImpossible ? '不可能' : (
                  <>
                    <div style={{ fontSize: 22, fontWeight: 600 }}>{counts[k] ?? 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{po} / {co}</div>
                  </>
                )}
              </div>
            )
          })}
        </>
      ))}
    </div>
  )
}
```

```bash
git commit -m "feat(frontend): OutcomeMatrix component with 2 impossible cells"
```

---

#### Task 27: DispatchPanel + MediaGallery(嵌入 PredictionDetail)

**Files:**
- Create: `frontend/src/components/DispatchPanel.tsx`
- Create: `frontend/src/components/MediaGallery.tsx`
- Modify: `frontend/src/components/PredictionDetail.tsx`(加上这两个 panel)

DispatchPanel 显示:dispatch_tasks 列表 + state 状态徽章 + 撤单按钮(可批准的话)。
MediaGallery 显示:每个 dispatch 关联的 mediaAssets 列表,缩略图(从 OSS signed URL 拉)。

```bash
git commit -m "feat(frontend): DispatchPanel + MediaGallery integrated into PredictionDetail"
```

---

#### Task 28: CancelButton + confirm dialog

**Files:**
- Create: `frontend/src/components/CancelButton.tsx`

撤单按钮 + 确认对话框 + reason 文本框 → POST /predictions/:id/cancel。

```bash
git commit -m "feat(frontend): CancelButton with confirm dialog"
```

---

#### Task 29: RetrospectiveCard

**Files:**
- Create: `frontend/src/components/RetrospectiveCard.tsx`

显示 4 件套:二轴 outcome 双 badge + 四维分 + causal_md(markdown 渲染)+ summary。如 D 角色,显示 override 按钮。

```bash
git commit -m "feat(frontend): RetrospectiveCard with 二轴 badges + 4-dim scores + override action"
```

---

### Section 11 — Frontend §2: ReviewerView 真数据

#### Task 30: ReviewerView 重写 — Reports/Matrix/Cases tabs

**Files:**
- Modify: `frontend/src/routes/reviewer/ReviewerView.tsx`
- Create: `frontend/src/routes/reviewer/ReportsTab.tsx`
- Create: `frontend/src/routes/reviewer/MatrixTab.tsx`
- Create: `frontend/src/routes/reviewer/CasesTab.tsx`

Reports:复盘报告表格(同 PredictionTable 风格)
Matrix:OutcomeMatrix + 总体统计 KPI
Cases:案例库 — 最近 N 条 retro,按 V/T/R 过滤

```bash
git commit -m "feat(reviewer): ReviewerView with Reports/Matrix/Cases tabs"
```

---

### Section 12 — Frontend §3: m2 deferred Modals

#### Task 31: NewWatchListModal

**Files:**
- Create: `frontend/src/routes/analyst/NewWatchListModal.tsx`
- Modify: `frontend/src/routes/analyst/AnalystView.tsx`(挂上 modal)

表单:name + V (dropdown) + T (dropdown) + R (dropdown 命名区域) + K range slider。

```bash
git commit -m "feat(analyst): NewWatchListModal — V/T/R 选择 + 创建监视清单"
```

---

#### Task 32: NewTaskCardModal

**Files:**
- Create: `frontend/src/routes/analyst/NewTaskCardModal.tsx`

表单:name + V/T/R + targetWindowDate + half(AM/PM)。

```bash
git commit -m "feat(analyst): NewTaskCardModal — single-shot 任务卡创建"
```

---

#### Task 33: InboxCard latest reasoning

**Files:**
- Modify: `frontend/src/components/InboxCard.tsx`
- Modify: `frontend/src/routes/decision/DecisionView.tsx`

DecisionView 列表加载时,**额外取每条 prediction 的 latest snapshot**(或者后端 list 返回时加 inline latest snapshot summary)。InboxCard 渲染 reasoning。

(后端可能需要 m2 §6 prediction list 加 `?include=latest_snapshot` 选项,Plan-C 加这个 enhancement。)

```bash
git commit -m "feat(decision): InboxCard shows latest snapshot reasoning"
```

---

### Section 13 — Smoke + Acceptance

#### Task 34: m3 E2E full flow test

**Files:**
- Create: `tests/e2e/m3-full-flow.test.ts`

完整链路:
1. 登录 admin
2. seed police taxonomy
3. 创建 watchlist
4. 直接 INSERT 一条 PROPOSED prediction + 跑 PredictionAgent (mock infer) → confidence
5. approve → 自动 enqueue dispatch → simulated-gzp adapter 接到任务 → fake external_id
6. 等 5s → IN_PROGRESS webhook → state 推进
7. 等 30s → COMPLETED webhook + mediaUrls → state COMPLETED + media-fetch worker 拉到 OSS(mock OSS)
8. 调用 retrospective worker(手动触发不等 7d)→ retro_report 写入,outcome=HIT/CAPTURED
9. 验证 D 角色 GET /retrospectives 看到这条
10. POST override → outcomeOverridden=true

```bash
git commit -m "test(e2e): m3 full flow — seed → predict → approve → dispatch → webhook → media → retro"
```

---

#### Task 35: README m3 增补

包含:新 env、worker 启动方式、demo 脚本、外部依赖状态。

```bash
git commit -m "docs: README m3 section — workers + OSS + webhook + demo"
```

---

#### Task 36: m3 acceptance checklist

```bash
git commit -m "docs(plan-c): m3 acceptance checklist"
```

---

#### Task 37: Slice 0 demo runbook(给客户)

写一份 `docs/demo/slice-0-runbook.md` 给客户演示用:从启动到完整闭环每一步要做什么 + 期望看到什么。

```bash
git commit -m "docs(demo): Slice 0 runbook for customer demo"
```

---

## Self-Review Notes

### Spec coverage

| Spec 区块 | 任务 |
|---|---|
| §3.2 调度网关 (state machine + 撤单) | Task 17 + 24 |
| §3.2 webhook ingest + signature | Task 4-6 |
| §3.2 MediaFetcher + OSS | Task 10-12, 19 |
| §4.1 复盘子系统 (二轴 + 4 件套) | Task 2 + 20-23 |
| §4.1 案例库 with retrospective | Task 21(写)+ §6.case-retriever 升级(可选 followup) |
| §3.1 BullMQ workers 真挂 | Task 13-16, 19, 22 |
| §1.5 Slice 0 端到端 demo | Task 34, 37 |

### Placeholder scan

- 几处 "(完整版略,参考 ...)" 在 Task 20 的 render function — 实施时按 prediction-agent.ts 同样 pattern 写完
- Task 18 webhook → state machine 连接处的具体代码尚需细化(idempotency 在事务里怎么保证)— 实施时 spec reviewer 重点关注

### Type consistency

- `DispatchState` 在 schema enum 与 TS type 用同一字符串集合
- `predictionOutcomeEnum` / `captureOutcomeEnum` 前后端类型一致
- `RetrospectiveOutputSchema` 的 `composite` 是 server 计算还是 LLM 输出?spec 说 LLM 输出可校准,实施保留 LLM 输出但 zod 校验 = avg(4 dim) ± 5 容差

### 已知缺口(留 m4+)

- AD_HOC → ADMIN_NAMED 晋升 UI(K1=做但 m4)
- 撤单的"自动触发"(置信度跌破阈值)— Plan-C Task 24 只做"分析师手动撤单",自动触发逻辑在 m4 加
- 多语言 / 外文 / 社交媒体 SearchAdapter 真实接入(m4)
- BM25 中文分词升级(m4)
- 真 camera adapter 接入(EX-2 客户契约文档到位后,m4 替换 SimulatedGuangzhouPoliceCamAdapter)
- Pulse heartbeat / Pulse 仪表板侧边接入(可选,m5)

---

## Execution Handoff

**Plan-C complete and saved to `docs/superpowers/plans/2026-05-07-m3-real-end-to-end.md`(37 tasks,~5 周工作量)。**

⚠️ **Plan-C 启动前置:**
1. 申请 / 确认 **EX-6**(阿里云 OSS bucket + AccessKey)— Task 10-15 阻塞依赖
2. 准备 **EX-7**(公网 webhook 地址 — 开发期 ngrok / cpolar 即可)
3. **EX-8**(SimulatedGuangzhou 用任意测试 API key 即可)
4. **EX-5**(高德 Geocode key)— 强烈建议本期获取,广州市级地理化必要

执行选项与 Plan-A/B 同:**SUBAGENT-DRIVEN** / **INLINE EXECUTION** / **STOP**。
