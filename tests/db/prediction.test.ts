import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import {
  confidenceSnapshots, newsEvidence, newsItems, predictions,
} from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
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

describe('prediction schema', () => {
  test('insert prediction + snapshot + news + evidence', async () => {
    const { db } = ctx
    const stamp = Date.now()
    const reg = await makeRegion(db, `pred-test-${stamp}`)
    const [vc] = await db.insert(vehicleClasses).values({ name: `应急车-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `抢险-${stamp}`, level: 1 }).returning()

    const [p] = await db.insert(predictions).values({
      sourceKind: 'WATCHLIST',
      sourceId: vc!.id, // 占位 uuid; 跨表 FK 不强制此处
      regionId: reg.id,
      regionVersion: reg.version,
      windowDate: new Date('2026-05-15'),
      windowHalf: 'AM',
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      kDays: 9,
      expiresAt: new Date(Date.now() + 9 * 86400_000),
    }).returning()
    expect(p!.confidenceNow).toBe(0)
    expect(p!.status).toBe('PROPOSED')

    const [snap] = await db.insert(confidenceSnapshots).values({
      predictionId: p!.id, kind: 'FULL', confidence: 50,
      reasoning: '初次锚点', operator: 'PredictionAgent',
    }).returning()
    expect(snap!.confidence).toBe(50)

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
    const reg = await makeRegion(db, `pred-bad-${stamp}`)
    const [vc] = await db.insert(vehicleClasses).values({ name: `v-bad-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `t-bad-${stamp}`, level: 1 }).returning()
    await expect(Promise.resolve(db.insert(predictions).values({
      sourceKind: 'WATCHLIST', sourceId: vc!.id,
      regionId: reg.id, regionVersion: reg.version,
      windowDate: new Date('2026-05-20'), windowHalf: 'AM',
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      kDays: 14, confidenceNow: 150,
      expiresAt: new Date(Date.now() + 86400_000),
    }))).rejects.toThrow()
  })
})
