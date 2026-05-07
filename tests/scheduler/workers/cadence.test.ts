import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import {
  scheduleCadenceTick,
  tickCadence,
  type CadenceQueueLike,
} from '@/scheduler/workers/cadence'
import { createTestDb } from '../../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

/**
 * Seeds a prediction with a fresh region/vehicleClass/taskClass triple so each
 * test row has the right FK ancestry. Returns the prediction id.
 */
async function seedPrediction(
  db: typeof ctx.db,
  label: string,
  overrides: Partial<{
    status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
    expiresAt: Date
    lastIncrAt: Date | null
    cadenceMinutes: number
  }> = {},
): Promise<string> {
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
    status: overrides.status ?? 'PROPOSED',
    cadenceMinutes: overrides.cadenceMinutes ?? 1440,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 9 * 86400_000),
    ...(overrides.lastIncrAt !== undefined ? { lastIncrAt: overrides.lastIncrAt } : {}),
  }).returning()
  return p!.id
}

/** Builds a queue mock that captures every `add(...)` call. */
function makeMockQueue() {
  const calls: Array<{ name: string; data: { predictionId: string; kind: 'INCR' } }> = []
  const add = mock(async (name: string, data: { predictionId: string; kind: 'INCR' }) => {
    calls.push({ name, data })
    return { id: `mock-${calls.length}` }
  })
  const queue: CadenceQueueLike = { add }
  return { queue, add, calls }
}

describe('tickCadence', () => {
  test('PROPOSED with last_incr_at = NULL → enqueues one INCR job', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `cad-null-${Date.now()}`, {
      status: 'PROPOSED',
      lastIncrAt: null,
    })
    const { queue, add, calls } = makeMockQueue()

    const n = await tickCadence({ db, queue, limit: 100_000 })

    // Other tests in this file may also leave PROPOSED rows lying around in the
    // shared DB; assert the seeded id was definitely enqueued exactly once and
    // every enqueue was an INCR for an existing prediction.
    expect(n).toBeGreaterThanOrEqual(1)
    expect(add).toHaveBeenCalled()
    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(1)
    expect(matching[0]!.name).toBe('incr')
    expect(matching[0]!.data.kind).toBe('INCR')
  })

  test('PROPOSED with last_incr_at = NOW() and cadence=60min → not yet due', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `cad-fresh-${Date.now()}`, {
      status: 'PROPOSED',
      lastIncrAt: new Date(),       // just refreshed
      cadenceMinutes: 60,           // 1h cadence — still in cool-down
    })
    const { queue, calls } = makeMockQueue()

    await tickCadence({ db, queue, limit: 100_000 })

    // The just-seeded row must NOT appear in the enqueue calls. We don't
    // assert the global count — other rows in the shared DB may legitimately
    // be due — only that THIS row was filtered out.
    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('non-PROPOSED status (APPROVED) → not enqueued', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `cad-approved-${Date.now()}`, {
      status: 'APPROVED',
      lastIncrAt: null,             // would otherwise be due
    })
    const { queue, calls } = makeMockQueue()

    await tickCadence({ db, queue, limit: 100_000 })

    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('expired prediction (expires_at < NOW()) → not enqueued', async () => {
    const { db } = ctx
    const id = await seedPrediction(db, `cad-expired-${Date.now()}`, {
      status: 'PROPOSED',
      lastIncrAt: null,
      expiresAt: new Date(Date.now() - 60_000),  // 1 min in the past
    })
    const { queue, calls } = makeMockQueue()

    await tickCadence({ db, queue, limit: 100_000 })

    const matching = calls.filter((c) => c.data.predictionId === id)
    expect(matching.length).toBe(0)
  })

  test('multiple due predictions → enqueues one job per row, returns count', async () => {
    const { db } = ctx
    const stamp = `cad-multi-${Date.now()}`
    const ids = [
      await seedPrediction(db, `${stamp}-a`, { status: 'PROPOSED', lastIncrAt: null }),
      await seedPrediction(db, `${stamp}-b`, { status: 'PROPOSED', lastIncrAt: null }),
      await seedPrediction(db, `${stamp}-c`, { status: 'PROPOSED', lastIncrAt: null }),
    ]
    const { queue, calls } = makeMockQueue()

    const n = await tickCadence({ db, queue, limit: 100_000 })

    // Total enqueue count ≥ 3 (other rows in the shared DB may also be due).
    expect(n).toBeGreaterThanOrEqual(3)

    // The 3 we just seeded must each appear exactly once as INCR jobs.
    for (const id of ids) {
      const matching = calls.filter((c) => c.data.predictionId === id)
      expect(matching.length).toBe(1)
      expect(matching[0]!.data.kind).toBe('INCR')
      expect(matching[0]!.name).toBe('incr')
    }
  })
})

describe('scheduleCadenceTick', () => {
  test('returns a clearable timer without firing real Redis traffic', () => {
    const { db } = ctx
    const { queue } = makeMockQueue()
    // Use a long interval so the callback never actually runs in this test.
    const timer = scheduleCadenceTick({ db, queue }, 60 * 60 * 1000)
    try {
      expect(timer).toBeDefined()
    } finally {
      clearInterval(timer)
    }
  })
})
