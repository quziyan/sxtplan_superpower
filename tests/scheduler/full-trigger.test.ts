import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { shouldTriggerFull } from '@/scheduler/full-trigger'
import { confidenceSnapshots, newsEvidence, newsItems, predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function seed(db: typeof ctx.db, label: string) {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vc!.id,
    regionId: reg.id, regionVersion: reg.version,
    windowDate: new Date('2026-05-15'), windowHalf: 'AM',
    vehicleClassId: vc!.id, taskClassId: tc!.id,
    kDays: 9, expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()
  return p!
}

async function snap(db: typeof ctx.db, predictionId: string, kind: 'INCR' | 'FULL', confidence: number, ts?: Date) {
  await db.insert(confidenceSnapshots).values({
    predictionId, kind, confidence,
    operator: 'PredictionAgent',
    ...(ts ? { occurredAt: ts } : {}),
  })
}

describe('shouldTriggerFull', () => {
  test('P5: manual trigger short-circuits', async () => {
    const p = await seed(ctx.db, `tr-p5-${Date.now()}`)
    const r = await shouldTriggerFull(ctx.db, p.id, { manualTrigger: true })
    expect(r.triggered).toBe(true)
    expect(r.priority).toBe('P5')
  })

  test('no history → not triggered', async () => {
    const p = await seed(ctx.db, `tr-none-${Date.now()}`)
    const r = await shouldTriggerFull(ctx.db, p.id)
    expect(r.triggered).toBe(false)
  })

  test('P1: 5 INCR after FULL → triggered', async () => {
    const p = await seed(ctx.db, `tr-p1-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date(Date.now() - 86400_000))
    for (let i = 0; i < 5; i++) await snap(ctx.db, p.id, 'INCR', 50 + i)
    const r = await shouldTriggerFull(ctx.db, p.id)
    expect(r.triggered).toBe(true)
    expect(r.priority).toBe('P1')
  })

  test('P3: 10+ new evidence → triggered (and not yet hitting P1)', async () => {
    const p = await seed(ctx.db, `tr-p3-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date(Date.now() - 86400_000))
    // 4 INCR (under P1 threshold of 5)
    for (let i = 0; i < 4; i++) await snap(ctx.db, p.id, 'INCR', 50 + i)
    // 10 new evidence rows
    for (let i = 0; i < 10; i++) {
      const stamp = `${Date.now()}-${i}`
      const [n] = await ctx.db.insert(newsItems).values({
        url: `https://ev.example/${stamp}`, sourceKind: 'MAINSTREAM',
        sourceLabel: 'X', title: 'x', contentHash: stamp,
      }).returning()
      await ctx.db.insert(newsEvidence).values({
        predictionId: p.id, newsId: n!.id, weight: 'MED',
      })
    }
    const r = await shouldTriggerFull(ctx.db, p.id)
    expect(r.triggered).toBe(true)
    expect(r.priority).toBe('P3')
  })

  test('thresholds override applies', async () => {
    const p = await seed(ctx.db, `tr-thr-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date(Date.now() - 86400_000))
    for (let i = 0; i < 3; i++) await snap(ctx.db, p.id, 'INCR', 50 + i)
    // Override P1 threshold to 3 → should trigger
    const r = await shouldTriggerFull(ctx.db, p.id, { thresholds: { incrCountSinceFull: 3 } })
    expect(r.triggered).toBe(true)
    expect(r.priority).toBe('P1')
  })
})
