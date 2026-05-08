import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { tickCadence, type CadenceQueueLike } from '@/scheduler/workers/cadence'
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
    windowDate: new Date('2026-12-31'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 7,
    status: overrides.status ?? 'PROPOSED',
    cadenceMinutes: overrides.cadenceMinutes ?? 60,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86400_000),
    ...(overrides.lastIncrAt !== undefined ? { lastIncrAt: overrides.lastIncrAt } : {}),
  }).returning()
  return p!.id
}

describe('tickCadence (m5 G1: enqueue → fullRecalcQueue)', () => {
  test('enqueues full-recalc for PROPOSED predictions whose cadence elapsed', async () => {
    const predId = await seedPrediction(ctx.db, `cad-due-${Date.now()}`, {
      status: 'PROPOSED',
      lastIncrAt: null,
    })

    const calls: Array<{ name: string; data: { predictionId: string } }> = []
    const mockQueue: CadenceQueueLike = {
      add: async (name, data) => { calls.push({ name, data }); return undefined },
    }

    const n = await tickCadence({ db: ctx.db, queue: mockQueue, limit: 100_000 })
    expect(n).toBeGreaterThanOrEqual(1)

    const myCall = calls.find(c => c.data.predictionId === predId)
    expect(myCall).toBeDefined()
    expect(myCall!.name).toBe('full-recalc')
    // G1: payload must NOT carry the legacy `kind: 'INCR'` field — fullRecalcQueue
    // jobs only need { predictionId } (and optional manualTrigger added later).
    expect((myCall!.data as any).kind).toBeUndefined()
  })

  test('does not enqueue when no PROPOSED predictions are due', async () => {
    const predId = await seedPrediction(ctx.db, `cad-fresh-${Date.now()}`, {
      status: 'PROPOSED',
      lastIncrAt: new Date(),  // just refreshed → still in cool-down
      cadenceMinutes: 60,
    })

    const calls: Array<{ name: string; data: any }> = []
    const mockQueue: CadenceQueueLike = {
      add: async (name, data) => { calls.push({ name, data }); return undefined },
    }

    await tickCadence({ db: ctx.db, queue: mockQueue, limit: 100_000 })

    const myCall = calls.find(c => c.data.predictionId === predId)
    expect(myCall).toBeUndefined()
  })
})
