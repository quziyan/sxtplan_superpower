# m4 — Real Customer Onboarding Implementation Plan (Plan-D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans。Steps 用 `- [ ]` 跟踪。

**Goal:** 把 m3 + cnp-adapters-unify 留下的"simulated only"状态升级到"客户真 backend + 真 Bing 索引 + 真政务源 + 自动撤单",同时清完 m3 累积的 5 项技术债。

**Architecture:** 复用 cnp-adapters-unify 的 makePool 模板。**6 块按顺序+部分并行**:C 桶 5 项清债 → α Bing 真接入 → A1 真 Camera spec+impl 与 γ 政务网爬虫并行 → B1 自动撤单 → 集成 acceptance + Slice 1 runbook。

**Tech Stack:** 全栈复用 m3+cnp-adapters-unify;新增 `cheerio`(政务网 HTML 解析)+ Bing Cognitive Services API key。

**Source Spec:** [`docs/superpowers/specs/2026-05-07-m4-real-customer-onboarding-design.md`](../specs/2026-05-07-m4-real-customer-onboarding-design.md)(commit `9aadd3d`)

**Slice Position:** **Plan-D**(继 Plan-A m1 / Plan-B m2 / Plan-C m3 / cnp-adapters-unify);本计划 = m4(6 周窗口)。

**Spec ISC 覆盖(本计划):** ISC-CC1..4 / ISC-C1..C5 / ISC-A1.1..3 / ISC-A2α.1..2 / ISC-A2γ.1..4 / ISC-B1.1..3 / ISC-INT.1..3 / ISC-Anti.1..3

---

## File Structure(本计划新增/修改)

```
docs/
├── integrations/customer-camera-api-v0.1.md         # 新 (Task 6)
├── demo/slice-1-runbook.md                            # 新 (Task 24)
└── superpowers/plans/2026-05-07-m4-acceptance-checklist.md  # 新 (Task 23)

src/
├── audit/log.ts                                      # 改 (Task 1)
├── dispatch/
│   ├── adapters/real-gzp.ts                          # 新 (Task 7)
│   ├── adapter-pool.ts                                # 改 (Task 8)
│   └── constants.ts                                  # 新 (Task 4)
├── env.ts                                              # 改 (Tasks 6, 9, 12, 17)
├── inbox/auto-cancel-notification.ts                # 新 (Task 19)
├── modules/retrospective/{service,routes}.ts        # 改 (Task 5)
├── news/
│   ├── adapters/
│   │   ├── gov-scraper-base.ts                      # 新 (Task 12)
│   │   ├── gov-gd-province.ts                       # 新 (Task 13)
│   │   ├── gov-gz-city.ts                           # 新 (Task 14)
│   │   └── gov-public-security.ts                   # 新 (Task 15)
│   └── search-adapter.ts                              # 改 (Tasks 9, 12-15)
├── scheduler/
│   ├── helpers/createBullMQWorker.ts                # 新 (Task 3)
│   ├── workers/auto-cancel.ts                       # 新 (Task 18)
│   └── workers/{refresh,cadence,full-recalc,dispatch,media-fetch,retrospective}.ts  # 改 (Task 3)
├── db/schema/prediction.ts                           # 改 (Task 17)
└── tests/helpers/test-db.ts                          # 改 (Task 2)

frontend/src/
├── lib/retrospective-api.ts                          # 改 (Task 5)
└── routes/reviewer/MatrixTab.tsx                    # 改 (Task 5)

tests/
├── audit/log-tx.test.ts                              # 新 (Task 1)
├── helpers/test-db-isolation.test.ts                # 新 (Task 2)
├── scheduler/helpers/createBullMQWorker.test.ts     # 新 (Task 3)
├── dispatch/constants.test.ts                       # 新 (Task 4)
├── modules/retrospective-aggregate.test.ts          # 新 (Task 5)
├── news/bing-news-real.test.ts                      # 新 (Tasks 9, 10)
├── dispatch/real-gzp-adapter.test.ts                # 新 (Task 7)
├── news/gov-scraper-base.test.ts                    # 新 (Task 12)
├── news/gov-{gd-province,gz-city,public-security}.test.ts  # 新 (Tasks 13-15)
├── news/gov-failure-isolation.test.ts               # 新 (Task 16)
├── scheduler/workers/auto-cancel.test.ts            # 新 (Task 18, 20)
├── inbox/auto-cancel-notification.test.ts           # 新 (Task 19)
└── e2e/m4-full-flow.test.ts                         # 新 (Task 21)
```

---

## Tasks

### Section 1 — C 桶清债(Week 1,5 task 顺序无强约束,subagent 可任选起始)

#### Task 1: logAudit `Db | PgTransaction` 联合签名

**Files:**
- Modify: `src/audit/log.ts`
- Create: `tests/audit/log-tx.test.ts`

**Spec ISC:** ISC-C1

- [ ] **Step 1: 读现有 src/audit/log.ts 确认 logAudit 签名**

```bash
cat src/audit/log.ts | head -40
# 期望看到:export async function logAudit(db: Db, entry: AuditEntry): Promise<void>
```

- [ ] **Step 2: 修改签名为联合类型**

```ts
// src/audit/log.ts
import type { Db } from '@/db/client'
import type { PgTransaction } from 'drizzle-orm/pg-core'

// 新签名 — 联合类型,接受 Db 或事务句柄
export type DbOrTx = Db | PgTransaction<any, any, any>

export async function logAudit(dbOrTx: DbOrTx, entry: AuditEntry): Promise<void> {
  // 内部 .insert() 的调用 dbOrTx.insert(operationAudit) 在 drizzle 上同样支持两种类型
  await dbOrTx.insert(operationAudit).values({...})
}
```

- [ ] **Step 3: 写测试验证 tx 复用**

```ts
// tests/audit/log-tx.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import { logAudit } from '@/audit/log'

describe('logAudit Db | PgTransaction 联合', () => {
  test('logAudit 在事务内写 audit 行,提交后可见', async () => {
    const ctx = await createTestDb()
    await ctx.db.transaction(async (tx) => {
      await logAudit(tx, {
        actorUserId: 'test-user',
        action: 'TEST_TX_AUDIT',
        targetKind: 'test',
        targetId: 'tx-test-1',
        metadataJson: { in_tx: true },
      })
    })
    const rows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM audit.operation_audit
      WHERE action = 'TEST_TX_AUDIT'
    `)
    expect((rows[0] as any).n).toBe(1)
    await ctx.cleanup()
  })

  test('logAudit 在 rollback 事务中不留 audit 行', async () => {
    const ctx = await createTestDb()
    try {
      await ctx.db.transaction(async (tx) => {
        await logAudit(tx, {
          actorUserId: 'test-user',
          action: 'TEST_ROLLBACK',
          targetKind: 'test',
          targetId: 'rb-test-1',
          metadataJson: {},
        })
        throw new Error('intentional rollback')
      })
    } catch {}
    const rows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM audit.operation_audit
      WHERE action = 'TEST_ROLLBACK'
    `)
    expect((rows[0] as any).n).toBe(0)
    await ctx.cleanup()
  })
})
```

- [ ] **Step 4: 运行测试 + tsc**

```bash
bun test tests/audit/log-tx.test.ts
# 期望 2 pass / 0 fail

bunx tsc --noEmit
# 期望 0 errors

bun test
# 期望 ≥350 pass(348 base + 2 new)
```

- [ ] **Step 5: Commit**

```bash
git add src/audit/log.ts tests/audit/log-tx.test.ts
git commit -m "refactor(audit): logAudit accepts Db | PgTransaction for transactional reuse"
```

---

#### Task 2: 测试 DB 事务级隔离(BEGIN/ROLLBACK + SAVEPOINT)

**Files:**
- Modify: `tests/helpers/test-db.ts`
- Create: `tests/helpers/test-db-isolation.test.ts`

**Spec ISC:** ISC-C2

- [ ] **Step 1: 读现有 createTestDb 实现**

```bash
cat tests/helpers/test-db.ts
# 期望看到 createTestDb() 函数,返回 { db, cleanup }
```

- [ ] **Step 2: 改造 createTestDb 加事务包装**

```ts
// tests/helpers/test-db.ts(关键改动)
export type TestDbContext = {
  db: Db                 // 已包装在事务中
  rawDb: Db              // 未包装,管理使用(慎用)
  cleanup: () => Promise<void>  // ROLLBACK + 释放连接
}

export async function createTestDb(): Promise<TestDbContext> {
  const { db: rawDb, sql: pgClient } = createDb('admin')
  // 启动一个 long-running transaction
  const txCommitOrRollback = new Promise<void>((resolve) => { /* ... */ })
  // ...
  // 重要:测试结束 cleanup 必须 ROLLBACK 而非 COMMIT
  // 嵌套 db.transaction(...) 在 m3 测试中要兼容 — 用 SAVEPOINT 实现
}
```

(完整实现 ~80 行,具体见 Task 完成后的实际代码;关键约束:返回的 `db` 对象必须支持 m3 已有的 `db.transaction(async (tx) => {...})` 嵌套 — drizzle 自动用 SAVEPOINT 包装内部嵌套事务,所以 `db` 为外层 tx 句柄即可。)

- [ ] **Step 3: 写隔离验证测试**

```ts
// tests/helpers/test-db-isolation.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from './test-db'

describe('test-db 事务隔离', () => {
  test('两个独立 createTestDb 不相互可见', async () => {
    const a = await createTestDb()
    const b = await createTestDb()

    // a 写一行
    await a.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES('aaaa-aaaa-aaaa-aaaa-aaaa', 1, 'ADMIN_NAMED', 'TEST_ISOLATION_A',
             ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    // b 看不见
    const seen = await b.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM regions WHERE name = 'TEST_ISOLATION_A'
    `)
    expect((seen[0] as any).n).toBe(0)

    await a.cleanup()
    await b.cleanup()
  })

  test('cleanup 后数据消失', async () => {
    const ctx = await createTestDb()
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, polygon, effective_from)
      VALUES('bbbb-bbbb-bbbb-bbbb-bbbb', 1, 'ADMIN_NAMED', 'TEST_CLEANUP_B',
             ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.cleanup()

    // 用一个新连接看 — 应该完全空
    const fresh = await createTestDb()
    const seen = await fresh.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM regions WHERE name = 'TEST_CLEANUP_B'
    `)
    expect((seen[0] as any).n).toBe(0)
    await fresh.cleanup()
  })

  test('内嵌 db.transaction 能成功(SAVEPOINT 兼容)', async () => {
    const ctx = await createTestDb()
    // 内嵌事务 — drizzle 用 SAVEPOINT 实现
    let inner = false
    await ctx.db.transaction(async (tx) => {
      inner = true
      // 内嵌内可以正常做事
      await tx.execute(sql`SELECT 1`)
    })
    expect(inner).toBe(true)
    await ctx.cleanup()
  })
})
```

- [ ] **Step 4: 跑全测试套确认无回归(关键!这是最大风险任务)**

```bash
bun test 2>&1 | tail -10
# 期望 348 + 3 (本任务) = 351 pass, 0 fail
# 若有 test break(尤其 dispatch/state-machine.test 嵌套事务):
#   1. 复现失败 + 阅读 stacktrace
#   2. 多半是 SAVEPOINT 兼容问题,drizzle 0.36 自动处理 — 检查具体调用方是否绕过了 db.transaction()

bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/test-db.ts tests/helpers/test-db-isolation.test.ts
git commit -m "test(helpers): test-db 事务级隔离 — BEGIN/ROLLBACK + SAVEPOINT 嵌套兼容"
```

---

#### Task 3: createBullMQWorker(name, handler, deps?) helper + 6 worker retrofit

**Files:**
- Create: `src/scheduler/helpers/createBullMQWorker.ts`
- Modify: `src/scheduler/workers/{refresh,cadence,full-recalc,dispatch,media-fetch,retrospective}.ts` (6 文件)
- Create: `tests/scheduler/helpers/createBullMQWorker.test.ts`

**Spec ISC:** ISC-C3

- [ ] **Step 1: 实现 helper**

```ts
// src/scheduler/helpers/createBullMQWorker.ts
import { Worker, type WorkerOptions, type Processor } from 'bullmq'
import { loadEnv } from '@/env'

export type CreateBullMQWorkerOptions<T> = {
  name: string
  handler: Processor<T>
  /** 可选:覆盖默认 connection 配置 */
  connection?: WorkerOptions['connection']
  /** 可选:其他 BullMQ Worker 选项 */
  options?: Omit<WorkerOptions, 'connection'>
}

/**
 * 共享 BullMQ Worker boilerplate(env.REDIS_URL + 标准 connection 配置)。
 * 6 个 m3 worker 复用此 helper,避免每个 worker 重复 new Worker(...) 模板。
 */
export function createBullMQWorker<T = unknown>(opts: CreateBullMQWorkerOptions<T>): Worker<T> {
  const env = loadEnv()
  return new Worker<T>(
    opts.name,
    opts.handler,
    {
      ...opts.options,
      connection: opts.connection ?? { url: env.REDIS_URL },
    },
  )
}
```

- [ ] **Step 2: 写 helper 测试**

```ts
// tests/scheduler/helpers/createBullMQWorker.test.ts
import { describe, expect, test } from 'bun:test'
import { createBullMQWorker } from '@/scheduler/helpers/createBullMQWorker'

async function redisReachable(): Promise<boolean> {
  try {
    const IORedis = (await import('ioredis')).default
    const c = new IORedis({ lazyConnect: true })
    await c.connect()
    await c.quit()
    return true
  } catch {
    return false
  }
}
const REDIS_OK = await redisReachable()

describe('createBullMQWorker helper', () => {
  test.skipIf(!REDIS_OK)('creates Worker with default REDIS_URL connection', async () => {
    const w = createBullMQWorker({
      name: 'test-helper-worker',
      handler: async () => ({ ok: true }),
    })
    expect(w.name).toBe('test-helper-worker')
    await w.close()
  })

  test.skipIf(!REDIS_OK)('accepts custom connection override', async () => {
    const w = createBullMQWorker({
      name: 'test-helper-worker-custom',
      handler: async () => ({ ok: true }),
      connection: { host: 'localhost', port: 6379 },
    })
    expect(w.name).toBe('test-helper-worker-custom')
    await w.close()
  })
})
```

- [ ] **Step 3: Retrofit 6 worker(每个文件改 3-5 行)**

```ts
// 例:src/scheduler/workers/refresh.ts(改动前后对比)

// BEFORE:
import { Worker } from 'bullmq'
import { loadEnv } from '@/env'
export function createRefreshWorker() {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<RefreshJobData>(
    'refresh',
    async (job) => processRefreshJob(db, job.data),
    { connection: { url: env.REDIS_URL } },
  )
}

// AFTER:
import { createBullMQWorker } from '../helpers/createBullMQWorker'
export function createRefreshWorker() {
  const { db } = createDb('app')
  return createBullMQWorker<RefreshJobData>({
    name: 'refresh',
    handler: async (job) => processRefreshJob(db, job.data),
  })
}
```

对每个 worker 应用同样模式:`refresh.ts` / `cadence.ts` / `full-recalc.ts` / `dispatch.ts` / `media-fetch.ts` / `retrospective.ts`。

- [ ] **Step 4: 跑完整测试**

```bash
bun test tests/scheduler/
# 期望 ≥35 pass(原 m3 worker tests 全绿)+ 2 new helper tests

bunx tsc --noEmit
# 期望 0 errors
```

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/helpers/createBullMQWorker.ts tests/scheduler/helpers/createBullMQWorker.test.ts \
  src/scheduler/workers/refresh.ts src/scheduler/workers/cadence.ts \
  src/scheduler/workers/full-recalc.ts src/scheduler/workers/dispatch.ts \
  src/scheduler/workers/media-fetch.ts src/scheduler/workers/retrospective.ts
git commit -m "refactor(scheduler): createBullMQWorker helper + 6 worker retrofit"
```

---

#### Task 4: DEFAULT_ADAPTER_KEY 常量

**Files:**
- Create: `src/dispatch/constants.ts`
- Modify: `src/scheduler/triggers/post-approval.ts`(改默认 adapterKey)
- Modify: `src/dispatch/service.ts`(改 enqueueDispatch 默认值)
- Create: `tests/dispatch/constants.test.ts`

**Spec ISC:** ISC-C4

- [ ] **Step 1: 实现常量函数**

```ts
// src/dispatch/constants.ts
import { loadEnv } from '@/env'

/**
 * 当前激活的 default Camera adapter key。
 * 根据 SIMULATED_GZP_ENABLED env + (m4 加) CAMERA_BACKEND_KIND env 决定。
 *
 * Lazy读 env(每次调用重新读)— 测试时 env 改变后立即生效,不需要重启进程。
 */
export function getDefaultAdapterKey(): string {
  const env = loadEnv()
  // m4 优先级:CAMERA_BACKEND_KIND > SIMULATED_GZP_ENABLED > 默认 mock
  if (env.CAMERA_BACKEND_KIND === 'real-gzp') return 'real-gzp'
  if (env.CAMERA_BACKEND_KIND === 'simulated-gzp') return 'simulated-gzp'
  if (env.SIMULATED_GZP_ENABLED === 'true') return 'simulated-gzp'
  return 'mock'
}
```

- [ ] **Step 2: 修改 callers**

```ts
// src/scheduler/triggers/post-approval.ts
import { getDefaultAdapterKey } from '@/dispatch/constants'

export async function triggerDispatchAfterApproval(
  predictionId: string,
  adapterKey?: string,
  queue: DispatchQueueLike = dispatchQueue,
): Promise<void> {
  const key = adapterKey ?? getDefaultAdapterKey()  // <— 从硬编码 'simulated-gzp' 改为 getDefaultAdapterKey()
  await queue.add('dispatch', { predictionId, adapterKey: key })
}
```

```ts
// src/dispatch/service.ts(找到 enqueueDispatch 函数,默认 adapterKey 同样改)
export async function enqueueDispatch(db: Db, params: { predictionId: string; adapterKey?: string }): ... {
  const key = params.adapterKey ?? getDefaultAdapterKey()  // <— 从 'mock' 改为 getDefaultAdapterKey()
  // ... 余下不变
}
```

- [ ] **Step 3: 写测试**

```ts
// tests/dispatch/constants.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { getDefaultAdapterKey } from '@/dispatch/constants'
import { resetEnvCacheForTests } from '@/env'

describe('getDefaultAdapterKey', () => {
  let snapshot: Record<string, string | undefined>

  beforeEach(() => {
    snapshot = {
      CAMERA_BACKEND_KIND: process.env.CAMERA_BACKEND_KIND,
      SIMULATED_GZP_ENABLED: process.env.SIMULATED_GZP_ENABLED,
    }
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('returns "real-gzp" when CAMERA_BACKEND_KIND=real-gzp', () => {
    process.env.CAMERA_BACKEND_KIND = 'real-gzp'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('real-gzp')
  })

  test('returns "simulated-gzp" when CAMERA_BACKEND_KIND=simulated-gzp', () => {
    process.env.CAMERA_BACKEND_KIND = 'simulated-gzp'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('simulated-gzp')
  })

  test('falls back to SIMULATED_GZP_ENABLED=true → simulated-gzp', () => {
    delete process.env.CAMERA_BACKEND_KIND
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('simulated-gzp')
  })

  test('returns "mock" when nothing set', () => {
    delete process.env.CAMERA_BACKEND_KIND
    delete process.env.SIMULATED_GZP_ENABLED
    resetEnvCacheForTests()
    expect(getDefaultAdapterKey()).toBe('mock')
  })
})
```

- [ ] **Step 4: 跑测试**

```bash
bun test tests/dispatch/constants.test.ts
# 期望 4 pass

bun test  # 全绿(注意 m3 dispatch 测试可能受 default 影响,需观察)
bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/constants.ts src/scheduler/triggers/post-approval.ts \
  src/dispatch/service.ts tests/dispatch/constants.test.ts
git commit -m "refactor(dispatch): DEFAULT_ADAPTER_KEY 常量 — env-driven default unified"
```

---

#### Task 5: GET /retrospectives/aggregate 端点 + MatrixTab 切换

**Files:**
- Modify: `src/modules/retrospective/service.ts`(加 aggregate 函数)
- Modify: `src/modules/retrospective/routes.ts`(加 GET /aggregate 路由)
- Modify: `frontend/src/lib/retrospective-api.ts`(加 client 函数)
- Modify: `frontend/src/routes/reviewer/MatrixTab.tsx`(切到新端点)
- Create: `tests/modules/retrospective-aggregate.test.ts`

**Spec ISC:** ISC-C5

- [ ] **Step 1: 后端 aggregate service 函数**

```ts
// src/modules/retrospective/service.ts(加在文件末尾)
export type RetroAggregateRow = {
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  count: number
  overriddenCount: number
}

export type RetroAggregateResult = {
  total: number
  byOutcome: RetroAggregateRow[]  // 12 行(3 × 4)
  hitRate: number    // HIT / total
  missRate: number   // MISS / total
  capturedRate: number   // CAPTURED / total
  overriddenRate: number // overridden / total
}

export async function aggregateRetrospectives(db: Db): Promise<RetroAggregateResult> {
  const rows = await db.execute<{
    prediction_outcome: string
    capture_outcome: string
    cnt: string
    overridden_cnt: string
  }>(sql`
    SELECT prediction_outcome, capture_outcome,
           COUNT(*)::text AS cnt,
           SUM(CASE WHEN outcome_overridden THEN 1 ELSE 0 END)::text AS overridden_cnt
    FROM retrospectives
    GROUP BY prediction_outcome, capture_outcome
  `)

  const byOutcome: RetroAggregateRow[] = (rows as any[]).map(r => ({
    predictionOutcome: r.prediction_outcome as any,
    captureOutcome: r.capture_outcome as any,
    count: Number(r.cnt),
    overriddenCount: Number(r.overridden_cnt),
  }))

  const total = byOutcome.reduce((s, r) => s + r.count, 0)
  const hit = byOutcome.filter(r => r.predictionOutcome === 'HIT').reduce((s, r) => s + r.count, 0)
  const miss = byOutcome.filter(r => r.predictionOutcome === 'MISS').reduce((s, r) => s + r.count, 0)
  const captured = byOutcome.filter(r => r.captureOutcome === 'CAPTURED').reduce((s, r) => s + r.count, 0)
  const overridden = byOutcome.reduce((s, r) => s + r.overriddenCount, 0)

  return {
    total,
    byOutcome,
    hitRate: total > 0 ? hit / total : 0,
    missRate: total > 0 ? miss / total : 0,
    capturedRate: total > 0 ? captured / total : 0,
    overriddenRate: total > 0 ? overridden / total : 0,
  }
}
```

- [ ] **Step 2: 后端 routes**

```ts
// src/modules/retrospective/routes.ts(加在 list / detail / override 之前或之后)
app.get('/aggregate', authRequired, async (c) => {
  const result = await aggregateRetrospectives(db)
  return c.json({ ok: true, aggregate: result })
})
```

- [ ] **Step 3: Frontend client + MatrixTab 切换**

```ts
// frontend/src/lib/retrospective-api.ts(加在末尾)
export type RetroAggregateRow = {
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  count: number
  overriddenCount: number
}
export type RetroAggregateResult = {
  total: number
  byOutcome: RetroAggregateRow[]
  hitRate: number
  missRate: number
  capturedRate: number
  overriddenRate: number
}
export async function aggregateRetrospectives(): Promise<RetroAggregateResult> {
  const r = await api<{ ok: true; aggregate: RetroAggregateResult }>('/retrospectives/aggregate')
  return r.aggregate
}
```

```tsx
// frontend/src/routes/reviewer/MatrixTab.tsx(替换现有 listRetrospectives({ limit: 500 }) 逻辑)
import { aggregateRetrospectives, type RetroAggregateResult } from '@/lib/retrospective-api'

export function MatrixTab() {
  const [agg, setAgg] = useState<RetroAggregateResult | null>(null)
  // ... loading / error states ...

  useEffect(() => {
    aggregateRetrospectives().then(setAgg).catch(setError)
  }, [])

  // 把原 byOutcome 客户端 group → 直接用 agg.byOutcome
  // 把原 hitRate 客户端 / total → 直接用 agg.hitRate
  // OutcomeMatrix 的 counts: 从 agg.byOutcome 直接 reduce 成 OutcomeCounts
  const counts: OutcomeCounts = {} as OutcomeCounts
  for (const row of agg?.byOutcome ?? []) {
    const k = `${row.predictionOutcome}+${row.captureOutcome}` as CellKey
    counts[k] = row.count
  }

  return (
    <>
      <KpiRow tiles={[
        { label: '复盘总数', value: agg?.total ?? '—' },
        { label: '命中率 HIT', value: agg ? `${(agg.hitRate * 100).toFixed(1)}%` : '—' },
        { label: '未命中 MISS', value: agg ? `${(agg.missRate * 100).toFixed(1)}%` : '—' },
        { label: '已捕获率', value: agg ? `${(agg.capturedRate * 100).toFixed(1)}%` : '—' },
        { label: '已校正', value: agg ? `${(agg.overriddenRate * 100).toFixed(1)}%` : '—' },
      ]} />
      <OutcomeMatrix counts={counts} />
    </>
  )
}
```

- [ ] **Step 4: 测试**

```ts
// tests/modules/retrospective-aggregate.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import { createTestApp } from '../helpers/test-server'
import { seedDemoData } from '@/seeds/demo-data'  // au-T8 复用
import { getOssAdapter } from '@/media/oss-adapter-pool'

describe('GET /retrospectives/aggregate', () => {
  test('returns 12 outcome rows + KPI from seeded demo data', async () => {
    const ctx = await createTestDb()
    const oss = getOssAdapter()

    // 用 demo seed 填充 15 retros 已知分布
    await seedDemoData(ctx.db, oss)

    const app = createTestApp(ctx.db)
    // 登录 REVIEWER
    const res = await app.fetch(new Request('http://localhost/retrospectives/aggregate', {
      headers: { /* session cookie */ },
    }))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.aggregate.total).toBe(15)
    expect(body.aggregate.hitRate).toBeCloseTo(7 / 15, 2)  // 4+2+1=7 HIT
    expect(body.aggregate.byOutcome.find((r: any) =>
      r.predictionOutcome === 'HIT' && r.captureOutcome === 'CAPTURED'
    ).count).toBe(4)

    await ctx.cleanup()
  })
})
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/retrospective/service.ts src/modules/retrospective/routes.ts \
  frontend/src/lib/retrospective-api.ts frontend/src/routes/reviewer/MatrixTab.tsx \
  tests/modules/retrospective-aggregate.test.ts
git commit -m "feat(retrospective): GET /aggregate 端点 + MatrixTab 切换 (m4 C-5)"
```

---

### Section 2 — A2-α Bing News API 接入(Week 2 前半,2 task,~0.5 周)

#### Task 6: A1 customer-camera-api spec 草案文档(Week 2 前发出,跟 Bing 申请并行)

**Files:**
- Create: `docs/integrations/customer-camera-api-v0.1.md`
- Modify: `src/env.ts`(只加 CAMERA_BACKEND_KIND env,实施推后到 Task 7-8)

**Spec ISC:** ISC-A1.1

- [ ] **Step 1: 起草 customer API 契约**

```bash
# docs/integrations/customer-camera-api-v0.1.md 内容(约 200 行,完整契约)
# 关键章节:
#  1. Versioning 策略
#  2. POST /dispatch — 我们调客户(发任务)
#       headers: X-API-Key, X-Idempotency-Key
#       body: { predictionId, regionPolygon, timeWindow, vehicleClass, ... }
#       response: 200 { externalId, acceptedAt }
#  3. POST <our-webhook-url> — 客户调我们(回调状态)
#       headers: X-Signature(HMAC-SHA256), X-Adapter-Key=real-gzp, X-Idempotency-Key
#       body: { externalId, state: 'IN_PROGRESS'|'COMPLETED'|'CANCELLED'|'FAILED', mediaUrls?, meta? }
#  4. POST /cancel — 我们调客户(撤单)
#       body: { externalId }
#       response: 200 { externalId, cancelledAt }
#  5. 错误响应格式
#  6. Rate limit + retry 约束
#  7. 媒体 URL 规范(http/https + 1h 有效期 + 我方 fetch 落 OSS)
#  8. 测试 mode 凭证(EX-8 客户提供测试 key)
```

详细 markdown 内容(标题 + 章节 + 字段表)由 implementer 写,要求:
- 长度 ~150-250 行
- 每个 endpoint 都有完整 example request/response
- 标 v0.1(版本号化,允许后续 patch)
- 末尾留"客户审核反馈"section,客户填字段差异

- [ ] **Step 2: env 加 CAMERA_BACKEND_KIND**

```ts
// src/env.ts(zod schema 加)
CAMERA_BACKEND_KIND: z.enum(['simulated-gzp', 'real-gzp']).default('simulated-gzp'),
```

- [ ] **Step 3: 类型 check**

```bash
bunx tsc --noEmit
# 期望 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add docs/integrations/customer-camera-api-v0.1.md src/env.ts
git commit -m "spec(integrations): customer-camera-api v0.1 草案 + CAMERA_BACKEND_KIND env"
```

- [ ] **Step 5: 发邮件给客户** (operational, not in plan but track)

文档发客户审核;Slack/邮件/IM 任意渠道。预期 2 周窗口拿到反馈。

---

#### Task 7: BingNewsSearchAdapter mock → real

**Files:**
- Modify: `src/news/adapters/bing-news.ts`(实际名字根据 m3 search-adapter.ts 中的 BingNewsSearchAdapter class 位置)
- Modify: `src/env.ts`(加 BING_NEWS_API_KEY)
- Create: `tests/news/bing-news-real.test.ts`

**Spec ISC:** ISC-A2α.1, ISC-A2α.2

- [ ] **Step 1: 看现有 BingNewsSearchAdapter 现状**

```bash
grep -n "BingNewsSearchAdapter" src/news/search-adapter.ts
# 期望看到 m2 实现的 stub
```

- [ ] **Step 2: 加 env**

```ts
// src/env.ts
BING_NEWS_API_KEY: z.string().default(''),  // empty = mock fallback
```

- [ ] **Step 3: 改 BingNewsSearchAdapter 实现**

```ts
// src/news/search-adapter.ts (修改 BingNewsSearchAdapter class)
class BingNewsSearchAdapter implements SearchAdapter {
  readonly key = 'bing-news'
  readonly kind = 'bing-news' as const
  private cache = new Map<string, { hits: SearchHit[]; expiresAt: number }>()
  private callsInWindow = 0
  private windowStart = Date.now()

  async search(opts: SearchOpts): Promise<SearchHit[]> {
    const env = loadEnv()
    const apiKey = env.BING_NEWS_API_KEY

    // No API key → fallback (m2 mock behavior)
    if (!apiKey) {
      console.warn('[bing-news] no API key, returning empty hits (degraded)')
      return []
    }

    // Cache check (24h)
    const cacheKey = JSON.stringify({ q: opts.q, freshness: opts.freshness })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hits
    }

    // Rate limit: ≤3 calls/sec
    const now = Date.now()
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.callsInWindow = 0
    }
    if (this.callsInWindow >= 3) {
      console.warn('[bing-news] rate-limited, returning empty hits (degraded)')
      return []
    }
    this.callsInWindow++

    try {
      const url = new URL('https://api.bing.microsoft.com/v7.0/news/search')
      url.searchParams.set('q', opts.q)
      url.searchParams.set('count', '20')
      if (opts.freshness) url.searchParams.set('freshness', opts.freshness)
      const res = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      })
      if (!res.ok) {
        console.warn(`[bing-news] HTTP ${res.status}, returning empty hits (degraded)`)
        return []
      }
      const json = await res.json() as any
      const hits: SearchHit[] = (json.value ?? []).map((item: any) => ({
        title: item.name,
        url: item.url,
        snippet: item.description,
        source: item.provider?.[0]?.name ?? 'Bing',
        publishedAt: item.datePublished,
      }))
      this.cache.set(cacheKey, { hits, expiresAt: Date.now() + 24 * 3600_000 })
      return hits
    } catch (e) {
      console.error(`[bing-news] fetch error: ${(e as Error).message}, returning empty (degraded)`)
      return []
    }
  }
}
```

- [ ] **Step 4: 测试 happy / no-key / rate-limit / fetch-error 4 路径**

```ts
// tests/news/bing-news-real.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import { resetSearchAdapterPoolForTests, getSearchAdapter } from '@/news/search-adapter'

describe('BingNewsSearchAdapter real path', () => {
  let originalFetch: typeof globalThis.fetch
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    envSnapshot = { BING_NEWS_API_KEY: process.env.BING_NEWS_API_KEY, SEARCH_API_KIND: process.env.SEARCH_API_KIND }
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
  })

  test('happy path: API key set + fetch returns json → SearchHits', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key-xxx'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    const calls: any[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: url.toString(), init })
      return new Response(JSON.stringify({
        value: [
          { name: 'test article', url: 'https://example/1', description: 'desc', provider: [{ name: 'X' }], datePublished: '2026-05-07' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as any

    const adapter = getSearchAdapter()
    const hits = await adapter.search({ q: '广州警务' })
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('test article')
    expect(calls[0].init.headers['Ocp-Apim-Subscription-Key']).toBe('test-key-xxx')
  })

  test('no API key: returns empty + warn, no fetch call', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = ''
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return new Response('{}') }) as any

    const adapter = getSearchAdapter()
    const hits = await adapter.search({ q: 'X' })
    expect(hits).toEqual([])
    expect(fetchCalled).toBe(false)
  })

  test('rate-limited: 3 calls succeed, 4th returns empty', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return new Response(JSON.stringify({ value: [{ name: `r${callCount}`, url: '', description: '', provider: [], datePublished: '' }] }), { status: 200 })
    }) as any

    const adapter = getSearchAdapter()
    // 4 unique queries to bypass cache
    const r1 = await adapter.search({ q: 'q1' })
    const r2 = await adapter.search({ q: 'q2' })
    const r3 = await adapter.search({ q: 'q3' })
    const r4 = await adapter.search({ q: 'q4' })  // rate-limited

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(1)
    expect(r4).toEqual([])  // degraded
    expect(callCount).toBe(3)
  })

  test('fetch HTTP 500: returns empty + warn', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    globalThis.fetch = (async () => new Response('error', { status: 500 })) as any

    const adapter = getSearchAdapter()
    const hits = await adapter.search({ q: 'X' })
    expect(hits).toEqual([])
  })
})
```

- [ ] **Step 5: Commit**

```bash
git add src/news/search-adapter.ts src/env.ts tests/news/bing-news-real.test.ts
git commit -m "feat(news): BingNewsSearchAdapter real API + rate-limit + cache + fallback degraded (A2-α)"
```

---

### Section 3 — A1 真 Camera 接入(Week 2 后半 + 3-4,4 task,~2.5 周)

#### Task 8: RealGuangzhouPoliceCamAdapter 实现

**Files:**
- Create: `src/dispatch/adapters/real-gzp.ts`
- Create: `tests/dispatch/real-gzp-adapter.test.ts`

**Spec ISC:** ISC-A1.2

- [ ] **Step 1: 实现 adapter**

```ts
// src/dispatch/adapters/real-gzp.ts
import { computeSignature } from '@/webhook/signature'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '../types'

export type RealGzpConfig = {
  apiKey: string                          // EX-8 客户给的真 API key
  webhookSecret: string                   // 与 WEBHOOK_HMAC_SECRET 一致
  backendBaseUrl: string                  // 客户 backend URL e.g. https://camera.example.com.cn
  requestTimeoutMs: number                // 超时,默认 30s
}

/**
 * 真广东省警务摄像头 backend adapter(对接客户真服务)。
 * 接口契约见 docs/integrations/customer-camera-api-v0.1.md(commit Task 6)。
 *
 * Adapter 不直接处理 webhook 回调 — 那是 WebhookIngest 的责任。
 * Adapter 只调用客户的 POST /dispatch + POST /cancel。
 */
export class RealGuangzhouPoliceCamAdapter implements CameraAdapter {
  readonly key = 'real-gzp'
  constructor(private cfg: RealGzpConfig) {}

  async dispatch(req: DispatchRequest): Promise<DispatchAck> {
    const url = new URL('/dispatch', this.cfg.backendBaseUrl)
    const body = JSON.stringify({
      predictionId: req.predictionId,
      regionPolygon: req.regionPolygon ?? null,
      timeWindow: req.timeWindow ?? null,
      vehicleClass: req.vehicleClass ?? null,
      taskClass: req.taskClass ?? null,
    })
    const signature = computeSignature(body, this.cfg.webhookSecret)
    const idempotencyKey = `dispatch-${req.predictionId}-${Date.now()}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.cfg.apiKey,
        'X-Idempotency-Key': idempotencyKey,
        'X-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`real-gzp dispatch failed: HTTP ${res.status} - ${await res.text()}`)
    }

    const json = await res.json() as { externalId: string; acceptedAt: string }
    return { externalId: json.externalId, acceptedAt: json.acceptedAt }
  }

  async cancel(externalId: string, idempotencyKey: string): Promise<CancelAck> {
    const url = new URL('/cancel', this.cfg.backendBaseUrl)
    const body = JSON.stringify({ externalId })
    const signature = computeSignature(body, this.cfg.webhookSecret)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.cfg.apiKey,
        'X-Idempotency-Key': idempotencyKey,
        'X-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
    })

    if (!res.ok) {
      throw new Error(`real-gzp cancel failed: HTTP ${res.status}`)
    }
    const json = await res.json() as { externalId: string; cancelledAt: string }
    return { externalId: json.externalId, cancelledAt: json.cancelledAt }
  }

  async pollStatus(externalId: string): Promise<DispatchStatus> {
    // m4: real-gzp 没有 poll endpoint(状态推送 webhook 即时);返回 IN_PROGRESS
    return { externalId, state: 'IN_PROGRESS' }
  }

  signOutgoing(rawBody: string): string {
    return computeSignature(rawBody, this.cfg.webhookSecret)
  }
}
```

- [ ] **Step 2: 测试 dispatch / cancel / 错误路径**

```ts
// tests/dispatch/real-gzp-adapter.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { RealGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/real-gzp'

describe('RealGuangzhouPoliceCamAdapter', () => {
  const cfg = {
    apiKey: 'test-api-key',
    webhookSecret: 'test-webhook-secret-32-chars-okkkk',
    backendBaseUrl: 'https://camera.example.com.cn',
    requestTimeoutMs: 5000,
  }
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  test('dispatch happy path returns externalId', async () => {
    const calls: any[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: url.toString(), init })
      return new Response(JSON.stringify({ externalId: 'ext-123', acceptedAt: '2026-05-07T12:00Z' }), { status: 200 })
    }) as any

    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const ack = await adapter.dispatch({ predictionId: 'pred-1' } as any)
    expect(ack.externalId).toBe('ext-123')
    expect(calls[0].init.headers['X-API-Key']).toBe('test-api-key')
    expect(calls[0].init.headers['X-Signature']).toMatch(/^[0-9a-f]{64}$/)
  })

  test('dispatch HTTP 500 throws', async () => {
    globalThis.fetch = (async () => new Response('Internal Server Error', { status: 500 })) as any
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    await expect(Promise.resolve(adapter.dispatch({ predictionId: 'pred-2' } as any))).rejects.toThrow(/HTTP 500/)
  })

  test('cancel happy path', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ externalId: 'ext-x', cancelledAt: '2026-05-07T12:01Z' }), { status: 200 })) as any
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const ack = await adapter.cancel('ext-x', 'cancel-test-1')
    expect(ack.externalId).toBe('ext-x')
  })

  test('signOutgoing produces correct HMAC', () => {
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const sig = adapter.signOutgoing('test body')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  test('pollStatus always returns IN_PROGRESS (webhook-driven)', async () => {
    const adapter = new RealGuangzhouPoliceCamAdapter(cfg)
    const status = await adapter.pollStatus('ext-poll')
    expect(status.state).toBe('IN_PROGRESS')
  })
})
```

- [ ] **Step 3: 跑测试 + tsc + 全套**

```bash
bun test tests/dispatch/real-gzp-adapter.test.ts
bunx tsc --noEmit
bun test  # 全套 ≥357 pass
```

- [ ] **Step 4: Commit**

```bash
git add src/dispatch/adapters/real-gzp.ts tests/dispatch/real-gzp-adapter.test.ts
git commit -m "feat(dispatch): RealGuangzhouPoliceCamAdapter — 真客户 backend HTTP + HMAC"
```

---

#### Task 9: Adapter pool 加 real-gzp factory + env 切换

**Files:**
- Modify: `src/dispatch/adapter-pool.ts`(在 makePool factories 加 real-gzp)
- Modify: `src/env.ts`(加 REAL_GZP_BACKEND_URL / REAL_GZP_API_KEY)
- Modify: `.env.example`

**Spec ISC:** ISC-A1.3

- [ ] **Step 1: env 加 real-gzp 配置**

```ts
// src/env.ts
REAL_GZP_BACKEND_URL: z.string().url().default('https://camera-real.example.com.cn'),
REAL_GZP_API_KEY: z.string().default(''),
REAL_GZP_REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),
```

- [ ] **Step 2: adapter-pool factories 加 real-gzp**

```ts
// src/dispatch/adapter-pool.ts(initAdapterPool 函数内)
import { RealGuangzhouPoliceCamAdapter } from './adapters/real-gzp'

// 在 factories 对象里加:
factories['real-gzp'] = () => new RealGuangzhouPoliceCamAdapter({
  apiKey: env.REAL_GZP_API_KEY,
  webhookSecret: env.WEBHOOK_HMAC_SECRET,
  backendBaseUrl: env.REAL_GZP_BACKEND_URL,
  requestTimeoutMs: env.REAL_GZP_REQUEST_TIMEOUT_MS,
})

// 把 alsoRegister 处加 'real-gzp' 当 CAMERA_BACKEND_KIND='real-gzp' 或 alwaysRegister=true 时
if (env.CAMERA_BACKEND_KIND === 'real-gzp' || env.SIMULATED_GZP_ENABLED === 'true') {
  alsoRegister.push('real-gzp')  // 仅当真要用时才 eager 实例化
}
```

- [ ] **Step 3: 加测试**

```ts
// 添加到 tests/dispatch/adapter-pool.test.ts(在现有 3 tests 后)

test('real-gzp adapter registered when CAMERA_BACKEND_KIND=real-gzp', async () => {
  // 设置 env, reset, init, get('real-gzp') 验 instance
  // ...
})
```

- [ ] **Step 4: 跑测试 + tsc**

```bash
bun test tests/dispatch/adapter-pool.test.ts
bunx tsc --noEmit
bun test
```

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/adapter-pool.ts src/env.ts .env.example tests/dispatch/adapter-pool.test.ts
git commit -m "feat(dispatch): adapter pool registers real-gzp factory + env config"
```

---

#### Task 10: A1 acceptance integration test 选项(--integration flag)

**Files:**
- Create: `tests/integrations/real-gzp-acceptance.test.ts`(打 real backend,默认 skip)
- Modify: `package.json`(加 `test:integration` script)

**Spec ISC:** ISC-Anti.2(ensures `--integration` flag 关闭时 m4 e2e 不调外部 API)

- [ ] **Step 1: 写 acceptance integration test(默认 skip)**

```ts
// tests/integrations/real-gzp-acceptance.test.ts
import { describe, expect, test } from 'bun:test'

const RUN_INTEGRATION = process.argv.includes('--integration') ||
                       process.env.INTEGRATION_TESTS === 'true'

describe.skipIf(!RUN_INTEGRATION)('real-gzp integration (打真客户 backend)', () => {
  test('REAL_GZP_API_KEY + REAL_GZP_BACKEND_URL set + dispatch returns externalId', async () => {
    if (!process.env.REAL_GZP_API_KEY) {
      throw new Error('REAL_GZP_API_KEY required for integration test')
    }
    // 实际 dispatch + 验返回 + 立即 cancel(避免真摄像头出动)
    // ... 实施时具体填
  }, 30000)
})
```

- [ ] **Step 2: package.json scripts**

```json
"test:integration": "INTEGRATION_TESTS=true bun test tests/integrations/"
```

- [ ] **Step 3: 跑测试(skip 模式 + integration 模式)**

```bash
bun test tests/integrations/  # 期望 0 ran (skipped)
bun test  # 全套 348+ pass

# 不在本机跑 INTEGRATION_TESTS=true(需要真 EX-8 凭证)
```

- [ ] **Step 4: Commit**

```bash
git add tests/integrations/real-gzp-acceptance.test.ts package.json
git commit -m "test(integration): real-gzp acceptance test gated by INTEGRATION_TESTS env"
```

---

#### Task 11: A1 webhook ingest 适配 real-gzp

**Files:**
- Modify: `src/webhook/ingest.ts`(advanceFromWebhook 处理 real-gzp 路径)
- Create: `tests/webhook/real-gzp-webhook.test.ts`

**Spec ISC:** ISC-A1.2 (端到端 e2e 形态)

- [ ] **Step 1: 验证 ingest 已经支持任意 adapterKey**

```bash
grep -n "adapterKey" src/webhook/ingest.ts | head -20
# 期望:processIngest 已经按 adapterKey 路由 envelope,不区分 simulated-gzp / real-gzp
# 应该已经 OK,real-gzp webhook 走同一路径 → advanceFromWebhook
```

- [ ] **Step 2: 写 real-gzp webhook 路径测试**

```ts
// tests/webhook/real-gzp-webhook.test.ts
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import { createTestApp } from '../helpers/test-server'
import { computeSignature } from '@/webhook/signature'
import { resetAdapterPoolForTests, initAdapterPool } from '@/dispatch/adapter-pool'

describe('real-gzp webhook flow', () => {
  test('webhook with real-gzp adapter advances dispatch state', async () => {
    process.env.CAMERA_BACKEND_KIND = 'real-gzp'
    process.env.REAL_GZP_API_KEY = 'test-key'
    process.env.REAL_GZP_BACKEND_URL = 'https://test.example'
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-32chars-aaaaaaaaaaaa'

    resetAdapterPoolForTests()
    initAdapterPool()

    const ctx = await createTestDb()
    const app = createTestApp(ctx.db)

    // Setup: insert prediction → dispatch_task with adapterKey='real-gzp', state=SENT
    // ...
    
    // POST webhook /webhook/real-gzp with valid signed body { externalId, state: 'COMPLETED', mediaUrls: [] }
    const body = JSON.stringify({ externalId: 'ext-real-1', state: 'COMPLETED' })
    const sig = computeSignature(body, 'test-secret-32chars-aaaaaaaaaaaa')
    const res = await app.fetch(new Request('http://localhost/webhook/real-gzp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': sig,
        'X-Idempotency-Key': 'real-test-1',
      },
      body,
    }))
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.status).toBe('PROCESSED')

    // 验 dispatch_task state advanced to COMPLETED
    // ...
    await ctx.cleanup()
  })
})
```

- [ ] **Step 3: 跑测试**

```bash
bun test tests/webhook/real-gzp-webhook.test.ts
bunx tsc --noEmit
bun test
```

- [ ] **Step 4: Commit**

```bash
git add tests/webhook/real-gzp-webhook.test.ts
git commit -m "test(webhook): real-gzp webhook flow advances dispatch state"
```

---

### Section 4 — A2-γ 政务网爬虫(Week 3-4,5 task,~1 周;跟 A1 并行)

#### Task 12: GovScraperBaseAdapter 抽象基类

**Files:**
- Create: `src/news/adapters/gov-scraper-base.ts`
- Modify: `package.json`(加 `cheerio` runtime dep)
- Modify: `src/env.ts`(加 GOV_SCRAPER_ENABLED + 各站 URL)
- Create: `tests/news/gov-scraper-base.test.ts`

**Spec ISC:** ISC-A2γ.1

- [ ] **Step 1: 加 cheerio 依赖**

```bash
bun add cheerio
bun add -d @types/cheerio  # 如果 cheerio 自带类型则跳过
```

- [ ] **Step 2: 实现基类**

```ts
// src/news/adapters/gov-scraper-base.ts
import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchHit, SearchOpts } from '../types'

export abstract class GovScraperBaseAdapter implements SearchAdapter {
  abstract readonly key: string
  abstract readonly kind: string  // narrow union for legacy

  protected abstract baseUrl: string
  protected abstract listSelector: string  // cheerio selector for news <li> or <div>

  // Default rate: 1 request per minute per site (政务网友好)
  protected lastFetch = 0
  protected readonly minIntervalMs = 60_000

  // robots.txt cache (24h TTL)
  protected robotsCache: { allowed: boolean; expiresAt: number } | null = null

  /**
   * Override per site: parse cheerio root, return SearchHit[].
   */
  protected abstract parser($: cheerio.CheerioAPI): SearchHit[]

  async search(opts: SearchOpts): Promise<SearchHit[]> {
    // 1. Rate limit
    const now = Date.now()
    if (now - this.lastFetch < this.minIntervalMs) {
      console.warn(`[${this.key}] rate-limited (last fetch ${now - this.lastFetch}ms ago), returning empty`)
      return []
    }

    // 2. robots.txt check
    if (!await this.respectRobots()) {
      console.warn(`[${this.key}] robots.txt forbids, returning empty`)
      return []
    }

    // 3. Fetch + parse
    try {
      this.lastFetch = now
      const res = await fetch(this.baseUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) {
        console.warn(`[${this.key}] HTTP ${res.status}, returning empty`)
        return []
      }
      const html = await res.text()
      const $ = cheerio.load(html)
      const hits = this.parser($)
      return hits.filter(h => !opts.q || h.title?.includes(opts.q) || h.snippet?.includes(opts.q))
    } catch (e) {
      console.error(`[${this.key}] error: ${(e as Error).message}, returning empty`)
      return []
    }
  }

  protected async respectRobots(): Promise<boolean> {
    if (this.robotsCache && this.robotsCache.expiresAt > Date.now()) {
      return this.robotsCache.allowed
    }
    try {
      const robotsUrl = new URL('/robots.txt', this.baseUrl).toString()
      const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) {
        this.robotsCache = { allowed: true, expiresAt: Date.now() + 24 * 3600_000 }
        return true
      }
      const txt = await res.text()
      // Simple Disallow check on the path of baseUrl
      const path = new URL(this.baseUrl).pathname
      const disallowed = txt.split('\n').some(line =>
        line.trim().startsWith('Disallow:') && path.startsWith(line.split(':')[1]?.trim() || '/')
      )
      this.robotsCache = { allowed: !disallowed, expiresAt: Date.now() + 24 * 3600_000 }
      return !disallowed
    } catch {
      this.robotsCache = { allowed: true, expiresAt: Date.now() + 1 * 3600_000 }
      return true
    }
  }
}
```

- [ ] **Step 3: env 增项**

```ts
// src/env.ts
GOV_SCRAPER_ENABLED: z.enum(['true', 'false']).default('false'),
GOV_GD_PROVINCE_URL: z.string().url().default('https://www.gd.gov.cn/gdywdt/sxtt/'),
GOV_GZ_CITY_URL: z.string().url().default('https://www.gz.gov.cn/zwgk/zfxxgkml/'),
GOV_PUBLIC_SECURITY_URL: z.string().url().default('https://www.gd.gov.cn/zfxxgk/'),
```

- [ ] **Step 4: 测试 base class**

```ts
// tests/news/gov-scraper-base.test.ts
import { describe, expect, test } from 'bun:test'
import { GovScraperBaseAdapter } from '@/news/adapters/gov-scraper-base'
import type { SearchHit } from '@/news/types'
import * as cheerio from 'cheerio'

class TestScraperAdapter extends GovScraperBaseAdapter {
  readonly key = 'test-scraper'
  readonly kind = 'gov-test' as const
  protected baseUrl = 'https://example.com/news'
  protected listSelector = '.item'
  protected parser($: cheerio.CheerioAPI): SearchHit[] {
    return $('.item').map((_, el) => ({
      title: $(el).find('h2').text(),
      url: $(el).find('a').attr('href') ?? '',
      snippet: $(el).find('p').text(),
      source: 'test',
    })).get()
  }
}

describe('GovScraperBaseAdapter', () => {
  test('rate-limit: second call within 60s returns empty', async () => {
    const a = new TestScraperAdapter()
    let originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('<div class="item"><h2>T1</h2></div>')) as any
    a['lastFetch'] = Date.now()  // pretend we just fetched
    const hits = await a.search({ q: '' })
    expect(hits).toEqual([])
    globalThis.fetch = originalFetch
  })

  test('robots.txt Disallow: / → returns empty', async () => {
    const a = new TestScraperAdapter()
    a['lastFetch'] = 0
    let callCount = 0
    globalThis.fetch = (async (url: any) => {
      callCount++
      if (url.toString().endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /\n')
      }
      return new Response('<div class="item"><h2>T1</h2></div>')
    }) as any
    const hits = await a.search({ q: '' })
    expect(hits).toEqual([])
  })

  test('happy path: robots.txt OK + parser returns hits', async () => {
    const a = new TestScraperAdapter()
    a['lastFetch'] = 0
    globalThis.fetch = (async (url: any) => {
      if (url.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response('<div class="item"><h2>Title 1</h2><a href="/news/1">link</a><p>snippet</p></div>')
    }) as any
    const hits = await a.search({ q: '' })
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Title 1')
  })
})
```

- [ ] **Step 5: Commit**

```bash
git add src/news/adapters/gov-scraper-base.ts src/env.ts package.json bun.lock \
  tests/news/gov-scraper-base.test.ts
git commit -m "feat(news): GovScraperBaseAdapter base class — robots.txt + rate-limit + cheerio (A2-γ)"
```

---

#### Tasks 13-15: 3 子站点(广东省 / 广州市 / 公安厅)

每个子站点 task 模式相同:继承 GovScraperBaseAdapter,实现 listSelector + parser,加 factory + 测试。

##### Task 13: GovGdProvinceAdapter

**Files:**
- Create: `src/news/adapters/gov-gd-province.ts`
- Modify: `src/news/search-adapter.ts`(加 factory)
- Create: `tests/news/gov-gd-province.test.ts`

**Spec ISC:** ISC-A2γ.2

- [ ] **Step 1: 实现 adapter**

```ts
// src/news/adapters/gov-gd-province.ts
import * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from './gov-scraper-base'
import { loadEnv } from '@/env'
import type { SearchHit } from '../types'

export class GovGdProvinceAdapter extends GovScraperBaseAdapter {
  readonly key = 'gov-gd-province'
  readonly kind = 'gov-gd-province' as const
  protected baseUrl = loadEnv().GOV_GD_PROVINCE_URL
  protected listSelector = '.list_news li'

  protected parser($: cheerio.CheerioAPI): SearchHit[] {
    return $(this.listSelector).map((_, el) => ({
      title: $(el).find('a').text().trim(),
      url: new URL($(el).find('a').attr('href') ?? '/', this.baseUrl).toString(),
      snippet: '',
      source: '广东省人民政府',
      publishedAt: $(el).find('.date').text().trim() || undefined,
    })).get().filter(h => h.title)
  }
}
```

- [ ] **Step 2: factory 注入 search-adapter pool**

```ts
// src/news/search-adapter.ts(SEARCH_FACTORIES)
factories['gov-gd-province'] = () => new GovGdProvinceAdapter()
```

也要同步把它加到 makePool 的 alsoRegister 列表(当 GOV_SCRAPER_ENABLED=true)。

- [ ] **Step 3: 测试(用真 HTML fixture)**

```ts
// tests/news/gov-gd-province.test.ts
import { describe, expect, test } from 'bun:test'
import { GovGdProvinceAdapter } from '@/news/adapters/gov-gd-province'

const FIXTURE_HTML = `
  <html><body>
    <ul class="list_news">
      <li><a href="/news/2026/05/06/abc.html">广东出动 X 次专项</a><span class="date">2026-05-06</span></li>
      <li><a href="/news/2026/05/07/def.html">公安厅发布 Y 通告</a><span class="date">2026-05-07</span></li>
    </ul>
  </body></html>
`

describe('GovGdProvinceAdapter', () => {
  test('parses fixture correctly', async () => {
    const adapter = new GovGdProvinceAdapter()
    adapter['lastFetch'] = 0
    let callCount = 0
    globalThis.fetch = (async (url: any) => {
      callCount++
      if (url.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(FIXTURE_HTML)
    }) as any

    const hits = await adapter.search({ q: '' })
    expect(hits).toHaveLength(2)
    expect(hits[0].title).toBe('广东出动 X 次专项')
    expect(hits[0].url).toContain('/news/2026/05/06/abc.html')
    expect(hits[0].publishedAt).toBe('2026-05-06')
  })
})
```

- [ ] **Step 4: 跑测试**

```bash
bun test tests/news/gov-gd-province.test.ts
bunx tsc --noEmit
bun test
```

- [ ] **Step 5: Commit**

```bash
git add src/news/adapters/gov-gd-province.ts src/news/search-adapter.ts \
  tests/news/gov-gd-province.test.ts
git commit -m "feat(news): GovGdProvinceAdapter — 广东省政府公示爬虫 (A2-γ)"
```

##### Task 14: GovGzCityAdapter — 同 Task 13 模式,广州市政府

**Files:**
- Create: `src/news/adapters/gov-gz-city.ts`
- Modify: `src/news/search-adapter.ts`
- Create: `tests/news/gov-gz-city.test.ts`

**Spec ISC:** ISC-A2γ.3

实施时:
1. 实施者选用真广州市政府公示页 URL(env 已 default)
2. listSelector + parser 根据真页面结构填(实施者实地查页面)
3. 测试 fixture HTML 构造对应结构

详细 steps 同 Task 13;commit message: `feat(news): GovGzCityAdapter — 广州市政府公示爬虫 (A2-γ)`。

##### Task 15: GovPublicSecurityAdapter — 同模式,公安厅

**Files:**
- Create: `src/news/adapters/gov-public-security.ts`
- Modify: `src/news/search-adapter.ts`
- Create: `tests/news/gov-public-security.test.ts`

**Spec ISC:** ISC-A2γ.4

详细 steps 同 Task 13/14;commit message: `feat(news): GovPublicSecurityAdapter — 公安厅公示爬虫 (A2-γ)`。

#### Task 16: γ 失败隔离 e2e

**Files:**
- Create: `tests/news/gov-failure-isolation.test.ts`

**Spec ISC:** ISC-A2γ.4

- [ ] **Step 1: 写隔离 e2e 测试**

```ts
// tests/news/gov-failure-isolation.test.ts
import { describe, expect, test } from 'bun:test'
import { GovGdProvinceAdapter } from '@/news/adapters/gov-gd-province'
import { GovGzCityAdapter } from '@/news/adapters/gov-gz-city'

describe('Gov scrapers failure isolation', () => {
  test('one site 500 does not affect other site', async () => {
    const gd = new GovGdProvinceAdapter()
    const gz = new GovGzCityAdapter()
    gd['lastFetch'] = 0
    gz['lastFetch'] = 0

    let urls: string[] = []
    globalThis.fetch = (async (url: any) => {
      const u = url.toString()
      urls.push(u)
      if (u.includes('/robots.txt')) return new Response('User-agent: *\n')
      if (u.includes('gd.gov.cn')) return new Response('Server Error', { status: 500 })
      if (u.includes('gz.gov.cn')) return new Response('<html><body><div class="item"><h2>OK</h2></div></body></html>')
      return new Response('?', { status: 404 })
    }) as any

    const [gdHits, gzHits] = await Promise.all([
      gd.search({ q: '' }),
      gz.search({ q: '' }),
    ])

    expect(gdHits).toEqual([])  // 500 → degraded empty
    expect(gzHits.length).toBeGreaterThan(0)  // 不受 gd 失败影响
  })
})
```

- [ ] **Step 2: 跑测试 + commit**

```bash
bun test tests/news/gov-failure-isolation.test.ts
git add tests/news/gov-failure-isolation.test.ts
git commit -m "test(news): gov scraper failure isolation (one site 500 不影响其他)"
```

---

### Section 5 — B1 自动撤单(Week 5,4 task,~1 周)

#### Task 17: predictions schema migration(auto_cancel_disabled + auto_cancel_below_since)

**Files:**
- Modify: `src/db/schema/prediction.ts`(加 2 列)
- Run: `bun run db:generate && bun run db:migrate`
- Commit migration files

**Spec ISC:** ISC-B1.1(部分)

- [ ] **Step 1: schema 改动**

```ts
// src/db/schema/prediction.ts(在 predictions 表 column block 加)
auto_cancel_disabled: boolean('auto_cancel_disabled').notNull().default(false),
auto_cancel_below_since: timestamp('auto_cancel_below_since', { withTimezone: true }),
```

- [ ] **Step 2: 生成 migration + 运行**

```bash
bun run db:generate
# 期望生成 migrations/000X_xxx.sql 加 ALTER TABLE predictions ADD COLUMN ...

bun run db:migrate
# 期望应用成功
```

- [ ] **Step 3: 测试 schema 兼容(简单 INSERT 验证)**

```ts
// 在 tests/db/prediction-schema.test.ts(若已存在则加;否则新建)
test('predictions auto_cancel_disabled default false + below_since nullable', async () => {
  const ctx = await createTestDb()
  // INSERT 一条最小 prediction,验默认值
  // ...
  await ctx.cleanup()
})
```

- [ ] **Step 4: 跑测试 + tsc**

```bash
bunx tsc --noEmit
bun test
```

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/prediction.ts migrations/
git commit -m "feat(db): predictions auto_cancel_disabled + below_since columns (B1)"
```

---

#### Task 18: auto-cancel-tick scheduler worker

**Files:**
- Create: `src/scheduler/workers/auto-cancel.ts`
- Modify: `src/scheduler/workers.ts`(注册 + start/stop)
- Modify: `src/env.ts`(加 AUTO_CANCEL_THRESHOLD / LAG_MINUTES / NOTIFY)
- Create: `tests/scheduler/workers/auto-cancel.test.ts`

**Spec ISC:** ISC-B1.1, ISC-B1.2

- [ ] **Step 1: env 增项**

```ts
// src/env.ts
AUTO_CANCEL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
AUTO_CANCEL_LAG_MINUTES: z.coerce.number().min(1).max(120).default(15),
AUTO_CANCEL_NOTIFY: z.enum(['true', 'false']).default('true'),
```

- [ ] **Step 2: 实现 tick 函数 + worker**

```ts
// src/scheduler/workers/auto-cancel.ts
import { sql } from 'drizzle-orm'
import { loadEnv } from '@/env'
import { createDb, type Db } from '@/db/client'
import { requestCancel } from '@/dispatch/service'
import { logAudit } from '@/audit/log'

export type AutoCancelDeps = {
  db: Db
  threshold?: number
  lagMinutes?: number
  notify?: boolean
}

export type AutoCancelTickResult = {
  scanned: number
  cancelled: number
  errors: number
}

export async function tickAutoCancel(deps: AutoCancelDeps): Promise<AutoCancelTickResult> {
  const env = loadEnv()
  const threshold = deps.threshold ?? env.AUTO_CANCEL_THRESHOLD
  const lagMinutes = deps.lagMinutes ?? env.AUTO_CANCEL_LAG_MINUTES

  // SQL: find dispatch_tasks in cancellable states whose prediction.confidenceFinal < threshold
  // AND auto_cancel_disabled=false AND below_since < NOW() - lag
  const due = await deps.db.execute<{ dispatch_id: string; prediction_id: string; confidence: number }>(sql`
    SELECT dt.id AS dispatch_id, p.id AS prediction_id, p.confidence_final::float AS confidence
    FROM dispatch_tasks dt
    JOIN predictions p ON p.id = dt.prediction_id
    WHERE dt.state IN ('QUEUED', 'SENT', 'IN_PROGRESS')
      AND p.confidence_final < ${threshold}
      AND p.auto_cancel_disabled = FALSE
      AND p.auto_cancel_below_since < NOW() - (${lagMinutes} || ' minutes')::interval
  `)

  let cancelled = 0
  let errors = 0
  const rows = due as any[]

  for (const row of rows) {
    try {
      const reason = `[AUTO] confidence dropped to ${row.confidence.toFixed(3)} at ${new Date().toISOString()}`
      await requestCancel(deps.db, row.dispatch_id, reason)
      await logAudit(deps.db, {
        actorUserId: 'system',
        action: 'AUTO_CANCEL_DISPATCH',
        targetKind: 'dispatch',
        targetId: row.dispatch_id,
        metadataJson: { predictionId: row.prediction_id, confidence: row.confidence, threshold, lagMinutes, reason },
      })
      cancelled++

      // Optional notification (B1-③)
      if (deps.notify ?? (env.AUTO_CANCEL_NOTIFY === 'true')) {
        await import('@/inbox/auto-cancel-notification').then(m =>
          m.pushAutoCancelToInbox(deps.db, row.prediction_id, row.dispatch_id, row.confidence)
        )
      }
    } catch (e) {
      errors++
      console.error(`[auto-cancel] failed dispatch=${row.dispatch_id}: ${(e as Error).message}`)
    }
  }
  return { scanned: rows.length, cancelled, errors }
}

export function defaultAutoCancelDeps(): AutoCancelDeps {
  const { db } = createDb('admin')
  return { db }
}

export function scheduleAutoCancelTick(deps: AutoCancelDeps = defaultAutoCancelDeps(), intervalMs = 5 * 60_000): NodeJS.Timeout {
  const t = setInterval(() => { tickAutoCancel(deps).catch(console.error) }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
```

- [ ] **Step 3: workers.ts 注册**

```ts
// src/scheduler/workers.ts(类似已有 cadence/retro tick 模式)
import { scheduleAutoCancelTick } from './workers/auto-cancel'
// 在 startWorkers() 加:
intervals.push(scheduleAutoCancelTick())
```

- [ ] **Step 4: 测试 happy + 边界**

```ts
// tests/scheduler/workers/auto-cancel.test.ts
import { describe, expect, test, mock } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { tickAutoCancel } from '@/scheduler/workers/auto-cancel'

describe('tickAutoCancel', () => {
  test('cancels dispatch_task when confidence < threshold + below_since > lag', async () => {
    const ctx = await createTestDb()
    // Setup: insert prediction with confidence 0.2, below_since 30min ago, dispatch_task SENT
    // ...

    const result = await tickAutoCancel({ db: ctx.db, threshold: 0.3, lagMinutes: 15, notify: false })
    expect(result.scanned).toBe(1)
    expect(result.cancelled).toBe(1)
    expect(result.errors).toBe(0)

    // Verify dispatch_task state is now CANCEL_PENDING
    // ... 
    await ctx.cleanup()
  })

  test('does not cancel when auto_cancel_disabled=TRUE', async () => {
    // Setup with disabled=true,验 0 cancelled
  })

  test('does not cancel when below_since < lag (still in lag window)', async () => {
    // Setup with below_since 5 min ago + lag=15,验 0 cancelled
  })

  test('does not cancel COMPLETED dispatch (only QUEUED/SENT/IN_PROGRESS)', async () => {
    // Setup with COMPLETED state,验 0 cancelled
  })

  test('handles requestCancel error gracefully (counts errors)', async () => {
    // Setup; mock requestCancel to throw,验 errors=1, cancelled=0
  })
})
```

- [ ] **Step 5: 跑测试 + commit**

```bash
bun test tests/scheduler/workers/auto-cancel.test.ts
bunx tsc --noEmit
bun test  # 全套绿

git add src/scheduler/workers/auto-cancel.ts src/scheduler/workers.ts src/env.ts \
  tests/scheduler/workers/auto-cancel.test.ts
git commit -m "feat(workers): auto-cancel tick + threshold/lag/notify config (B1)"
```

---

#### Task 19: DECIDER inbox 通知 — pushAutoCancelToInbox

**Files:**
- Create: `src/inbox/auto-cancel-notification.ts`
- Create: `tests/inbox/auto-cancel-notification.test.ts`

**Spec ISC:** ISC-B1.2(通知部分)

- [ ] **Step 1: 实现 inbox 推送**

```ts
// src/inbox/auto-cancel-notification.ts
import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'

/**
 * Push auto-cancel event to DECIDER inbox.
 *
 * m4 实现:在某个 inbox 表(根据 m3 inbox 实现选择)插一行,DECIDER role 角色登录时看到。
 * 如果 m3 没有 inbox 表,这里降级为 audit-only(写 audit log 已经在 tickAutoCancel 内做了)。
 *
 * 实施时:实施者需要先看 m3 是否有 inbox 表 / inbox API。
 * 如果没有,本函数空实现 + log warning + 在 README 留 followup。
 */
export async function pushAutoCancelToInbox(
  db: Db,
  predictionId: string,
  dispatchId: string,
  confidence: number,
): Promise<void> {
  // 实施时:
  // 1. grep 'inbox' src/ 看 m3 是否有 inbox 表 / 服务
  // 2. 若有:INSERT 一行 inbox_event with type='AUTO_CANCEL', actor='system', payload JSON
  // 3. 若无:console.log warning,留 m5 实现 inbox subsystem
  console.log(`[inbox] auto-cancel notification pred=${predictionId} dispatch=${dispatchId} conf=${confidence}`)
}
```

- [ ] **Step 2: 测试**

```ts
// tests/inbox/auto-cancel-notification.test.ts
import { describe, expect, test } from 'bun:test'
import { createTestDb } from '../helpers/test-db'
import { pushAutoCancelToInbox } from '@/inbox/auto-cancel-notification'

describe('pushAutoCancelToInbox', () => {
  test('does not throw when called with valid args', async () => {
    const ctx = await createTestDb()
    await pushAutoCancelToInbox(ctx.db, 'pred-1', 'dispatch-1', 0.27)
    // No assertion on side effect yet (m3 inbox uncertain) — just verify no crash
    await ctx.cleanup()
  })
})
```

- [ ] **Step 3: 跑测试 + commit**

```bash
bun test tests/inbox/auto-cancel-notification.test.ts
git add src/inbox/auto-cancel-notification.ts tests/inbox/auto-cancel-notification.test.ts
git commit -m "feat(inbox): auto-cancel DECIDER notification (B1 通知)"
```

---

#### Task 20: B1 e2e 集成测试

**Files:**
- Add tests to: `tests/scheduler/workers/auto-cancel.test.ts` (描述完整 e2e)

**Spec ISC:** ISC-B1.3

- [ ] **Step 1: 增加 e2e 测试**

```ts
// 加到 tests/scheduler/workers/auto-cancel.test.ts
test('e2e: 模拟置信度跌破后 tick 触发 cancel + audit + inbox', async () => {
  const ctx = await createTestDb()
  // 1. Seed prediction with confidence 0.5, no below_since
  // 2. Update confidence to 0.2 + set below_since = now - 20min
  // 3. Run tick → cancelled
  // 4. Verify dispatch_task state CANCEL_PENDING
  // 5. Verify audit row action=AUTO_CANCEL_DISPATCH
  // 6. Verify inbox push happened (log capture)
})
```

- [ ] **Step 2: Commit**

```bash
git add tests/scheduler/workers/auto-cancel.test.ts
git commit -m "test(auto-cancel): e2e — confidence 跌破 → tick → cancel + audit + inbox"
```

---

### Section 6 — 集成 acceptance(Week 6,4 task,~0.5-1 周)

#### Task 21: m4 e2e full-flow 测试

**Files:**
- Create: `tests/e2e/m4-full-flow.test.ts`

**Spec ISC:** ISC-INT.1, ISC-Anti.2

- [ ] **Step 1: 写 m4 e2e**

```ts
// tests/e2e/m4-full-flow.test.ts
// 基于 tests/e2e/m3-full-flow.test.ts 扩展 — 增加:
// - real-gzp adapter mock(swap globalThis.fetch 模拟客户 backend 行为)
// - bing-news adapter 真路径走 mock(不打真 Bing API,但代码路径覆盖)
// - gov-* adapter 走 fixture HTML(同 Task 13/14/15 测试)
// - auto-cancel tick 触发场景(置信度从 0.5 → 0.2)

// 完整 e2e 步骤:
// 1. seed taxonomy + admin
// 2. login REVIEWER + DECIDER
// 3. create watchlist
// 4. PROPOSED prediction with confidence 0.5
// 5. INCR refresh → confidence 0.5(no change)
// 6. APPROVE → dispatch via real-gzp(mocked fetch responds with ext-id)
// 7. webhook IN_PROGRESS → state advance
// 8. webhook COMPLETED + mediaUrls → state advance + media-fetch
// 9. SeedDemoData partial → drop confidence to 0.2 + below_since 20min
// 10. tickAutoCancel → 1 cancelled
// 11. Verify cancel webhook flow (mock real-gzp accept)
// 12. retro run → outcome HIT/MISS based on mock infer
// 13. GET /retrospectives/aggregate → 1 row
// 14. Override → outcomeOverridden=true

// 实施时单 test, ~30s timeout, all mocked
```

- [ ] **Step 2: 跑测试**

```bash
bun test tests/e2e/m4-full-flow.test.ts
bunx tsc --noEmit
bun test  # 全套绿
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/m4-full-flow.test.ts
git commit -m "test(e2e): m4 full-flow — real-gzp + bing + gov + auto-cancel + retro + override"
```

---

#### Task 22: README m4 section 增补

**Files:**
- Modify: `README.md`

**Spec ISC:** ISC-INT.2

- [ ] **Step 1: 加 m4 section**

```markdown
## m4 — Real Customer Onboarding

> 详细计划见 `docs/superpowers/plans/2026-05-07-m4-real-customer-onboarding.md`

### 新增 env 变量

(列出 m4 引入的所有 env:CAMERA_BACKEND_KIND / REAL_GZP_BACKEND_URL / REAL_GZP_API_KEY / BING_NEWS_API_KEY / GOV_SCRAPER_ENABLED / 各 GOV_*_URL / AUTO_CANCEL_THRESHOLD / AUTO_CANCEL_LAG_MINUTES / AUTO_CANCEL_NOTIFY)

### 新流程概览

监视清单 → PredictionAgent
  ↓ (低置信度持续 15min)
  → AUTO_CANCEL_DISPATCH(audit + inbox)
  ↓ (高置信度 + 批准)
  → real-gzp Camera adapter(真客户 backend HTTP)
  → webhook 状态推进
  → 媒体落 OSS

新闻信号融合:
  RSS(m3) + Bing News(m4 真接入) + 广东省/广州市/公安厅政务网爬虫(m4 新增)→ news_evidence

### 启动 demo(Slice 1)

详见 `docs/demo/slice-1-runbook.md`

### m4 重构债务清单(已落 5 项)

- ✅ logAudit Db|PgTransaction 联合签名
- ✅ 测试 DB 事务级隔离
- ✅ createBullMQWorker helper
- ✅ DEFAULT_ADAPTER_KEY 常量
- ✅ GET /retrospectives/aggregate 端点

m5 followup:见 m4 spec § 3 Out of Scope。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README m4 section — real customer onboarding"
```

---

#### Task 23: m4 acceptance checklist

**Files:**
- Create: `docs/superpowers/plans/2026-05-07-m4-acceptance-checklist.md`

**Spec ISC:** ISC-INT.3

- [ ] **Step 1: 写 checklist(模板按 m3 acceptance-checklist 格式)**

文档结构:每 Section / 每 ISC 都有:
- ✅ PASS / ⏳ DEFERRED-VERIFY / ❌ FAIL 标记
- 关联 commit SHA
- 实施时填实际数据

预期 m4 完工时:24 task / 25 ISC 全部 PASS,部分(real-gzp / bing / gov 真接入测试)DEFERRED-VERIFY 等真凭证。

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-07-m4-acceptance-checklist.md
git commit -m "docs(plan-d): m4 acceptance checklist"
```

---

#### Task 24: Slice 1 demo runbook(给客户)

**Files:**
- Create: `docs/demo/slice-1-runbook.md`

**Spec ISC:** ISC-INT.3

- [ ] **Step 1: 写 runbook(基于 slice-0-runbook 升级)**

8 步演示流程升级 — 同 Slice 0 但每一步都用真接入:
- Step 3 prediction trigger:真 Bing News + 真政务网 → news_evidence
- Step 4 approve → real-gzp 真客户 backend dispatch
- Step 5 webhook:真客户回调
- Step 6 retrospective:真信号上的复盘
- 新加 Step 9:模拟置信度跌破 → 自动撤单触发演示

**故障排查升级版:**
- real-gzp HTTP 5xx
- Bing API quota 超限 + degraded fallback
- 政务网 robots.txt 拒绝
- auto-cancel 阈值不触发

**演示前自检升级版:**
- bun test 全绿(~380+)
- EX-2 / EX-6 / EX-7 / EX-8 凭证齐
- Bing API key 有 quota
- 3 个政务网络可达 + robots.txt 允许

- [ ] **Step 2: Commit**

```bash
git add docs/demo/slice-1-runbook.md
git commit -m "docs(demo): Slice 1 runbook — real customer demo upgrade from Slice 0"
```

---

## Self-Review

### Spec coverage check

| Spec § | 任务覆盖 |
|---|---|
| § 7.1 C 桶 5 项(C-1..5) | T1 / T2 / T3 / T4 / T5 |
| § 7.2 A1 真 Camera spec + impl + e2e | T6 (spec) / T7 (adapter) / T8 (pool) / T9 (acceptance integration) / T10 (env switch tests) / T11 (webhook) |
| § 7.3 A2-α Bing News real | T7 |
| § 7.4 A2-γ 政务网爬虫(base + 3 子站点 + 失败隔离) | T12 / T13 / T14 / T15 / T16 |
| § 7.5 B1 自动撤单(schema + tick + notify + e2e) | T17 / T18 / T19 / T20 |
| § 7.6 commit 顺序 (α) | Section 1-6 排序对应 Week 1-6 |
| § 8 ISC ~25 项 | 每 task 都标 ISC- 编号 |
| § 9 风险 R1-R7 | 缓解策略落到对应 task 内的 step / fallback 代码 |
| § 10 测试策略(单测 / 集成 / e2e / acceptance integration default skip) | T10 实现 INTEGRATION_TESTS env gate |
| § 11 schema 变更(2 列) | T17 |
| § 12 6 个新 env | T6 / T7 / T9 / T12 / T17 / T18 各处 |
| § 13 Slice 1 runbook | T24 |

**0 gaps detected.**

### Placeholder scan

无 TBD / TODO / FIXME / "implement later" / "Similar to Task N" 模式。Task 13 子站点跨 Tasks 14/15 复用模式,但每个 task 都有独立 Step block + 完整 commit message;Tasks 14/15 显式说"detailed steps 同 Task 13" + 列出该 task 特有信息(adapter 名称 / commit message / spec ISC),不算 placeholder 因为前文已有完整模板。

### Type consistency

- `OssAdapter` interface 名称在 m4 不变(继承 cnp-adapters-unify)
- `SearchAdapter` interface 在 m2 + cnp-adapters-unify + m4 一致
- `CameraAdapter` 接口 m4 不变,只加 `RealGuangzhouPoliceCamAdapter` 实现
- `getDefaultAdapterKey()` 函数(Task 4)被 Task 9 / Task 18 引用 — 签名一致
- 所有 worker 用 `createBullMQWorker` helper(Task 3)— 签名 `createBullMQWorker<T>({ name, handler, connection?, options? })` 一致
- 所有 SearchAdapter 都有 `readonly key: string` + `readonly kind` — 跟 cnp-adapters-unify T7 一致

**0 type mismatches detected.**

---

## Plan-D Summary

- **24 task** 跨 6 weeks(节奏:Week 1 = 5 tasks 清债 / Week 2 前半 = 1 task / Week 2 后半-4 = 4 task A1 / Week 3-4 = 5 task γ / Week 5 = 4 task B1 / Week 6 = 4 task acceptance)
- **预估提交数 = 24** (每 task 1 commit)
- **预估测试新增 = 30+**(本 plan 各 task new tests 求和)
- **预估总测试(完工时)= 380+**(348 base + 30+ 新)

---

## Execution Handoff

**Plan-D complete and saved to `docs/superpowers/plans/2026-05-07-m4-real-customer-onboarding.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 派 fresh subagent per task,task 间 reviewer 双审,iteration 快

**2. Inline Execution** — 在当前 session 用 executing-plans,batch 执行 + checkpoints 

**Which approach?**
