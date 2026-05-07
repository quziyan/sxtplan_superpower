import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { predictions } from '@/db/schema/prediction'
import { retrospectives } from '@/db/schema/retrospective'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function makeRegion(db: typeof ctx.db, label: string): Promise<{ id: string; version: number }> {
  const result = await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `)
  return result[0] as { id: string; version: number }
}

async function makePrediction(db: typeof ctx.db, tag: string): Promise<string> {
  const stamp = `${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}`
  const reg = await makeRegion(db, `retro-${stamp}`)
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${stamp}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${stamp}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-06-01'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 7,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  }).returning()
  return p!.id
}

describe('retrospective schema', () => {
  test('HIT + CAPTURED inserts successfully', async () => {
    const { db } = ctx
    const predictionId = await makePrediction(db, 'hit')
    const [r] = await db.insert(retrospectives).values({
      predictionId,
      predictionOutcome: 'HIT',
      captureOutcome: 'CAPTURED',
      scoreV: 80, scoreR: 75, scoreW: 70, scoreT: 85, composite: 78,
      causalMd: '# 因果链\n命中并捕获',
      summaryMd: '# 摘要\n成功案例',
    }).returning()
    expect(r!.predictionOutcome).toBe('HIT')
    expect(r!.captureOutcome).toBe('CAPTURED')
    expect(r!.outcomeOverridden).toBe(false)
  })

  test('MISS + CAPTURED is rejected by outcome_capture_implies_hit CHECK', async () => {
    const { db } = ctx
    const predictionId = await makePrediction(db, 'misscap')
    await expect(Promise.resolve(db.insert(retrospectives).values({
      predictionId,
      predictionOutcome: 'MISS',
      captureOutcome: 'CAPTURED',
      scoreV: 50, scoreR: 50, scoreW: 50, scoreT: 50, composite: 50,
      causalMd: 'x', summaryMd: 'y',
    }))).rejects.toThrow()
  })

  test('score outside 0..100 is rejected by scores_in_range CHECK', async () => {
    const { db } = ctx
    const predictionId = await makePrediction(db, 'badscore')
    await expect(Promise.resolve(db.insert(retrospectives).values({
      predictionId,
      predictionOutcome: 'MISS',
      captureOutcome: 'NOT_DISPATCHED',
      scoreV: 150, scoreR: 50, scoreW: 50, scoreT: 50, composite: 50,
      causalMd: 'x', summaryMd: 'y',
    }))).rejects.toThrow()
  })

  test('outcomeOverridden=true with NULL overriddenReason is rejected', async () => {
    const { db } = ctx
    const predictionId = await makePrediction(db, 'override')
    await expect(Promise.resolve(db.insert(retrospectives).values({
      predictionId,
      predictionOutcome: 'NO_DATA',
      captureOutcome: 'UNKNOWN',
      scoreV: 10, scoreR: 10, scoreW: 10, scoreT: 10, composite: 10,
      causalMd: 'x', summaryMd: 'y',
      outcomeOverridden: true,
    }))).rejects.toThrow()
  })
})
