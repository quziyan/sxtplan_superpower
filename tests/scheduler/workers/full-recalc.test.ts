import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import IORedis from 'ioredis'
import { confidenceSnapshots, predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import {
  createFullRecalcWorker,
  processFullRecalcJob,
  type FullRecalcQueueLike,
} from '@/scheduler/workers/full-recalc'
import { createTestDb } from '../../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

/**
 * Seed a prediction with fresh region/vehicleClass/taskClass triple. Returns
 * the prediction row so tests can use its id (and any other fields).
 */
async function seedPrediction(db: typeof ctx.db, label: string) {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-05-15'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 9,
    expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()
  return p!
}

async function snap(
  db: typeof ctx.db,
  predictionId: string,
  kind: 'INCR' | 'FULL',
  confidence: number,
  ts?: Date,
): Promise<void> {
  await db.insert(confidenceSnapshots).values({
    predictionId,
    kind,
    confidence,
    operator: 'PredictionAgent',
    ...(ts ? { occurredAt: ts } : {}),
  })
}

/** Builds a queue mock that captures every `add(...)` call. */
function makeMockQueue() {
  const calls: Array<{ name: string; data: { predictionId: string; kind: 'FULL' } }> = []
  const add = mock(async (name: string, data: { predictionId: string; kind: 'FULL' }) => {
    calls.push({ name, data })
    return { id: `mock-${calls.length}` }
  })
  const queue: FullRecalcQueueLike = { add }
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

describe('processFullRecalcJob', () => {
  test('manualTrigger=true → P5 → enqueues FULL refresh job', async () => {
    const { db } = ctx
    const p = await seedPrediction(db, `fr-p5-${Date.now()}`)
    const { queue, add, calls } = makeMockQueue()

    const result = await processFullRecalcJob(
      db,
      { predictionId: p.id, manualTrigger: true },
      queue,
    )

    expect(result.triggered).toBe(true)
    expect(result.priority).toBe('P5')
    expect(add).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(1)
    expect(calls[0]!.name).toBe('full')
    expect(calls[0]!.data).toEqual({ predictionId: p.id, kind: 'FULL' })
  })

  test('manualTrigger=false + steady state → not triggered → queue.add NOT called', async () => {
    const { db } = ctx
    const p = await seedPrediction(db, `fr-quiet-${Date.now()}`)
    // Recent FULL snapshot (just now) and zero INCRs → all P1-P4 thresholds far off.
    await snap(db, p.id, 'FULL', 50)
    const { queue, add } = makeMockQueue()

    const result = await processFullRecalcJob(
      db,
      { predictionId: p.id, manualTrigger: false },
      queue,
    )

    expect(result.triggered).toBe(false)
    expect(add).not.toHaveBeenCalled()
  })

  test('P1: ≥5 INCR after FULL → triggered → enqueues FULL refresh job', async () => {
    const { db } = ctx
    const p = await seedPrediction(db, `fr-p1-${Date.now()}`)
    // Past FULL anchor, then 5 INCRs after it → crosses P1 threshold (5).
    await snap(db, p.id, 'FULL', 50, new Date(Date.now() - 86400_000))
    for (let i = 0; i < 5; i++) await snap(db, p.id, 'INCR', 50 + i)

    const { queue, add, calls } = makeMockQueue()

    const result = await processFullRecalcJob(
      db,
      { predictionId: p.id },
      queue,
    )

    expect(result.triggered).toBe(true)
    expect(result.priority).toBe('P1')
    expect(add).toHaveBeenCalledTimes(1)
    expect(calls[0]!.name).toBe('full')
    expect(calls[0]!.data).toEqual({ predictionId: p.id, kind: 'FULL' })
  })
})

// Probe Redis at module load time so test.skipIf can use the boolean directly.
const REDIS_OK = await redisReachable()

describe('createFullRecalcWorker (Redis-gated)', () => {
  test.skipIf(!REDIS_OK)(
    'creates a Worker bound to the full-recalc queue and closes cleanly',
    async () => {
      const worker = createFullRecalcWorker()
      try {
        expect(worker.name).toBe('full-recalc')
      } finally {
        await worker.close()
      }
    },
  )
})
