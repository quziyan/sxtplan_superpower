import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import IORedis from 'ioredis'
import type {
  RunRetrospectiveAgentInput,
  RunRetrospectiveAgentOutput,
} from '@/agents/retrospective-agent'
import type { Db } from '@/db/client'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import {
  createRetrospectiveWorker,
  processRetrospectiveJob,
  type RetrospectiveDeps,
  type RetrospectiveJobData,
  type RetrospectiveQueueLike,
  scheduleRetrospectiveTick,
  tickRetrospective,
} from '@/scheduler/workers/retrospective'
import { createTestDb } from '../../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

/**
 * Seeds a prediction (with fresh region/vehicleClass/taskClass FK ancestry)
 * and optionally a retrospective row attached to it. Returns the
 * prediction id so tests can assert on per-row enqueue behavior amid
 * other rows that may exist in the shared test DB.
 */
async function seedPrediction(
  db: typeof ctx.db,
  label: string,
  overrides: Partial<{
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
    /** SQL date string YYYY-MM-DD — applied via a parameterised UPDATE so
     *  tests can place a row in the past without timezone surprises. */
    windowDateOffsetDays: number
    /** When true, also insert a retrospectives row pointing at this
     *  prediction (so the LEFT JOIN filter excludes it). */
    seedRetrospective: boolean
  }> = {},
): Promise<string> {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()

  const offset = overrides.windowDateOffsetDays ?? -8 // default: 8 days ago (past M=7)
  const windowDate = new Date()
  windowDate.setUTCDate(windowDate.getUTCDate() + offset)
  windowDate.setUTCHours(0, 0, 0, 0)

  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate,
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 9,
    status: overrides.status ?? 'COMPLETED',
    cadenceMinutes: 1440,
    // expiresAt is a NOT NULL column; for retro-eligible rows it is
    // typically already past, but the tick query does NOT consult it.
    expiresAt: new Date(Date.now() - 86400_000),
  }).returning()
  const predictionId = p!.id

  if (overrides.seedRetrospective) {
    await db.execute(sql`
      INSERT INTO retrospectives (
        prediction_id, prediction_outcome, capture_outcome,
        score_v, score_r, score_w, score_t, composite,
        causal_md, summary_md
      )
      VALUES (
        ${predictionId}::uuid,
        'NO_DATA'::prediction_outcome,
        'UNKNOWN'::capture_outcome,
        50, 50, 50, 50, 50,
        'seed', 'seed'
      )
    `)
  }

  return predictionId
}

/** Builds a queue mock that captures every `add(...)` call. */
function makeMockQueue() {
  const calls: Array<{ name: string; data: { predictionId: string } }> = []
  const add = mock(async (name: string, data: { predictionId: string }) => {
    calls.push({ name, data })
    return { id: `mock-${calls.length}` }
  })
  const queue: RetrospectiveQueueLike = { add }
  return { queue, add, calls }
}

async function redisReachable(): Promise<boolean> {
  const c = new IORedis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  try {
    await c.connect()
    await c.quit()
    return true
  } catch {
    try { c.disconnect() } catch { /* ignore */ }
    return false
  }
}

describe('tickRetrospective', () => {
  test('COMPLETED prediction past M=7 days with no retro → enqueues one retro job', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `retro-due-${Date.now()}`, {
      status: 'COMPLETED',
      windowDateOffsetDays: -8,
    })
    const { queue, add, calls } = makeMockQueue()

    const n = await tickRetrospective({ db, queue, limit: 100_000 })

    // Assert the seeded id was enqueued exactly once with the 'retro' job
    // name. The shared test DB may have other due rows from prior tests,
    // so we only assert on our row.
    expect(n).toBeGreaterThanOrEqual(1)
    expect(add).toHaveBeenCalled()
    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(1)
    expect(matching[0]!.name).toBe('retro')
  })

  test('prediction with retrospective already exists → not enqueued', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `retro-exists-${Date.now()}`, {
      status: 'COMPLETED',
      windowDateOffsetDays: -8,
      seedRetrospective: true,
    })
    const { queue, calls } = makeMockQueue()

    await tickRetrospective({ db, queue, limit: 100_000 })

    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('PROPOSED status (not COMPLETED/EXPIRED) → not enqueued', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `retro-proposed-${Date.now()}`, {
      status: 'PROPOSED',
      windowDateOffsetDays: -8,
    })
    const { queue, calls } = makeMockQueue()

    await tickRetrospective({ db, queue, limit: 100_000 })

    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('window_date too recent (3 days ago, M=7) → not enqueued', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `retro-recent-${Date.now()}`, {
      status: 'COMPLETED',
      windowDateOffsetDays: -3,
    })
    const { queue, calls } = makeMockQueue()

    await tickRetrospective({ db, queue, limit: 100_000 })

    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('multiple due predictions → enqueues one job per row, returns count', async () => {
    const { db } = ctx
    const stamp = `retro-multi-${Date.now()}`
    const ids = [
      await seedPrediction(db, `${stamp}-a`, { status: 'COMPLETED', windowDateOffsetDays: -8 }),
      await seedPrediction(db, `${stamp}-b`, { status: 'EXPIRED', windowDateOffsetDays: -10 }),
      await seedPrediction(db, `${stamp}-c`, { status: 'COMPLETED', windowDateOffsetDays: -15 }),
    ]
    const { queue, calls } = makeMockQueue()

    const n = await tickRetrospective({ db, queue, limit: 100_000 })

    // Total enqueue count ≥ 3 (other rows in the shared DB may also be due).
    expect(n).toBeGreaterThanOrEqual(3)

    for (const id of ids) {
      const matching = calls.filter((c) => c.data.predictionId === id)
      expect(matching.length).toBe(1)
      expect(matching[0]!.name).toBe('retro')
    }
  })
})

// `processRetrospectiveJob` is pure: it never touches the real DB
// because the `runRetrospectiveAgent` dep is injected. So we can pass a
// stub `Db`-shaped value — the mock never inspects it.
const STUB_DB = {} as Db

/** Build a configurable mock that captures every call. */
function makeMockAgent(returnVal: RunRetrospectiveAgentOutput) {
  const calls: Array<{ db: Db; input: RunRetrospectiveAgentInput }> = []
  const fn = mock(async (db: Db, input: RunRetrospectiveAgentInput) => {
    calls.push({ db, input })
    return returnVal
  })
  const deps: RetrospectiveDeps = {
    runRetrospectiveAgent: fn as unknown as RetrospectiveDeps['runRetrospectiveAgent'],
  }
  return { deps, fn, calls }
}

describe('processRetrospectiveJob', () => {
  test('happy path: forwards predictionId, returns retro id + outcomes', async () => {
    const { deps, fn, calls } = makeMockAgent({
      retrospectiveId: 'retro-123',
      caseLibraryEntryId: 'case-123',
      predictionOutcome: 'HIT',
      captureOutcome: 'CAPTURED',
      composite: 87,
    })

    const out = await processRetrospectiveJob(
      STUB_DB,
      { predictionId: 'pred-1' },
      deps,
    )

    expect(out).toEqual({
      retrospectiveId: 'retro-123',
      predictionOutcome: 'HIT',
      captureOutcome: 'CAPTURED',
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(calls[0]!.input.predictionId).toBe('pred-1')
    // tick never sets reviewerNotes — handler must NOT pass it through
    // when absent, preserving T21's optional-property contract.
    expect(calls[0]!.input.reviewerNotes).toBeUndefined()
  })

  test('forwards reviewerNotes when present and non-empty', async () => {
    const { deps, calls } = makeMockAgent({
      retrospectiveId: 'retro-2',
      caseLibraryEntryId: 'case-2',
      predictionOutcome: 'MISS',
      captureOutcome: 'NOT_CAPTURED',
      composite: 40,
    })
    const data: RetrospectiveJobData = {
      predictionId: 'pred-2',
      reviewerNotes: 'reviewer thought signal was weak',
    }

    const out = await processRetrospectiveJob(STUB_DB, data, deps)

    expect(out.predictionOutcome).toBe('MISS')
    expect(out.captureOutcome).toBe('NOT_CAPTURED')
    expect(calls[0]!.input.reviewerNotes).toBe('reviewer thought signal was weak')
  })

  test('error path: runRetrospectiveAgent failure propagates from the handler', async () => {
    const failing: RetrospectiveDeps = {
      runRetrospectiveAgent: (async () => {
        throw new Error('LLM exploded')
      }) as unknown as RetrospectiveDeps['runRetrospectiveAgent'],
    }

    await expect(
      processRetrospectiveJob(
        STUB_DB,
        { predictionId: 'pred-err' },
        failing,
      ),
    ).rejects.toThrow(/LLM exploded/)
  })
})

describe('scheduleRetrospectiveTick', () => {
  test('returns a clearable timer without firing real Redis traffic', () => {
    const { db } = ctx
    const { queue } = makeMockQueue()
    // Use a long interval so the callback never actually runs in this test.
    const timer = scheduleRetrospectiveTick({ db, queue }, 60 * 60 * 1000)
    try {
      expect(timer).toBeDefined()
    } finally {
      clearInterval(timer)
    }
  })
})

// Probe Redis at module load time so test.skipIf can use the boolean directly.
const REDIS_OK = await redisReachable()

describe('createRetrospectiveWorker (Redis-gated)', () => {
  test.skipIf(!REDIS_OK)(
    'creates a Worker bound to the retrospective queue and closes cleanly',
    async () => {
      const worker = createRetrospectiveWorker()
      try {
        expect(worker.name).toBe('retrospective')
      } finally {
        await worker.close()
      }
    },
  )
})
