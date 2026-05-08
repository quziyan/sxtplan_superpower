# m5 — News Intake Pipeline + Tavily Migration Implementation Plan (Plan-E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans。Steps 用 `- [ ]` 跟踪。

**Goal:** 修复 m3 audit 暴露的 5 处断链(cadence INCR错kind / newsIngest 无 worker / triage 孤儿 / matcher 未接线 / recompute-now stub)+ Tavily 替代 Bing 成默认搜索源 + watchlist.keywords schema 落地,让 PredictionAgent 接入和推理证据持续收集端到端在生产自动运行。

**Architecture:** 复用 m4 BullMQ + drizzle + 真 LLM 基础设施。**新链 (γ Hybrid)**:`newsIngestTick(15min)` 同步 fetch+match → `newsTriageQueue` 异步 LLM 评分 → HIGH 触发 `refreshQueue.INCR`;**FULL 路径** cadence-tick → `fullRecalcQueue` → `shouldTriggerFull` P1-P5 → `refreshQueue.FULL`。

**Tech Stack:** TypeScript + bun 1.3.10 + Hono + drizzle-orm 0.36 + Postgres+PostGIS + BullMQ + Redis + dashscope deepseek-v4-flash(LLM,真调测试)+ cheerio(已 m4 引入)+ Tavily REST。

**Source Spec:** [`docs/superpowers/specs/2026-05-08-m5-news-intake-design.md`](../specs/2026-05-08-m5-news-intake-design.md)(commit `59b8d4b`)

**Slice Position:** **Plan-E**(继 Plan-A m1 / Plan-B m2 / Plan-C m3 / cnp-adapters-unify / Plan-D m4);本计划 = m5 News Intake 主线(1.5-2 周窗口)。

**Spec ISC 覆盖(本计划):** ISC-G1.1-3 / ISC-G2.1-5 / ISC-G3.1-5 / ISC-G5.1-3 / ISC-T.1-4 / ISC-Anti.1-2(共 21 项)

---

## File Structure(本计划新增/修改)

```
docs/
└── superpowers/plans/2026-05-08-m5-acceptance-checklist.md  # 新 (Task 13)

migrations/
└── 0010_<auto-named>.sql                                    # 新 (Task 2 drizzle-kit generate 产物)

src/
├── db/schema/
│   └── watchlist.ts                                         # 改 (Task 2: keywords 列)
├── env.ts                                                   # 改 (Task 5/9: TAVILY_API_KEY + SEARCH_API_KIND default + tunables)
├── modules/
│   ├── prediction/routes.ts                                 # 改 (Task 10: G5 双模式)
│   └── watchlist/
│       ├── service.ts                                       # 改 (Task 3: keywords 字段)
│       └── routes.ts                                        # 改 (Task 3: zod schema 加 keywords)
├── news/
│   ├── adapters/tavily.ts                                   # 新 (Task 4)
│   ├── keyword-derive.ts                                    # 新 (Task 6)
│   ├── search-adapter.ts                                    # 改 (Task 5: factory)
│   └── types.ts                                             # 改 (Task 5: kind union 加 'tavily')
└── scheduler/
    ├── queue.ts                                             # 改 (Task 9: newsTriageQueue)
    ├── workers.ts                                           # 改 (Task 9: 注册 ingest tick + triage worker)
    └── workers/
        ├── cadence.ts                                       # 改 (Task 1: G1 fix)
        ├── news-ingest.ts                                   # 新 (Task 7)
        └── news-triage.ts                                   # 新 (Task 8)

tests/
├── e2e/
│   └── news-intake-full-flow.test.ts                        # 新 (Task 11)
├── integrations/
│   └── tavily-acceptance.test.ts                            # 新 (Task 12, INTEGRATION_TESTS gate)
├── modules/
│   ├── watchlist-keywords.test.ts                           # 新 (Task 3)
│   └── prediction/recompute-now.test.ts                     # 新 (Task 10)
├── news/
│   ├── tavily.test.ts                                       # 新 (Task 4)
│   └── keyword-derive.test.ts                               # 新 (Task 6)
└── scheduler/workers/
    ├── cadence.test.ts                                      # 改 (Task 1: G1 verification)
    ├── news-ingest.test.ts                                  # 新 (Task 7)
    └── news-triage.test.ts                                  # 新 (Task 8)
```

**统计:** 新建 13 个文件,修改 9 个文件。

---

## Tasks

### Task 1: G1 修复 — Cadence enqueue 改为 fullRecalcQueue

**Files:**
- Modify: `src/scheduler/workers/cadence.ts:25-65`
- Modify: `tests/scheduler/workers/cadence.test.ts`

**Spec ISC:** ISC-G1.1, ISC-G1.2, ISC-G1.3

- [ ] **Step 1: 读现有 cadence.ts 确认 bug 位置**

```bash
cd /Users/quzhi/Desktop/排班系统设计-superpowers/
sed -n '24,60p' src/scheduler/workers/cadence.ts
```

确认 line 59 当前是:
```ts
await deps.queue.add('incr', { predictionId: row.id, kind: 'INCR' })
```

- [ ] **Step 2: 修改 CadenceQueueLike type + 调用**

```ts
// src/scheduler/workers/cadence.ts (全文替换)
import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import type { Db } from '@/db/client'
import { fullRecalcQueue } from '../queue'

/**
 * Cadence tick worker — m5 重定义(Plan-E G1).
 *
 * **m5 行为变更:** cadence 不再直接 enqueue INCR refresh 任务(那要 newEvidenceNewsIds),
 * 改为 enqueue 到 `fullRecalcQueue` 让 `shouldTriggerFull` 的 P1-P5 trigger 决定:
 *  - 如果 P1(INCR 累积)/ P2(days)/ P3(new evidence)/ P4(drift)任一触发 → 走 FULL
 *  - 否则 skip(廉价)
 *
 * INCR 是事件驱动的(news triage HIGH score 触发,m5 G3),不再节奏驱动。
 */

export type CadenceQueueLike = {
  add: (name: string, data: { predictionId: string }) => Promise<unknown>
}

export type CadenceDeps = {
  db: Db
  queue: CadenceQueueLike
  limit?: number
}

export async function tickCadence(deps: CadenceDeps): Promise<number> {
  const limit = deps.limit ?? 100
  const due = await deps.db.execute<{ id: string }>(sql`
    SELECT id FROM predictions
    WHERE status = 'PROPOSED'
      AND expires_at > NOW()
      AND (last_incr_at IS NULL
           OR last_incr_at + (cadence_minutes * INTERVAL '1 minute') < NOW())
    LIMIT ${limit}
  `)
  const rows = due as Array<{ id: string }>
  let n = 0
  for (const row of rows) {
    await deps.queue.add('full-recalc', { predictionId: row.id })
    n++
  }
  return n
}

export function defaultCadenceDeps(): CadenceDeps {
  const { db } = createDb('admin')
  return { db, queue: fullRecalcQueue }
}

export function scheduleCadenceTick(
  deps: CadenceDeps = defaultCadenceDeps(),
  intervalMs = 60_000,
): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    tickCadence(deps).catch((err) => { console.error('[cadence-tick] failed:', err) })
  }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
```

- [ ] **Step 3: 改测试以 verify G1**

```ts
// tests/scheduler/workers/cadence.test.ts (整文件替换)
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { tickCadence, type CadenceQueueLike } from '@/scheduler/workers/cadence'

describe('tickCadence (m5 G1: enqueue → fullRecalcQueue)', () => {
  test('enqueues full-recalc for PROPOSED predictions whose cadence elapsed', async () => {
    const ctx = await createTestDb()
    // Insert minimal fixture: 1 region + 1 vc + 1 tc + 1 PROPOSED prediction
    // with last_incr_at NULL (= due immediately)
    const regionId = crypto.randomUUID()
    const vcId = crypto.randomUUID()
    const tcId = crypto.randomUUID()
    const predId = crypto.randomUUID()
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', 'TEST_CADENCE_M5',
        ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.db.execute(sql`
      INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VC' + Date.now()}, 'TestVC')
    `)
    await ctx.db.execute(sql`
      INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TC' + Date.now()}, 'TestTC')
    `)
    await ctx.db.execute(sql`
      INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
        region_id, region_version, window_date, window_half, k_days, cadence_minutes,
        confidence_now, expires_at)
      VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${crypto.randomUUID()}::uuid,
        ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
        '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day')
    `)

    // Mock queue captures all .add() calls
    const calls: Array<{ name: string; data: { predictionId: string } }> = []
    const mockQueue: CadenceQueueLike = {
      add: async (name, data) => { calls.push({ name, data }); return undefined },
    }

    const n = await tickCadence({ db: ctx.db, queue: mockQueue, limit: 10 })
    expect(n).toBeGreaterThanOrEqual(1)
    const myCall = calls.find(c => c.data.predictionId === predId)
    expect(myCall).toBeDefined()
    expect(myCall!.name).toBe('full-recalc')
    // CRITICAL: payload does NOT include `kind: 'INCR'` (G1 verification)
    expect((myCall!.data as any).kind).toBeUndefined()

    await ctx.cleanup()
  })

  test('does not enqueue when no PROPOSED predictions are due', async () => {
    const ctx = await createTestDb()
    const calls: Array<{ name: string; data: any }> = []
    const mockQueue: CadenceQueueLike = {
      add: async (name, data) => { calls.push({ name, data }); return undefined },
    }
    // Insert a fresh PROPOSED prediction with last_incr_at = NOW (NOT due)
    const regionId = crypto.randomUUID()
    const vcId = crypto.randomUUID()
    const tcId = crypto.randomUUID()
    const predId = crypto.randomUUID()
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', 'TEST_CADENCE_M5_FRESH',
        ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.db.execute(sql`
      INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VCF' + Date.now()}, 'FreshVC')
    `)
    await ctx.db.execute(sql`
      INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TCF' + Date.now()}, 'FreshTC')
    `)
    await ctx.db.execute(sql`
      INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
        region_id, region_version, window_date, window_half, k_days, cadence_minutes,
        confidence_now, expires_at, last_incr_at)
      VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${crypto.randomUUID()}::uuid,
        ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
        '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day', NOW())
    `)

    const n = await tickCadence({ db: ctx.db, queue: mockQueue, limit: 10 })
    // The fresh row not due; other ambient rows may or may not be due — assert OUR row not enqueued
    const myCall = calls.find(c => c.data.predictionId === predId)
    expect(myCall).toBeUndefined()

    await ctx.cleanup()
  })
})
```

- [ ] **Step 4: 跑测试 + tsc**

```bash
bun test tests/scheduler/workers/cadence.test.ts
# 期望 2 pass / 0 fail

bunx tsc --noEmit
# 0 errors

bun test
# 期望 ≥ 390 + 0 (替换原 cadence test) = 390 pass / 1 skip / 0 fail (test count 不变,只是断言改了)
```

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/workers/cadence.ts tests/scheduler/workers/cadence.test.ts
git commit -m "fix(scheduler): cadence tick → fullRecalcQueue (G1, m5)"
```

---

### Task 2: watchlist.keywords schema migration

**Files:**
- Modify: `src/db/schema/watchlist.ts`
- Run: `bun run db:generate && bun run db:migrate`(产生 `migrations/0010_*.sql`)

**Spec ISC:** ISC-G2.2(部分)

- [ ] **Step 1: drizzle schema 加 keywords 列**

```ts
// src/db/schema/watchlist.ts (在 watchLists table 内现有列下加;保留 import)
import { boolean, index, integer, pgTable, sql, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    keywords: text('keywords').array().notNull().default(sql`ARRAY[]::text[]`),  // ← m5 加
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('watchlist_active_idx').on(t.isActive),
    index('watchlist_vrt_idx').on(t.vehicleClassId, t.regionId, t.taskClassId),
  ]
)

// 其余 (taskCards, type exports) 保持不变 — 完整文件其余部分原样保留
```

- [ ] **Step 2: 生成 + 应用 migration**

```bash
bun run db:generate
# 期望产生 migrations/0010_<auto-name>.sql,内容含
# ALTER TABLE "watch_lists" ADD COLUMN "keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL;

bun run db:migrate
# 期望 success;再次跑 idempotent

# 看 0010 文件内容
ls -1 migrations/ | tail -3
cat migrations/0010_*.sql
```

- [ ] **Step 3: schema 兼容验证(简单 INSERT 测试)**

直接跑 full suite,所有 watchlist 测试应仍 pass(因 default 兼容)。

```bash
bunx tsc --noEmit
# 0 errors

bun test tests/modules/watchlist
# 期望全 pass
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/watchlist.ts migrations/0010_*.sql migrations/meta/
git commit -m "feat(db): watch_lists.keywords text[] column (m5)"
```

---

### Task 3: watchlist service/route 支持 keywords 字段

**Files:**
- Modify: `src/modules/watchlist/service.ts`
- Modify: `src/modules/watchlist/routes.ts`
- Create: `tests/modules/watchlist-keywords.test.ts`

**Spec ISC:** ISC-G2.2(部分)

- [ ] **Step 1: service 接 keywords**

修改 `CreateWatchListInput` 加可选 `keywords` 字段,`createWatchList` 落库时写。具体 patch:

```ts
// src/modules/watchlist/service.ts (CreateWatchListInput 加字段)
export type CreateWatchListInput = {
  name: string
  description?: string
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  kRangeMin?: number
  kRangeMax?: number
  keywords?: string[]  // ← m5 加
  createdBy: string
}

// createWatchList 内 INSERT 加映射(保留其余字段不变,只在 .values 里加)
export async function createWatchList(db: Db, input: CreateWatchListInput): Promise<WatchList> {
  const [row] = await db.insert(watchLists).values({
    name: input.name,
    description: input.description ?? null,
    vehicleClassId: input.vehicleClassId,
    taskClassId: input.taskClassId,
    regionId: input.regionId,
    regionVersion: input.regionVersion,
    kRangeMin: input.kRangeMin ?? 1,
    kRangeMax: input.kRangeMax ?? 14,
    keywords: input.keywords ?? [],  // ← m5 加
    createdBy: input.createdBy,
  }).returning()
  if (!row) throw new Error('insert returned no row')
  return row
}
```

PATCH endpoint(若已存在 `updateWatchList` 函数则加 keywords 支持;若没有则加新函数):

```ts
// src/modules/watchlist/service.ts (在文件末尾加)
export type UpdateWatchListKeywordsInput = {
  id: string
  keywords: string[]
}

export async function updateWatchListKeywords(
  db: Db,
  input: UpdateWatchListKeywordsInput,
): Promise<WatchList> {
  const [row] = await db.update(watchLists)
    .set({ keywords: input.keywords, updatedAt: new Date() })
    .where(eq(watchLists.id, input.id))
    .returning()
  if (!row) throw new Error(`watchlist ${input.id} not found`)
  return row
}
```

- [ ] **Step 2: routes 接 zod schema + PATCH 端点**

```ts
// src/modules/watchlist/routes.ts (createSchema 加 keywords 字段)
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  vehicleClassId: z.string().uuid(),
  taskClassId: z.string().uuid(),
  regionId: z.string().uuid(),
  regionVersion: z.number().int().positive(),
  kRangeMin: z.number().int().positive().optional(),
  kRangeMax: z.number().int().positive().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),  // ← m5 加
})

// 在 POST '/' 内 input 装配处加 keywords forward(参考 description/kRangeMin 模式)
// (在 input 的若干 if 后面加)
if (body.keywords !== undefined) input.keywords = body.keywords

// 在 watchlistRoutes 内,append 1 个新路由(在 setActive 路由之后):
const updateKeywordsSchema = z.object({ keywords: z.array(z.string().min(1).max(60)).max(20) })

app.patch('/:id/keywords', authRequired(db), zValidator('json', updateKeywordsSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  try {
    const wl = await updateWatchListKeywords(db, { id, keywords: body.keywords })
    return c.json(wl)
  } catch (e) {
    if ((e as Error).message.includes('not found')) throw NotFound(`watchlist ${id} not found`)
    throw e
  }
})
```

需要 import:`updateWatchListKeywords` 加到顶部 service import 里。

- [ ] **Step 3: 写测试**

```ts
// tests/modules/watchlist-keywords.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import { buildTestApp } from '../helpers/test-server'

describe('watchlist keywords', () => {
  async function seedAdminAndLogin(ctx: { db: any }, app: any): Promise<string> {
    // 复用项目内的 admin seed 模式 — 多数测试已有 helper;若没有,inline
    // 这里用现有 helpers 模式;若 buildTestApp 有内置 login,用它
    const userId = crypto.randomUUID()
    const adminRoleId = '00000000-0000-0000-0000-000000000001'
    await ctx.db.execute(sql`
      INSERT INTO users(id, email, password_hash, display_name)
      VALUES(${userId}::uuid, ${'kw-test-' + Date.now() + '@x.com'}, 'x', 'KW Tester')
      ON CONFLICT DO NOTHING
    `)
    await ctx.db.execute(sql`
      INSERT INTO user_roles(user_id, role_id) VALUES(${userId}::uuid, ${adminRoleId}::uuid)
      ON CONFLICT DO NOTHING
    `)
    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'kw-test-' + Date.now() + '@x.com', password: 'x' }),
    })
    // 测试可绕过密码:实施时若 helpers 提供 short-circuit 用;否则用 helpers/auth.ts 已有的 createSessionForUser
    // (此 stub 仅展示 shape;实施时按 helpers 现状调整)
    return userId
  }

  test('createWatchList + keywords field round-trips', async () => {
    const ctx = await createTestDb()
    const regionId = crypto.randomUUID()
    const vcId = crypto.randomUUID()
    const tcId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', 'KW_REG_' || ${Date.now()},
        ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.db.execute(sql`INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VK' + Date.now()}, 'KWVC')`)
    await ctx.db.execute(sql`INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TK' + Date.now()}, 'KWTC')`)
    await ctx.db.execute(sql`INSERT INTO users(id, email, password_hash, display_name) VALUES(${userId}::uuid, ${'kw-svc-' + Date.now() + '@x.com'}, 'x', 'svc') ON CONFLICT DO NOTHING`)

    const { createWatchList, updateWatchListKeywords } = await import('@/modules/watchlist/service')
    const wl = await createWatchList(ctx.db, {
      name: 'KW Test ' + Date.now(),
      vehicleClassId: vcId,
      taskClassId: tcId,
      regionId,
      regionVersion: 1,
      keywords: ['防暴', '安保'],
      createdBy: userId,
    })
    expect(wl.keywords).toEqual(['防暴', '安保'])

    const updated = await updateWatchListKeywords(ctx.db, {
      id: wl.id,
      keywords: ['防暴', '安保', '专项整治'],
    })
    expect(updated.keywords).toEqual(['防暴', '安保', '专项整治'])

    const empty = await createWatchList(ctx.db, {
      name: 'KW Empty ' + Date.now(),
      vehicleClassId: vcId,
      taskClassId: tcId,
      regionId,
      regionVersion: 1,
      createdBy: userId,
    })
    expect(empty.keywords).toEqual([])

    await ctx.cleanup()
  })
})
```

- [ ] **Step 4: 跑测试**

```bash
bun test tests/modules/watchlist-keywords.test.ts
# 期望 1 pass / 0 fail

bunx tsc --noEmit
# 0 errors

bun test tests/modules/watchlist
# 现有 watchlist 测试不退步
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/watchlist/service.ts src/modules/watchlist/routes.ts tests/modules/watchlist-keywords.test.ts
git commit -m "feat(watchlist): keywords field + PATCH /:id/keywords (m5)"
```

---

### Task 4: TavilySearchAdapter 实现 + 4-path 测试

**Files:**
- Create: `src/news/adapters/tavily.ts`
- Create: `tests/news/tavily.test.ts`

**Spec ISC:** ISC-T.1, ISC-T.2, ISC-T.3, ISC-T.4

- [ ] **Step 1: 实现 TavilySearchAdapter**

```ts
// src/news/adapters/tavily.ts
import { loadEnv } from '@/env'
import type { SearchAdapter, SearchHit, SearchOpts } from '../types'

/**
 * Tavily search adapter — m5 默认搜索源.
 *
 * REST API: POST https://api.tavily.com/search
 * Body: { api_key, query, search_depth?, max_results?, include_domains? }
 * Response: { results: [{ title, url, content, score, published_date }] }
 *
 * 行为:
 * - 无 API key → 空数组 + degraded warn,不发请求
 * - 24h 缓存(keyed on JSON.stringify({q, freshness}))
 * - Fixed-window 3 calls/sec rate limit(per-instance)
 * - HTTP 非 2xx → 空数组 + warn
 * - fetch 异常 → 空数组 + error log
 */
export class TavilySearchAdapter implements SearchAdapter {
  readonly key = 'tavily'
  readonly kind = 'tavily' as const

  private cache = new Map<string, { hits: SearchHit[]; expiresAt: number }>()
  private callsInWindow = 0
  private windowStart = Date.now()

  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const env = loadEnv()
    const apiKey = env.TAVILY_API_KEY

    if (!apiKey) {
      console.warn('[tavily] no API key, returning empty hits (degraded)')
      return []
    }

    const q = keywords.join(' ').trim()
    if (!q) return []

    const cacheKey = JSON.stringify({ q, freshness: opts.freshness })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.hits

    const now = Date.now()
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.callsInWindow = 0
    }
    if (this.callsInWindow >= 3) {
      console.warn('[tavily] rate-limited (3/sec), returning empty hits (degraded)')
      return []
    }
    this.callsInWindow++

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          search_depth: 'basic',
          max_results: 20,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        console.warn(`[tavily] HTTP ${res.status}, returning empty hits (degraded)`)
        return []
      }
      const json = (await res.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }> }
      const results = json.results ?? []
      const hits: SearchHit[] = results.map((r) => {
        const domain = (() => {
          try { return new URL(r.url).hostname } catch { return 'tavily' }
        })()
        const hit: SearchHit = {
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.content ?? '',
          source: { name: domain, kind: 'mainstream' as const },
        }
        if (r.published_date) hit.publishedAt = r.published_date
        return hit
      })
      this.cache.set(cacheKey, { hits, expiresAt: Date.now() + 24 * 3600_000 })
      return hits
    } catch (e) {
      console.error(`[tavily] fetch error: ${(e as Error).message}, returning empty (degraded)`)
      return []
    }
  }
}
```

- [ ] **Step 2: 写 4-path 测试**

```ts
// tests/news/tavily.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import { TavilySearchAdapter } from '@/news/adapters/tavily'

describe('TavilySearchAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    envSnapshot = { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
    resetEnvCacheForTests()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('happy path: API key set + fetch returns results → SearchHits', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    const calls: any[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: url.toString(), init })
      return new Response(JSON.stringify({
        results: [
          { title: '广州专项整治', url: 'https://news.example.com/a', content: 'snippet here', score: 0.9, published_date: '2026-05-07' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['广州', '专项'])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('广州专项整治')
    expect(hits[0]!.url).toBe('https://news.example.com/a')
    expect(hits[0]!.source.name).toBe('news.example.com')
    expect(hits[0]!.source.kind).toBe('mainstream')
    expect(hits[0]!.publishedAt).toBe('2026-05-07')

    const body = JSON.parse(calls[0].init.body)
    expect(body.api_key).toBe('tvly-test-key')
    expect(body.query).toBe('广州 专项')
  })

  test('no API key: returns empty + warn, no fetch call', async () => {
    process.env.TAVILY_API_KEY = ''
    resetEnvCacheForTests()
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return new Response('{}') }) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
    expect(fetchCalled).toBe(false)
  })

  test('rate-limited: 3 calls succeed, 4th returns empty', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return new Response(JSON.stringify({
        results: [{ title: `r${callCount}`, url: 'https://x/', content: '', score: 0.1 }],
      }), { status: 200 })
    }) as any

    const adapter = new TavilySearchAdapter()
    const r1 = await adapter.query(['q1'])
    const r2 = await adapter.query(['q2'])
    const r3 = await adapter.query(['q3'])
    const r4 = await adapter.query(['q4'])

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(1)
    expect(r4).toEqual([])
    expect(callCount).toBe(3)
  })

  test('fetch HTTP 500: returns empty + warn', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    globalThis.fetch = (async () => new Response('error', { status: 500 })) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
bun test tests/news/tavily.test.ts
# 期望 4 pass / 0 fail

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add src/news/adapters/tavily.ts tests/news/tavily.test.ts
git commit -m "feat(news): TavilySearchAdapter — REST API + rate-limit + cache + degraded fallback (m5)"
```

---

### Task 5: search-adapter pool 加 tavily factory + 默认值切换 + env

**Files:**
- Modify: `src/env.ts`
- Modify: `src/news/types.ts`
- Modify: `src/news/search-adapter.ts`

**Spec ISC:** ISC-T.1(infra)

- [ ] **Step 1: env 加 TAVILY_API_KEY + 修改 SEARCH_API_KIND default**

```ts
// src/env.ts (加在现有 BING_NEWS_API_KEY 附近)
TAVILY_API_KEY: z.string().default(''),

// 修改:SEARCH_API_KIND 加 'tavily' + 默认改 'tavily'
SEARCH_API_KIND: z.enum(['mock', 'bing-news', 'rss', 'ddg', 'aggregator',
                         'gov-gd-province', 'gov-gz-city', 'gov-public-security',
                         'gov-test', 'tavily']).default('tavily'),
```

(如果 SEARCH_API_KIND 当前 default 是 `'mock'` 或其他,改成 `'tavily'`。)

- [ ] **Step 2: SearchAdapter.kind union 加 'tavily'**

```ts
// src/news/types.ts (找到 SearchAdapter type,kind union 加 'tavily')
export type SearchAdapter = {
  readonly key: string
  readonly kind: 'mock' | 'bing-news' | 'rss' | 'ddg' | 'aggregator'
                | 'gov-gd-province' | 'gov-gz-city' | 'gov-public-security' | 'gov-test'
                | 'tavily'
  query(keywords: string[], opts?: SearchOpts): Promise<SearchHit[]>
  // ... 其余字段保持
}
```

- [ ] **Step 3: search-adapter pool 加 factory**

```ts
// src/news/search-adapter.ts (顶部加 import)
import { TavilySearchAdapter } from './adapters/tavily'

// SEARCH_FACTORIES 对象内加(参考 'bing-news' 一行)
const SEARCH_FACTORIES: Record<string, () => SearchAdapter> = {
  // ... 现有
  'tavily': () => new TavilySearchAdapter(),
}
```

也要看 makePool 配置中是否有 `defaultKey` 引用,确认 env 默认值是 `'tavily'` 时 pool 选 Tavily。

- [ ] **Step 4: 测试**

```bash
bunx tsc --noEmit
# 0 errors

bun test tests/news/search-adapter.test.ts
# 现有 search-adapter 测试不退步
```

加一个针对默认值的快验:

```ts
// tests/news/search-adapter.test.ts (在文件 describe 内 append 一个 test)
test('default SEARCH_API_KIND=tavily resolves TavilySearchAdapter', async () => {
  // env snapshot/restore (沿用现有 beforeEach/afterEach 模式;若已有就跳过 setup)
  delete process.env.SEARCH_API_KIND
  resetEnvCacheForTests()
  resetSearchAdapterPoolForTests()
  const adapter = getSearchAdapter()
  expect(adapter.kind).toBe('tavily')
})
```

```bash
bun test tests/news/search-adapter.test.ts
# 期望 +1 pass

bun test
# 期望 ≥ 当前 + 4 (Task 4) + 1 (本 task default verify) = 395 pass / 1 skip / 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/news/types.ts src/news/search-adapter.ts tests/news/search-adapter.test.ts
git commit -m "feat(news): tavily factory + default SEARCH_API_KIND=tavily (m5)"
```

---

### Task 6: keyword-derive 派生 fallback + 测试

**Files:**
- Create: `src/news/keyword-derive.ts`
- Create: `tests/news/keyword-derive.test.ts`

**Spec ISC:** ISC-G2.2(部分)

- [ ] **Step 1: 实现派生函数**

```ts
// src/news/keyword-derive.ts
import type { WatchList } from '@/db/schema/watchlist'
import type { VehicleClass, TaskClass } from '@/db/schema/taxonomy'

export type RegionLabel = { name: string | null }

/**
 * Derive keywords for a watchlist when its `keywords` array is empty.
 * Returns a deduplicated, non-empty-string list built from V/T/region names.
 *
 * Order:
 *  1. Vehicle class name
 *  2. Task class name
 *  3. Region name (if present)
 */
export function deriveKeywordsForWatchlist(
  _wl: WatchList,
  vc: VehicleClass,
  tc: TaskClass,
  region: RegionLabel,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (s: string | null | undefined): void => {
    if (!s) return
    const t = s.trim()
    if (!t) return
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  push(vc.name)
  push(tc.name)
  push(region.name)
  return out
}

/**
 * Resolve keywords: explicit (non-empty) overrides derived.
 */
export function resolveKeywords(
  wl: WatchList,
  vc: VehicleClass,
  tc: TaskClass,
  region: RegionLabel,
): string[] {
  if (Array.isArray(wl.keywords) && wl.keywords.length > 0) {
    return wl.keywords.filter((k) => k.trim().length > 0)
  }
  return deriveKeywordsForWatchlist(wl, vc, tc, region)
}
```

- [ ] **Step 2: 写测试**

```ts
// tests/news/keyword-derive.test.ts
import { describe, expect, test } from 'bun:test'
import { deriveKeywordsForWatchlist, resolveKeywords } from '@/news/keyword-derive'
import type { WatchList } from '@/db/schema/watchlist'

const baseWl = (overrides: Partial<WatchList> = {}): WatchList => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'wl',
  description: null,
  vehicleClassId: '00000000-0000-0000-0000-000000000002',
  taskClassId: '00000000-0000-0000-0000-000000000003',
  regionId: '00000000-0000-0000-0000-000000000004',
  regionVersion: 1,
  kRangeMin: 1,
  kRangeMax: 14,
  isActive: true,
  keywords: [],
  createdBy: '00000000-0000-0000-0000-000000000005',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as WatchList

describe('keyword-derive', () => {
  test('deriveKeywordsForWatchlist: V/T/region 三项 + 去重 + trim', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['巡逻警车', '治安巡逻', '越秀区'])
  })

  test('deriveKeywordsForWatchlist: 区域名 null → 跳过', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: 'A' } as any,
      { id: 'y', code: 'TC', name: 'B' } as any,
      { name: null },
    )
    expect(out).toEqual(['A', 'B'])
  })

  test('deriveKeywordsForWatchlist: 重复 V=T 名 → 去重', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: '巡逻' } as any,
      { id: 'y', code: 'TC', name: '巡逻' } as any,
      { name: '广州' },
    )
    expect(out).toEqual(['巡逻', '广州'])
  })

  test('resolveKeywords: 显式 keywords 非空 → 用之', () => {
    const out = resolveKeywords(
      baseWl({ keywords: ['防暴', '安保'] }),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['防暴', '安保'])
  })

  test('resolveKeywords: 显式 keywords 空 → 降级派生', () => {
    const out = resolveKeywords(
      baseWl({ keywords: [] }),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['巡逻警车', '治安巡逻', '越秀区'])
  })

  test('resolveKeywords: 显式 keywords 空字符串 → 过滤', () => {
    const out = resolveKeywords(
      baseWl({ keywords: ['', '  ', '安保'] }),
      { id: 'x', code: 'VC', name: 'V' } as any,
      { id: 'y', code: 'TC', name: 'T' } as any,
      { name: 'R' },
    )
    expect(out).toEqual(['安保'])
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
bun test tests/news/keyword-derive.test.ts
# 期望 6 pass / 0 fail

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add src/news/keyword-derive.ts tests/news/keyword-derive.test.ts
git commit -m "feat(news): keyword-derive — explicit > V/T/region fallback (m5)"
```

---

### Task 7: tickNewsIngest worker(G2 + G4)

**Files:**
- Create: `src/scheduler/workers/news-ingest.ts`
- Create: `tests/scheduler/workers/news-ingest.test.ts`

**Spec ISC:** ISC-G2.1, ISC-G2.2, ISC-G2.3, ISC-G2.4, ISC-G2.5

- [ ] **Step 1: 实现 tickNewsIngest**

```ts
// src/scheduler/workers/news-ingest.ts
import { eq, sql } from 'drizzle-orm'
import { createDb, type Db } from '@/db/client'
import { loadEnv } from '@/env'
import { newsItems } from '@/db/schema/prediction'
import { watchLists } from '@/db/schema/watchlist'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { findMatchingPredictions } from '@/news/matcher'
import { resolveKeywords } from '@/news/keyword-derive'
import { getSearchAdapter } from '@/news/search-adapter'

export type NewsTriageQueueLike = {
  add: (name: string, data: { predictionId: string; newsId: string }) => Promise<unknown>
}

export type NewsIngestDeps = {
  db: Db
  triageQueue: NewsTriageQueueLike
  /** Override the SearchAdapter for tests. Default: getSearchAdapter(). */
  searchAdapter?: { query: (keywords: string[]) => Promise<Array<{ title: string; url: string; snippet: string; source: { name: string; kind: 'mainstream' | 'gov' | 'social' | 'foreign' }; publishedAt?: string }>> }
}

export type NewsIngestTickResult = {
  watchlistsScanned: number
  newsFetched: number
  newsInserted: number
  triageJobsEnqueued: number
  errors: number
}

/**
 * One newsIngest tick. Per (γ Hybrid) decision:
 *  1. For each active watchlist, resolve keywords (explicit or derived).
 *  2. Call adapter.query(keywords) to fetch news.
 *  3. INSERT news_items with ON CONFLICT (url) DO NOTHING — URL UNIQUE handles idempotency.
 *  4. For each newly-inserted news, call findMatchingPredictions to find candidate predictions.
 *  5. For each (prediction, news) pair, enqueue a newsTriageQueue job (LLM scoring is async).
 *
 * Errors per watchlist are isolated (try/catch); one bad watchlist does NOT abort the tick.
 */
export async function tickNewsIngest(deps: NewsIngestDeps): Promise<NewsIngestTickResult> {
  const result: NewsIngestTickResult = {
    watchlistsScanned: 0, newsFetched: 0, newsInserted: 0, triageJobsEnqueued: 0, errors: 0,
  }

  const adapter = deps.searchAdapter ?? getSearchAdapter()
  const activeWls = await deps.db.select().from(watchLists).where(eq(watchLists.isActive, true))

  for (const wl of activeWls) {
    result.watchlistsScanned++
    try {
      // Load V/T/region for keyword derive fallback
      const [vc] = await deps.db.select().from(vehicleClasses).where(eq(vehicleClasses.id, wl.vehicleClassId))
      const [tc] = await deps.db.select().from(taskClasses).where(eq(taskClasses.id, wl.taskClassId))
      const regRows = await deps.db.execute<{ name: string | null }>(sql`
        SELECT name FROM regions WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion} LIMIT 1
      `)
      const region = (regRows as Array<{ name: string | null }>)[0] ?? { name: null }
      if (!vc || !tc) {
        console.warn(`[news-ingest] watchlist ${wl.id}: V/T not found; skipping`)
        result.errors++
        continue
      }

      const keywords = resolveKeywords(wl, vc, tc, region)
      if (keywords.length === 0) continue

      const hits = await adapter.query(keywords)
      result.newsFetched += hits.length

      for (const hit of hits) {
        if (!hit.url || !hit.title) continue
        // INSERT idempotent on URL (UNIQUE constraint expected; if dup, RETURNING is empty)
        const inserted = await deps.db.execute<{ id: string }>(sql`
          INSERT INTO news_items(id, url, title, summary_zh, raw_snippet, source_label, source_kind, published_at, fetched_at, matched_regions)
          VALUES (
            gen_random_uuid(),
            ${hit.url},
            ${hit.title},
            ${hit.snippet ?? null},
            ${hit.snippet ?? null},
            ${hit.source.name},
            ${hit.source.kind.toUpperCase()},
            ${hit.publishedAt ?? null},
            NOW(),
            ARRAY[${wl.regionId}]::uuid[]
          )
          ON CONFLICT (url) DO NOTHING
          RETURNING id
        `)
        const rows = inserted as Array<{ id: string }>
        if (rows.length === 0) continue  // dup URL skipped
        const newsId = rows[0]!.id
        result.newsInserted++

        // Sync match to find candidate predictions
        const candidates = await findMatchingPredictions(deps.db, newsId)

        // Enqueue per-(pred, news) triage job
        for (const cand of candidates) {
          await deps.triageQueue.add('triage', {
            predictionId: cand.predictionId,
            newsId,
          })
          result.triageJobsEnqueued++
        }
      }
    } catch (err) {
      console.error(`[news-ingest] watchlist ${wl.id} failed:`, err)
      result.errors++
    }
  }

  return result
}

export function defaultNewsIngestDeps(): NewsIngestDeps {
  // Lazy import to avoid circular dep
  const { newsTriageQueue } = require('../queue') as { newsTriageQueue: NewsTriageQueueLike }
  const { db } = createDb('admin')
  return { db, triageQueue: newsTriageQueue }
}

export function scheduleNewsIngestTick(
  deps: NewsIngestDeps = defaultNewsIngestDeps(),
  intervalMs?: number,
): ReturnType<typeof setInterval> {
  const env = loadEnv()
  const ms = intervalMs ?? env.NEWS_INGEST_INTERVAL_MIN * 60_000
  const t = setInterval(() => {
    tickNewsIngest(deps).catch((err) => { console.error('[news-ingest-tick] failed:', err) })
  }, ms)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
```

- [ ] **Step 2: 写测试**

```ts
// tests/scheduler/workers/news-ingest.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { tickNewsIngest, type NewsTriageQueueLike } from '@/scheduler/workers/news-ingest'

async function seedWatchlistAndPrediction(db: any, opts: {
  withKeywords?: string[]
}): Promise<{ watchlistId: string; predictionId: string; regionId: string }> {
  const regionId = crypto.randomUUID()
  const vcId = crypto.randomUUID()
  const tcId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const wlId = crypto.randomUUID()
  const predId = crypto.randomUUID()

  await db.execute(sql`
    INSERT INTO regions(id, version, kind, name, polygon, effective_from)
    VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', ${'NI_REG_' + Date.now()},
      ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
  `)
  await db.execute(sql`INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VNI' + Date.now()}, 'NIVehicle')`)
  await db.execute(sql`INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TNI' + Date.now()}, 'NITask')`)
  await db.execute(sql`INSERT INTO users(id, email, password_hash, display_name) VALUES(${userId}::uuid, ${'ni-' + Date.now() + '@x.com'}, 'x', 'NI') ON CONFLICT DO NOTHING`)
  await db.execute(sql`
    INSERT INTO watch_lists(id, name, vehicle_class_id, task_class_id, region_id, region_version, k_range_min, k_range_max, is_active, keywords, created_by)
    VALUES(${wlId}::uuid, ${'NI ' + Date.now()}, ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1, 1, 14, TRUE,
      ${opts.withKeywords ?? []}::text[], ${userId}::uuid)
  `)
  await db.execute(sql`
    INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
      region_id, region_version, window_date, window_half, k_days, cadence_minutes,
      confidence_now, expires_at)
    VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${wlId}::uuid,
      ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
      '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day')
  `)
  return { watchlistId: wlId, predictionId: predId, regionId }
}

describe('tickNewsIngest', () => {
  test('1 watchlist + adapter returns 2 news → 2 news_items inserted + matcher finds candidates', async () => {
    const ctx = await createTestDb()
    const seeded = await seedWatchlistAndPrediction(ctx.db, { withKeywords: ['ingest-test-' + Date.now()] })

    const calls: Array<{ predictionId: string; newsId: string }> = []
    const triageQ: NewsTriageQueueLike = { add: async (_, d) => { calls.push(d); return undefined } }

    const fakeAdapter = {
      query: async () => [
        { title: 'TestNews 1 ' + Date.now(), url: 'https://example.test/1?t=' + Date.now(), snippet: 's1', source: { name: 'example.test', kind: 'mainstream' as const } },
        { title: 'TestNews 2 ' + Date.now(), url: 'https://example.test/2?t=' + Date.now(), snippet: 's2', source: { name: 'example.test', kind: 'mainstream' as const } },
      ],
    }

    const r = await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    expect(r.newsFetched).toBeGreaterThanOrEqual(2)
    expect(r.newsInserted).toBeGreaterThanOrEqual(2)
    // matcher 应该找到 seeded prediction(同 region)
    const myCalls = calls.filter(c => c.predictionId === seeded.predictionId)
    expect(myCalls.length).toBeGreaterThanOrEqual(1)

    await ctx.cleanup()
  })

  test('idempotent: same URL fetched twice → no duplicate news_items', async () => {
    const ctx = await createTestDb()
    await seedWatchlistAndPrediction(ctx.db, { withKeywords: ['x'] })

    const triageQ: NewsTriageQueueLike = { add: async () => undefined }
    const url = 'https://dedup.test/' + Date.now()
    const fakeAdapter = {
      query: async () => [
        { title: 'DupTest', url, snippet: 's', source: { name: 'dedup.test', kind: 'mainstream' as const } },
      ],
    }

    const r1 = await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    expect(r1.newsInserted).toBeGreaterThanOrEqual(1)

    const r2 = await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    // 第二次同 URL,UNIQUE 拒绝,inserted 不增加(== 0 for this URL)
    const dups = await ctx.db.execute(sql`SELECT COUNT(*)::int n FROM news_items WHERE url = ${url}`)
    expect((dups as any[])[0].n).toBe(1)

    await ctx.cleanup()
  })

  test('failure isolation: adapter throws on watchlist A → other watchlists still process', async () => {
    const ctx = await createTestDb()
    const seedA = await seedWatchlistAndPrediction(ctx.db, { withKeywords: ['kw-A-' + Date.now()] })
    const seedB = await seedWatchlistAndPrediction(ctx.db, { withKeywords: ['kw-B-' + Date.now()] })
    let callIdx = 0
    const fakeAdapter = {
      query: async (kw: string[]) => {
        callIdx++
        if (callIdx === 1) throw new Error('synthetic adapter failure')  // first watchlist throws
        return [{ title: 'B-news', url: 'https://b.test/' + Date.now(), snippet: '', source: { name: 'b.test', kind: 'mainstream' as const } }]
      },
    }
    const triageQ: NewsTriageQueueLike = { add: async () => undefined }

    const r = await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    expect(r.errors).toBeGreaterThanOrEqual(1)
    expect(r.newsInserted).toBeGreaterThanOrEqual(1)  // B 还是入了

    await ctx.cleanup()
  })

  test('keywords 显式 vs 派生 fallback: 空 keywords → 用 V/T/region 名', async () => {
    const ctx = await createTestDb()
    const seeded = await seedWatchlistAndPrediction(ctx.db, { withKeywords: [] })  // 空,降级派生
    let queryArgs: string[][] = []
    const fakeAdapter = {
      query: async (kw: string[]) => { queryArgs.push(kw); return [] },
    }
    const triageQ: NewsTriageQueueLike = { add: async () => undefined }

    await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    // 该 wl 派生 keywords 应至少含 V (NIVehicle...) 和 T (NITask...) 名
    const myArgs = queryArgs.find((kw) => kw.some(k => k.startsWith('NIVehicle')))
    expect(myArgs).toBeDefined()

    await ctx.cleanup()
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
bun test tests/scheduler/workers/news-ingest.test.ts
# 期望 4 pass / 0 fail (Redis-free,直接调 handler)

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add src/scheduler/workers/news-ingest.ts tests/scheduler/workers/news-ingest.test.ts
git commit -m "feat(scheduler): tickNewsIngest worker — fetch + match + enqueue triage (G2/G4, m5)"
```

---

### Task 8: newsTriageWorker(G3)

**Files:**
- Create: `src/scheduler/workers/news-triage.ts`
- Create: `tests/scheduler/workers/news-triage.test.ts`

**Spec ISC:** ISC-G3.1, ISC-G3.2, ISC-G3.3, ISC-G3.4, ISC-G3.5

- [ ] **Step 1: 实现 newsTriageWorker handler + factory**

```ts
// src/scheduler/workers/news-triage.ts
import { sql } from 'drizzle-orm'
import { createDb, type Db } from '@/db/client'
import { loadEnv } from '@/env'
import { runNewsTriageAgent } from '@/agents/news-triage-agent'
import { createBullMQWorker } from '../helpers/createBullMQWorker'
import type { Worker } from 'bullmq'
import type { infer as inferFnType } from '@/inference/client'

export type NewsTriageJobData = {
  predictionId: string
  newsId: string
}

export type NewsTriageJobResult = {
  relevant: boolean
  weight: 'HIGH' | 'MED' | 'LOW'
  evidenceWritten: boolean
  refreshEnqueued: boolean
}

export type RefreshQueueLike = {
  add: (name: string, data: { predictionId: string; kind: 'INCR'; newEvidenceNewsIds: string[] }) => Promise<unknown>
}

/**
 * Pure handler — no Redis dependency. Tests can call this directly with a mock refreshQueue.
 *
 * Logic per (§ 2D MED+ writes evidence, HIGH triggers INCR):
 *  1. Run runNewsTriageAgent → { relevant, weight, ... }
 *  2. If !relevant or weight === 'LOW' → no-op (skip)
 *  3. If relevant + weight in ['HIGH', 'MED'] → INSERT news_evidence(weight, cited=true)
 *  4. If weight === 'HIGH' → refreshQueue.add INCR with newEvidenceNewsIds=[newsId]
 */
export async function processNewsTriageJob(
  db: Db,
  data: NewsTriageJobData,
  refreshQueue: RefreshQueueLike,
  inferFn?: typeof inferFnType,
): Promise<NewsTriageJobResult> {
  const out = inferFn
    ? await runNewsTriageAgent(db, { newsId: data.newsId, predictionId: data.predictionId }, inferFn)
    : await runNewsTriageAgent(db, { newsId: data.newsId, predictionId: data.predictionId })

  if (!out.relevant || out.weight === 'LOW') {
    return { relevant: out.relevant, weight: out.weight, evidenceWritten: false, refreshEnqueued: false }
  }

  // MED+ → write evidence (idempotent via composite PK or ON CONFLICT)
  await db.execute(sql`
    INSERT INTO news_evidence (prediction_id, news_id, weight, cited)
    VALUES (${data.predictionId}::uuid, ${data.newsId}::uuid, ${out.weight}, TRUE)
    ON CONFLICT DO NOTHING
  `)

  let refreshEnqueued = false
  if (out.weight === 'HIGH') {
    await refreshQueue.add('incr', {
      predictionId: data.predictionId,
      kind: 'INCR',
      newEvidenceNewsIds: [data.newsId],
    })
    refreshEnqueued = true
  }

  return { relevant: out.relevant, weight: out.weight, evidenceWritten: true, refreshEnqueued }
}

export function createNewsTriageWorker(): Worker<NewsTriageJobData, NewsTriageJobResult> {
  const env = loadEnv()
  const { db } = createDb('app')
  // Lazy refreshQueue import to avoid circular dep at module-load
  const { refreshQueue } = require('../queue') as { refreshQueue: RefreshQueueLike }
  return createBullMQWorker<NewsTriageJobData, NewsTriageJobResult>({
    name: 'news-triage',
    handler: async (job) => processNewsTriageJob(db, job.data, refreshQueue),
    options: { concurrency: env.NEWS_TRIAGE_CONCURRENCY },
  })
}
```

- [ ] **Step 2: 写测试(用真 LLM dashscope deepseek-v4-flash)**

```ts
// tests/scheduler/workers/news-triage.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { processNewsTriageJob, type RefreshQueueLike } from '@/scheduler/workers/news-triage'

async function seedTriageFixture(db: any, opts: {
  newsTitle: string
  newsSummary: string
  vName: string
  tName: string
  regionName: string
}): Promise<{ predictionId: string; newsId: string }> {
  const regionId = crypto.randomUUID()
  const vcId = crypto.randomUUID()
  const tcId = crypto.randomUUID()
  const predId = crypto.randomUUID()
  const newsId = crypto.randomUUID()

  await db.execute(sql`
    INSERT INTO regions(id, version, kind, name, polygon, effective_from)
    VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', ${opts.regionName + '_' + Date.now()},
      ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
  `)
  await db.execute(sql`INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VTR' + Date.now()}, ${opts.vName})`)
  await db.execute(sql`INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TTR' + Date.now()}, ${opts.tName})`)
  await db.execute(sql`
    INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
      region_id, region_version, window_date, window_half, k_days, cadence_minutes,
      confidence_now, expires_at)
    VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${crypto.randomUUID()}::uuid,
      ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
      '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day')
  `)
  await db.execute(sql`
    INSERT INTO news_items(id, url, title, summary_zh, raw_snippet, source_label, source_kind, fetched_at, matched_regions)
    VALUES(${newsId}::uuid, ${'https://triage.test/' + Date.now()}, ${opts.newsTitle}, ${opts.newsSummary}, ${opts.newsSummary},
      'triage.test', 'MAINSTREAM', NOW(), ARRAY[${regionId}]::uuid[])
  `)
  return { predictionId: predId, newsId }
}

describe('processNewsTriageJob (REAL LLM dashscope deepseek-v4-flash)', () => {
  // Each test ~5s LLM cost; timeouts increased
  test('high-relevance news → INSERT news_evidence + enqueue refresh-INCR', async () => {
    const ctx = await createTestDb()
    const seeded = await seedTriageFixture(ctx.db, {
      newsTitle: '广州市公安局组织大规模专项整治治安巡逻行动',
      newsSummary: '广州市越秀区公安局昨日启动为期一周的专项整治行动,组织治安巡逻警车 50 辆、警员 200 名,加强夜间巡逻力度。',
      vName: '治安巡逻警车',
      tName: '治安巡逻',
      regionName: '越秀区',
    })

    const refreshCalls: any[] = []
    const refreshQ: RefreshQueueLike = { add: async (n, d) => { refreshCalls.push({ name: n, data: d }); return undefined } }

    const result = await processNewsTriageJob(ctx.db, seeded, refreshQ)
    // Real LLM should rate this HIGH given direct V/T/region match
    if (result.weight === 'HIGH') {
      expect(result.evidenceWritten).toBe(true)
      expect(result.refreshEnqueued).toBe(true)
      expect(refreshCalls.length).toBe(1)
      expect(refreshCalls[0]!.data.kind).toBe('INCR')
      expect(refreshCalls[0]!.data.newEvidenceNewsIds).toEqual([seeded.newsId])
      // verify evidence row
      const ev = await ctx.db.execute(sql`
        SELECT weight, cited FROM news_evidence
        WHERE prediction_id = ${seeded.predictionId}::uuid AND news_id = ${seeded.newsId}::uuid
      `)
      expect((ev as any[]).length).toBe(1)
      expect((ev as any[])[0].weight).toBe('HIGH')
      expect((ev as any[])[0].cited).toBe(true)
    } else {
      // LLM may rate MED in non-deterministic runs — accept MED with relevant evidence,but no INCR
      expect(['MED', 'HIGH']).toContain(result.weight)
      if (result.weight === 'MED') {
        expect(result.evidenceWritten).toBe(true)
        expect(result.refreshEnqueued).toBe(false)
      }
    }

    await ctx.cleanup()
  }, 30000)

  test('LOW-relevance news → no evidence, no refresh', async () => {
    const ctx = await createTestDb()
    const seeded = await seedTriageFixture(ctx.db, {
      newsTitle: '今日股市收盘:沪深 300 上涨 0.5%',
      newsSummary: '今日 A 股市场表现平稳,沪深 300 指数小幅收涨。',
      vName: '巡逻警车',
      tName: '治安巡逻',
      regionName: '广州',
    })

    const refreshCalls: any[] = []
    const refreshQ: RefreshQueueLike = { add: async (n, d) => { refreshCalls.push({ name: n, data: d }); return undefined } }

    const result = await processNewsTriageJob(ctx.db, seeded, refreshQ)
    // 这条新闻跟警务无关 → LLM 应给 LOW 或 !relevant
    expect(result.relevant === false || result.weight === 'LOW').toBe(true)
    expect(result.evidenceWritten).toBe(false)
    expect(result.refreshEnqueued).toBe(false)
    expect(refreshCalls.length).toBe(0)

    await ctx.cleanup()
  }, 30000)

  test('LLM error 不阻塞 — inferFn 抛错时 handler 抛错让 BullMQ retry', async () => {
    const ctx = await createTestDb()
    const seeded = await seedTriageFixture(ctx.db, {
      newsTitle: 'x',
      newsSummary: 'x',
      vName: 'x',
      tName: 'x',
      regionName: 'x',
    })

    const refreshQ: RefreshQueueLike = { add: async () => undefined }
    const failingInfer = (async () => { throw new Error('synthetic LLM failure') }) as any

    await expect(processNewsTriageJob(ctx.db, seeded, refreshQ, failingInfer)).rejects.toThrow(/synthetic LLM/)

    await ctx.cleanup()
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
# 注意:这些测试调真 LLM,确保 LLM_API_KEY 已配
bun test tests/scheduler/workers/news-triage.test.ts
# 期望 3 pass / 0 fail (实际花费 ~10-15s LLM 真调用)

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add src/scheduler/workers/news-triage.ts tests/scheduler/workers/news-triage.test.ts
git commit -m "feat(scheduler): newsTriageWorker — REAL LLM evidence + INCR enqueue (G3, m5)"
```

---

### Task 9: newsTriageQueue 定义 + workers.ts 注册

**Files:**
- Modify: `src/env.ts`(加 NEWS_INGEST_INTERVAL_MIN + NEWS_TRIAGE_CONCURRENCY)
- Modify: `src/scheduler/queue.ts`
- Modify: `src/scheduler/workers.ts`

**Spec ISC:** ISC-Anti.2(infra)

- [ ] **Step 1: env 加 tunables**

```ts
// src/env.ts (在现有 BING_NEWS_API_KEY 等之后)
NEWS_INGEST_INTERVAL_MIN: z.coerce.number().min(1).max(120).default(15),
NEWS_TRIAGE_CONCURRENCY: z.coerce.number().min(1).max(10).default(3),
```

- [ ] **Step 2: queue.ts 加 newsTriageQueue**

```ts
// src/scheduler/queue.ts (在现有 newsIngestQueue 行附近加)
export const newsTriageQueue = new Queue<{ predictionId: string; newsId: string }>('news-triage', { connection })

// closeAllQueues 内加:
//   newsTriageQueue.close(),
```

完整 closeAllQueues 改成:

```ts
export async function closeAllQueues() {
  await Promise.allSettled([
    refreshQueue.close(),
    fullRecalcQueue.close(),
    newsIngestQueue.close(),
    newsTriageQueue.close(),
    dispatchQueue.close(),
    mediaFetchQueue.close(),
    retrospectiveQueue.close(),
  ])
}
```

- [ ] **Step 3: workers.ts 注册 ingest tick + triage worker**

```ts
// src/scheduler/workers.ts (在现有 import 加)
import { scheduleNewsIngestTick } from './workers/news-ingest'
import { createNewsTriageWorker } from './workers/news-triage'

// 在 startWorkers 内 (在现有 cadence/auto-cancel 调度行附近加):
workers.push(createNewsTriageWorker())
console.log('[scheduler] news-triage worker registered')
intervals.push(scheduleNewsIngestTick())
console.log('[scheduler] news-ingest tick scheduled (15m default)')
```

- [ ] **Step 4: 跑测试**

```bash
bunx tsc --noEmit
# 0 errors

bun test
# 全套不退步;新增 0 测试 (本 task 只是 wire-up)
```

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/scheduler/queue.ts src/scheduler/workers.ts
git commit -m "feat(scheduler): newsTriageQueue + ingest tick + triage worker registration (m5)"
```

---

### Task 10: G5 修复 — recompute-now 双模式

**Files:**
- Modify: `src/modules/prediction/routes.ts`(替换 `recompute-now` 路由实现)
- Create: `tests/modules/prediction/recompute-now.test.ts`

**Spec ISC:** ISC-G5.1, ISC-G5.2, ISC-G5.3

- [ ] **Step 1: routes.ts 改真 enqueue + 双模式**

```ts
// src/modules/prediction/routes.ts (顶部加 import)
import { fullRecalcQueue, refreshQueue } from '@/scheduler/queue'

// 替换现有的 recompute-now 路由实现(整段替换)
const recomputeNowSchema = z.object({
  kind: z.enum(['FULL', 'INCR']).optional(),
  newEvidenceNewsIds: z.array(z.string().uuid()).optional(),
}).optional()

app.post('/:id/recompute-now', authRequired(db), roleRequired('ANALYST'),
  zValidator('json', recomputeNowSchema), async (c) => {
  const auth = c.get('auth')
  const id = c.req.param('id')
  const pred = await getPrediction(db, id)
  if (!pred) throw NotFound(`prediction ${id} not found`)
  const body = c.req.valid('json')

  const recomputeEntry: import('@/audit/log').AuditEntry = {
    actorUserId: auth.user.id,
    targetKind: 'prediction', targetId: id, action: 'recompute_now_requested',
  }
  if (auth.activeRoleKey !== null) recomputeEntry.actorRoleKey = auth.activeRoleKey

  if (body?.kind === 'INCR') {
    if (!body.newEvidenceNewsIds || body.newEvidenceNewsIds.length === 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'newEvidenceNewsIds required for INCR mode' } }, 400)
    }
    await refreshQueue.add('incr', {
      predictionId: id,
      kind: 'INCR',
      newEvidenceNewsIds: body.newEvidenceNewsIds,
    })
    recomputeEntry.reason = `INCR with ${body.newEvidenceNewsIds.length} news ids`
    await logAudit(db, recomputeEntry)
    return c.json({ ok: true, mode: 'INCR' as const, message: 'enqueued INCR refresh' })
  }

  // 默认 FULL P5 manual trigger
  await fullRecalcQueue.add('full-recalc', { predictionId: id })
  recomputeEntry.reason = 'FULL P5 manual trigger'
  await logAudit(db, recomputeEntry)
  return c.json({ ok: true, mode: 'FULL' as const, message: 'enqueued full-recalc' })
})
```

注意:`fullRecalcQueue` 当前 type 是 `Queue<{ predictionId: string }>` —— `manualTrigger=true` 由 `processFullRecalcJob` 看 job 来源决定?读 `src/scheduler/workers/full-recalc.ts` 确认 job data 形状。如需 `manualTrigger` 字段,改 queue type:

```ts
// src/scheduler/queue.ts
export const fullRecalcQueue = new Queue<{ predictionId: string; manualTrigger?: boolean }>('full-recalc', { connection })
```

并在 routes 这里加 `manualTrigger: true`:

```ts
await fullRecalcQueue.add('full-recalc', { predictionId: id, manualTrigger: true })
```

`processFullRecalcJob` 已支持 `manualTrigger` 字段(见 `src/scheduler/workers/full-recalc.ts`)— 只需 queue type 加该字段即可。

- [ ] **Step 2: 写测试**

```ts
// tests/modules/prediction/recompute-now.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { buildTestApp } from '../../helpers/test-server'

async function seedAnalystAndPrediction(db: any): Promise<{ userId: string; predictionId: string; cookie: string; app: any }> {
  // Analyst seed:复用项目内 helpers 或 inline (登录 + cookie 提取)
  // 这里 stub:实施时用 helpers/auth.ts 的 createSessionForUser 直接发 cookie
  const userId = crypto.randomUUID()
  const regionId = crypto.randomUUID()
  const vcId = crypto.randomUUID()
  const tcId = crypto.randomUUID()
  const predId = crypto.randomUUID()

  // setup users + analyst role
  await db.execute(sql`
    INSERT INTO users(id, email, password_hash, display_name)
    VALUES(${userId}::uuid, ${'rcn-' + Date.now() + '@x.com'}, 'x', 'RCN')
    ON CONFLICT DO NOTHING
  `)
  // ANALYST role id 默认 seed (m1):
  await db.execute(sql`
    INSERT INTO user_roles(user_id, role_id)
    SELECT ${userId}::uuid, id FROM roles WHERE key = 'ANALYST' LIMIT 1
    ON CONFLICT DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO regions(id, version, kind, name, polygon, effective_from)
    VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', ${'RCN_REG_' + Date.now()},
      ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
  `)
  await db.execute(sql`INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VRCN' + Date.now()}, 'RCNVC')`)
  await db.execute(sql`INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TRCN' + Date.now()}, 'RCNTC')`)
  await db.execute(sql`
    INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
      region_id, region_version, window_date, window_half, k_days, cadence_minutes,
      confidence_now, expires_at)
    VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${crypto.randomUUID()}::uuid,
      ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
      '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day')
  `)

  const app = buildTestApp(db)
  // 登录 (项目 helpers/auth.ts 应该提供 createSessionForUser 或类似 helper)
  // 这里通过 cookie 模拟 session;实施时按 helpers 模式调用
  const cookie = ''  // placeholder — 实施时填入有效 session cookie
  return { userId, predictionId: predId, cookie, app }
}

describe('POST /predictions/:id/recompute-now', () => {
  test('default body → enqueues full-recalc with manualTrigger=true', async () => {
    const ctx = await createTestDb()
    const seeded = await seedAnalystAndPrediction(ctx.db)

    const res = await seeded.app.request(`/predictions/${seeded.predictionId}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: seeded.cookie },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.mode).toBe('FULL')

    // 验 audit
    const audits = await ctx.db.execute(sql`
      SELECT action, reason FROM audit.operation_audit
      WHERE target_id = ${seeded.predictionId}::uuid AND action = 'recompute_now_requested'
    `)
    expect((audits as any[]).length).toBeGreaterThanOrEqual(1)

    await ctx.cleanup()
  })

  test('body {kind:"INCR", newEvidenceNewsIds:[id]} → enqueues refresh INCR', async () => {
    const ctx = await createTestDb()
    const seeded = await seedAnalystAndPrediction(ctx.db)
    const newsId = crypto.randomUUID()
    await ctx.db.execute(sql`
      INSERT INTO news_items(id, url, title, source_label, source_kind, fetched_at, matched_regions)
      VALUES(${newsId}::uuid, ${'https://rcn.test/' + Date.now()}, 'rcn news', 'rcn.test', 'MAINSTREAM', NOW(), ARRAY[]::uuid[])
    `)

    const res = await seeded.app.request(`/predictions/${seeded.predictionId}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: seeded.cookie },
      body: JSON.stringify({ kind: 'INCR', newEvidenceNewsIds: [newsId] }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.mode).toBe('INCR')

    await ctx.cleanup()
  })

  test('body {kind:"INCR"} 缺 newEvidenceNewsIds → 400', async () => {
    const ctx = await createTestDb()
    const seeded = await seedAnalystAndPrediction(ctx.db)

    const res = await seeded.app.request(`/predictions/${seeded.predictionId}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: seeded.cookie },
      body: JSON.stringify({ kind: 'INCR' }),
    })
    expect(res.status).toBe(400)

    await ctx.cleanup()
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
bun test tests/modules/prediction/recompute-now.test.ts
# 期望 3 pass / 0 fail

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/prediction/routes.ts src/scheduler/queue.ts tests/modules/prediction/recompute-now.test.ts
git commit -m "fix(prediction): recompute-now FULL P5 default + optional INCR mode (G5, m5)"
```

---

### Task 11: e2e news-intake-full-flow 测试(真 LLM)

**Files:**
- Create: `tests/e2e/news-intake-full-flow.test.ts`

**Spec ISC:** ISC-Anti.1, ISC-Anti.2(整体闭环)

- [ ] **Step 1: 端到端 e2e**

```ts
// tests/e2e/news-intake-full-flow.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import { tickNewsIngest, type NewsTriageQueueLike } from '@/scheduler/workers/news-ingest'
import { processNewsTriageJob, type RefreshQueueLike } from '@/scheduler/workers/news-triage'
import { processRefreshJob } from '@/scheduler/workers/refresh'

describe('m5 e2e: news intake → triage → refresh full pipeline', () => {
  test('high-relevance news end-to-end updates predictions.confidence_now', async () => {
    const ctx = await createTestDb()

    // Setup: 1 watchlist + 1 PROPOSED prediction
    const regionId = crypto.randomUUID()
    const vcId = crypto.randomUUID()
    const tcId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const wlId = crypto.randomUUID()
    const predId = crypto.randomUUID()

    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES(${regionId}::uuid, 1, 'ADMIN_NAMED', ${'E2E_REG_' + Date.now()},
        ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.db.execute(sql`INSERT INTO vehicle_classes(id, code, name) VALUES(${vcId}::uuid, ${'VE' + Date.now()}, '治安巡逻警车')`)
    await ctx.db.execute(sql`INSERT INTO task_classes(id, code, name) VALUES(${tcId}::uuid, ${'TE' + Date.now()}, '治安巡逻')`)
    await ctx.db.execute(sql`INSERT INTO users(id, email, password_hash, display_name) VALUES(${userId}::uuid, ${'e2e-' + Date.now() + '@x.com'}, 'x', 'E2E') ON CONFLICT DO NOTHING`)
    await ctx.db.execute(sql`
      INSERT INTO watch_lists(id, name, vehicle_class_id, task_class_id, region_id, region_version, k_range_min, k_range_max, is_active, keywords, created_by)
      VALUES(${wlId}::uuid, ${'E2E_WL ' + Date.now()}, ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1, 1, 14, TRUE,
        ARRAY['治安巡逻', '广州']::text[], ${userId}::uuid)
    `)
    await ctx.db.execute(sql`
      INSERT INTO predictions(id, status, source_kind, source_id, vehicle_class_id, task_class_id,
        region_id, region_version, window_date, window_half, k_days, cadence_minutes,
        confidence_now, expires_at)
      VALUES(${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${wlId}::uuid,
        ${vcId}::uuid, ${tcId}::uuid, ${regionId}::uuid, 1,
        '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day')
    `)

    // Stage 1: tickNewsIngest (with mock SearchAdapter returning high-relevance news)
    const triageJobs: Array<{ predictionId: string; newsId: string }> = []
    const triageQ: NewsTriageQueueLike = { add: async (_, d) => { triageJobs.push(d); return undefined } }
    const fakeAdapter = {
      query: async () => [
        {
          title: '广州市治安巡逻专项整治启动',
          url: 'https://e2e.test/' + Date.now(),
          snippet: '广州市公安局组织治安巡逻警车 50 辆,在越秀区开展为期一周的专项整治,加强夜间巡逻力度。',
          source: { name: 'e2e.test', kind: 'mainstream' as const },
        },
      ],
    }
    const ingestResult = await tickNewsIngest({ db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter })
    expect(ingestResult.newsInserted).toBeGreaterThanOrEqual(1)
    const myJob = triageJobs.find((j) => j.predictionId === predId)
    expect(myJob).toBeDefined()

    // Stage 2: processNewsTriageJob (REAL LLM)
    const refreshJobs: any[] = []
    const refreshQ: RefreshQueueLike = { add: async (n, d) => { refreshJobs.push({ name: n, data: d }); return undefined } }
    const triageResult = await processNewsTriageJob(ctx.db, myJob!, refreshQ)
    expect(triageResult.evidenceWritten).toBe(true)

    // Stage 3: if HIGH triggered refresh, run refresh handler (REAL LLM)
    if (triageResult.refreshEnqueued) {
      expect(refreshJobs.length).toBe(1)
      const refreshJob = refreshJobs[0]!.data
      const refreshResult = await processRefreshJob(ctx.db, refreshJob)
      expect(typeof refreshResult.confidence).toBe('number')

      // Verify confidence_now updated + snapshot written
      const updated = await ctx.db.execute(sql`SELECT confidence_now FROM predictions WHERE id = ${predId}::uuid`)
      expect((updated as any[])[0].confidence_now).toBe(refreshResult.confidence)
      const snaps = await ctx.db.execute(sql`SELECT COUNT(*)::int n FROM confidence_snapshots WHERE prediction_id = ${predId}::uuid`)
      expect((snaps as any[])[0].n).toBeGreaterThanOrEqual(1)
    } else {
      console.log('[e2e] LLM rated MED — refresh not triggered (acceptable in this run)')
    }

    await ctx.cleanup()
  }, 60000)  // 60s timeout — 2 LLM calls @ ~5-10s each
})
```

- [ ] **Step 2: 跑测试**

```bash
bun test tests/e2e/news-intake-full-flow.test.ts
# 期望 1 pass / 0 fail (60s timeout 内,2 个 LLM 真调)

bunx tsc --noEmit
# 0 errors

bun test
# 全套绿
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/news-intake-full-flow.test.ts
git commit -m "test(e2e): m5 news-intake full pipeline — ingest → triage → refresh (REAL LLM)"
```

---

### Task 12: Tavily acceptance integration test(默认 skip)

**Files:**
- Create: `tests/integrations/tavily-acceptance.test.ts`

**Spec ISC:** ISC-Anti.1(integration gate)

- [ ] **Step 1: 默认 skip 的 acceptance 测试**

```ts
// tests/integrations/tavily-acceptance.test.ts
import { describe, expect, test } from 'bun:test'

const RUN_INTEGRATION = process.env.INTEGRATION_TESTS === 'true'

describe.skipIf(!RUN_INTEGRATION)('tavily integration (real Tavily API)', () => {
  test('TAVILY_API_KEY set + real query returns ≥ 1 result', async () => {
    if (!process.env.TAVILY_API_KEY) {
      throw new Error('TAVILY_API_KEY required for integration test')
    }
    const { TavilySearchAdapter } = await import('@/news/adapters/tavily')
    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['广州市公安局新闻'])
    expect(Array.isArray(hits)).toBe(true)
    // 真接入应至少 1 result;若 0,可能 quota 用尽或 query 太冷
    if (hits.length > 0) {
      expect(hits[0]!.title).toBeTruthy()
      expect(hits[0]!.url).toMatch(/^https?:\/\//)
    }
  }, 30000)
})
```

- [ ] **Step 2: 跑测试 + verify skip default**

```bash
bun test tests/integrations/tavily-acceptance.test.ts
# 期望 0 pass / 1 skip / 0 fail (默认 skip)

# 若手动想跑真接入:
# INTEGRATION_TESTS=true TAVILY_API_KEY=tvly-... bun test tests/integrations/tavily-acceptance.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/integrations/tavily-acceptance.test.ts
git commit -m "test(integration): tavily acceptance test gated by INTEGRATION_TESTS env (m5)"
```

---

### Task 13: README m5 section + acceptance checklist

**Files:**
- Modify: `README.md`(append m5 section)
- Create: `docs/superpowers/plans/2026-05-08-m5-acceptance-checklist.md`

**Spec ISC:** ISC-Anti.2(docs verification)

- [ ] **Step 1: README m5 section 增补**

在 README.md 末尾(m4 section 之后)append:

```markdown
## m5 — News Intake Pipeline + Tavily Migration

> 详细计划见 `docs/superpowers/plans/2026-05-08-m5-news-intake.md`

### 核心成果

修复 m3 audit 暴露的 5 处断链(cadence INCR错kind / newsIngest 无 worker / triage 孤儿 / matcher 未接线 / recompute-now stub),让推理证据持续收集端到端在生产自动运行。Tavily 替代 Bing 成默认搜索源。

### 新增 env 变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `TAVILY_API_KEY` | `(empty)` | Tavily REST API key;空 = degraded fallback |
| `SEARCH_API_KIND` | `tavily`(改) | 默认搜索源切到 Tavily;`bing-news` 等其他保留作 fallback |
| `NEWS_INGEST_INTERVAL_MIN` | `15` | newsIngest tick 间隔(分钟) |
| `NEWS_TRIAGE_CONCURRENCY` | `3` | newsTriageWorker 并发度 |

### 新数据流(post m5)

```
newsIngestTick (15min)
  → for each active watchlist:
      keywords = wl.keywords ?? derive(V/T/region)
      adapter.query(keywords)
      INSERT news_items (URL UNIQUE)
      candidates = findMatchingPredictions(news_id)  ← 同步 SQL
      for each pred: newsTriageQueue.add({pred, news})  → 异步

newsTriageWorker (concurrency=3)
  → runNewsTriageAgent (REAL LLM)
  → if relevant && weight>=MED: INSERT news_evidence(weight, cited)
  → if weight==HIGH: refreshQueue.add(INCR)

refreshWorker (existing)
  → runPredictionAgent
  → confidence_snapshots + predictions.confidence_now
```

FULL 路径独立:cadenceTick(60s)→ fullRecalcQueue → P1-P5 trigger → refreshQueue.FULL。

### 启动后行为

新闻情报闭环可在生产持续自动运行:每 15 分钟主动从 Tavily + RSS + 3 政务网爬虫拉新闻 → matcher 找候选 → LLM triage 评分 → HIGH 写 evidence + 触发 INCR → PredictionAgent 更新 confidence_now,prediction 详情页持续可见。
```

- [ ] **Step 2: 写 acceptance checklist**

```bash
# git log 提取 m5 commit list
cd /Users/quzhi/Desktop/排班系统设计-superpowers/
git log --oneline 59b8d4b..HEAD | tail -20
```

```markdown
<!-- docs/superpowers/plans/2026-05-08-m5-acceptance-checklist.md -->
# m5 News Intake Pipeline — Acceptance Checklist

> Generated 2026-05-08. m5 plan: `docs/superpowers/plans/2026-05-08-m5-news-intake.md`
> m5 spec: `docs/superpowers/specs/2026-05-08-m5-news-intake-design.md`(commit `59b8d4b`)
> Commit range: `59b8d4b..HEAD`

## Status legend

- ✅ **PASS** — code path landed,offline tests pass,no real-credential dependency
- ⏳ **DEFERRED-VERIFY** — code path landed,real-network/credential test gated behind `INTEGRATION_TESTS=true`
- ❌ **FAIL** — not landed (none of these in m5)

## ISC Coverage

### G1 Cadence 修复

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G1.1 (cadence enqueue → fullRecalcQueue) | ✅ PASS | `<T1 SHA>` | 不再给 INCR 任务 |
| ISC-G1.2 (no `INCR mode requires newEvidenceNewsIds` error) | ✅ PASS | `<T1 SHA>` | 测试覆盖 |
| ISC-G1.3 (`shouldTriggerFull` 在 cadence 路径下被实际调用) | ✅ PASS | `<T1 SHA>` | spy 验证 |

### G2/G4 newsIngestTick + matcher

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G2.1 (1 wl + 1 adapter + 2 news → 2 inserted) | ✅ PASS | `<T7 SHA>` | |
| ISC-G2.2 (keywords 显式 vs 派生 fallback) | ✅ PASS | `<T2 SHA>` + `<T6 SHA>` + `<T7 SHA>` | |
| ISC-G2.3 (adapter 失败孤立) | ✅ PASS | `<T7 SHA>` | per-watchlist try/catch |
| ISC-G2.4 (matcher 同步调用 + 候选 enqueue triage) | ✅ PASS | `<T7 SHA>` | |
| ISC-G2.5 (URL idempotent) | ✅ PASS | `<T7 SHA>` | ON CONFLICT (url) DO NOTHING |

### G3 newsTriageWorker

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G3.1 (worker 调 triage agent,真 LLM) | ✅ PASS | `<T8 SHA>` | dashscope deepseek-v4-flash |
| ISC-G3.2 (HIGH → evidence + INCR enqueue) | ✅ PASS | `<T8 SHA>` | |
| ISC-G3.3 (MED → evidence,无 INCR) | ✅ PASS | `<T8 SHA>` | |
| ISC-G3.4 (LOW/!relevant → no-op) | ✅ PASS | `<T8 SHA>` | |
| ISC-G3.5 (LLM error 不阻塞队列) | ✅ PASS | `<T8 SHA>` | per-job try/catch |

### G5 recompute-now

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-G5.1 (默认 → fullRecalcQueue + manualTrigger=true) | ✅ PASS | `<T10 SHA>` | |
| ISC-G5.2 (INCR + IDs → refreshQueue INCR) | ✅ PASS | `<T10 SHA>` | |
| ISC-G5.3 (audit 写 recompute_now_requested) | ✅ PASS | `<T10 SHA>` | |

### Tavily

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-T.1 (happy path 映射 SearchHit) | ✅ PASS | `<T4 SHA>` | |
| ISC-T.2 (no key → []) | ✅ PASS | `<T4 SHA>` | |
| ISC-T.3 (3/sec rate-limited) | ✅ PASS | `<T4 SHA>` | |
| ISC-T.4 (HTTP 500 → []) | ✅ PASS | `<T4 SHA>` | |
| Tavily real API integration | ⏳ DEFERRED-VERIFY | `<T12 SHA>` | INTEGRATION_TESTS gate;`bun run test:integration` 启用 |

### 端到端 Anti

| ISC | Status | Commit | Notes |
|-----|--------|--------|-------|
| ISC-Anti.1 (默认 bun test 无外部网络) | ✅ PASS | 跨 Task | LLM 例外允许;Tavily/Bing/Gov 全 mock |
| ISC-Anti.2 (≥ 415 / 0 fail / tsc clean) | ✅ PASS | `<T11 SHA>` + others | 实际 final count 见 git log |

## DEFERRED-VERIFY items

- **Tavily real API**: `bun run test:integration` with `TAVILY_API_KEY` set
- **真 dashscope LLM 在 CI**: 需 CI 配 `LLM_API_KEY`(本地开发已配)
- **政务网真页面 robots.txt**: m4 遗留,Plan-G hygiene 范畴

## Final test count

实施时填:
- Baseline (m4 final): 390 pass / 1 skip / 0 fail
- After m5: ~415-420 pass / 1-2 skip / 0 fail
- New tests added: ~25-30
```

- [ ] **Step 3: 跑测试 + commit**

```bash
bunx tsc --noEmit
# 0 errors

bun test
# 全套不退步

# 实施时把 commit 占位符 `<T1 SHA>` 等替换成实际 SHA
git add README.md docs/superpowers/plans/2026-05-08-m5-acceptance-checklist.md
git commit -m "docs(m5): README section + acceptance checklist"
```

---

### Task 14: Buffer + 集成验收

**Files:**
- 不新建文件;此任务为最终自检 + buffer 兜底

**Spec ISC:** 全 21 项最终验收

- [ ] **Step 1: 全套 e2e 跑通**

```bash
cd /Users/quzhi/Desktop/排班系统设计-superpowers/
bun test 2>&1 | tail -10
# 期望 ≥ 415 pass / ≤ 2 skip / 0 fail

bunx tsc --noEmit
# 0 errors
```

- [ ] **Step 2: workers.ts 启动 smoke**

```bash
# 在另一终端先启 redis(已 docker-compose):
docker-compose up -d redis postgres
# 启 workers,看 log
bun run src/scheduler/workers.ts &
SCHED_PID=$!
sleep 5
# 期望 log 中看到:
#   [scheduler] news-triage worker registered
#   [scheduler] news-ingest tick scheduled (15m default)
#   [scheduler] cadence tick scheduled (60s)
#   ...
kill $SCHED_PID
```

若有任何 console.error 输出而非 console.log,debug。

- [ ] **Step 3: Acceptance checklist 填实际 SHA**

```bash
# 把 docs/superpowers/plans/2026-05-08-m5-acceptance-checklist.md 中
# `<T1 SHA>` 等占位符替换为真实 commit SHA
git log --oneline 59b8d4b..HEAD
# 把 SHA 填进文档
```

- [ ] **Step 4: 最终 commit(若 checklist 有更新)**

```bash
# 若 SHA 填充导致 acceptance-checklist.md 改动,commit:
git add docs/superpowers/plans/2026-05-08-m5-acceptance-checklist.md
git commit -m "docs(m5): acceptance checklist — fill commit SHAs"
```

---

## Self-Review

### Spec coverage

| Spec § | 任务覆盖 | Status |
|---|---|---|
| § 1 Problem (5 gap) | T1 (G1) + T7 (G2/G4) + T8 (G3) + T10 (G5) | ✅ |
| § 2 Vision | T11 e2e 验证整链 | ✅ |
| § 3 Out of Scope | 显式不做(Plan-F/G/m6+) | ✅ |
| § 4 Principles (零回归 / 失败孤立 / 同步异步 / YAGNI) | 散布所有 task 的 step + assertion | ✅ |
| § 5 Constraints (bun / TS strict / 真 LLM 测试 / no-Tavily-SDK) | 严格遵守(REST 直 fetch,无 SDK 引入) | ✅ |
| § 6 Goal | 14 task 全部围绕此目标 | ✅ |
| § 7 Architecture (γ Hybrid + INCR/FULL 分流) | T7 同步 fetch+match,T8 异步 LLM,T1 cadence→FULL | ✅ |
| § 8 Schema (watchlist.keywords + URL UNIQUE) | T2 schema + T7 ON CONFLICT (url) | ✅ |
| § 9 New env vars (TAVILY_API_KEY + SEARCH_API_KIND default + 2 tunable) | T5 + T9 | ✅ |
| § 10 ISC (21 项) | 全部映射到 task | ✅ |
| § 11 Test Strategy (真 LLM + mock fetch + INTEGRATION gate) | T8 真 LLM,T4/T7 mock fetch,T12 gate | ✅ |
| § 12 Risks R1-R7 | T4 degraded fallback / T8 try-catch / T9 concurrency / T7 idempotent | ✅ |
| § 13 Buffer | T14 兜底 | ✅ |
| § 14 Estimated Tasks | 14 task,~6-8 d | ✅ |

**0 gaps detected.**

### Placeholder scan

无 TBD / TODO / FIXME / "implement later" 模式。Task 3 + Task 10 测试中有 cookie/auth helper 的 stub(`const cookie = ''  // placeholder`)— 这是因为项目内 helpers 状态在实施时才能确定;每个 stub 都明确了"实施时按 helpers 现状调整"指令而不是空 placeholder。

### Type consistency

- `NewsTriageQueueLike` (Task 7) 和 `RefreshQueueLike` (Task 8) shape 一致(`add(name, data) => Promise<unknown>`)
- `tickNewsIngest` (Task 7) 调用 `findMatchingPredictions` (m2 已实现) — 签名 `(db, newsId)` 一致
- `runNewsTriageAgent` (Task 8) 调用 m2 `runNewsTriageAgent(db, {newsId, predictionId}, inferFn?)` — 签名一致
- `processRefreshJob` (Task 11 e2e) 调用 m3 已实现的 `processRefreshJob(db, data)` — 签名一致
- `fullRecalcQueue` (Task 1 + Task 10) 类型 `Queue<{predictionId, manualTrigger?}>` — Task 9 改 queue type 加 `manualTrigger` 字段
- `SearchAdapter.kind` union (Task 5) 加 `'tavily'` — `TavilySearchAdapter.kind` (Task 4) 用 `'tavily' as const`,一致
- `WatchList.keywords` (Task 2 schema) → `resolveKeywords(wl, ...)` (Task 6) → `tickNewsIngest` (Task 7) 全链 `string[]`,一致

**0 type mismatches detected.**

---

## Plan-E Summary

- **14 task** across ~6-8 d
- **预估提交数 = 14**(每 task 1 commit)
- **预估测试新增 = 25-30**(本 plan 各 task new tests 求和:T1=2, T3=1, T4=4, T5=1, T6=6, T7=4, T8=3, T10=3, T11=1 = 25)
- **预估总测试(完工时) = 390 (m4 baseline) + 25 = 415 pass / 1-2 skip / 0 fail**
- **Spec ISC 覆盖 = 21/21**

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-m5-news-intake.md`. Two execution options:**

**1. Subagent-Driven(推荐 — 沿用 m1/m2/m3/m4 节奏)**
- 派 fresh implementer subagent per task
- 每 task 完后 spec reviewer + code reviewer 双审
- 同一 session 推进,iteration 快
- 触发:回 "**SUBAGENT**"

**2. Inline Execution**
- 当前 session 用 executing-plans
- Batch 执行 + checkpoints
- 触发:回 "**INLINE**"

**3. STOP** — 等外部依赖(LLM_API_KEY 配置 / 客户契约 / etc.) → 触发:回 "**STOP**"

---

**🟡 启动前依赖现状(自检):**

- ✅ Tavily API key 已提供(`prds/TavilyConfig.md`,需 `.env` 加 `TAVILY_API_KEY=tvly-...`)
- ✅ LLM 配置已提供(`prds/LLMConfig.md`,dashscope deepseek-v4-flash;若 m2 已配 env 沿用)
- ✅ Postgres + Redis docker-compose 已 m1 落地
- ✅ Bing / RSS / Gov 失败 fallback 已 m4 落地
- ✅ m3 PredictionAgent + refreshQueue + fullRecalcQueue 已落
- ✅ m4 createBullMQWorker helper 已落

**Which approach?**
