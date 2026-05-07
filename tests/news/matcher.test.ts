import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { findMatchingPredictions } from '@/news/matcher'
import { newsItems, predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function makeRegion(db: typeof ctx.db, name: string): Promise<{ id: string; version: number }> {
  return (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${name}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
}

async function makeVT(db: typeof ctx.db, vName: string, tName: string) {
  const [vc] = await db.insert(vehicleClasses).values({ name: vName, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: tName, level: 1 }).returning()
  return { vc: vc!, tc: tc! }
}

async function makePrediction(
  db: typeof ctx.db,
  reg: { id: string; version: number },
  vc: { id: string }, tc: { id: string },
  status: 'PROPOSED' | 'EXPIRED' | 'COMPLETED' = 'PROPOSED',
  expiresInDays = 9,
) {
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vc.id,
    regionId: reg.id, regionVersion: reg.version,
    windowDate: new Date('2026-05-15'), windowHalf: 'AM',
    vehicleClassId: vc.id, taskClassId: tc.id,
    kDays: 9, status,
    expiresAt: new Date(Date.now() + expiresInDays * 86400_000),
  }).returning()
  return p!
}

async function makeNews(db: typeof ctx.db, title: string, summary: string, regionIds: string[]) {
  const stamp = Date.now() + Math.random()
  const [n] = await db.insert(newsItems).values({
    url: `https://match.example/${stamp}`,
    sourceKind: 'MAINSTREAM', sourceLabel: 'Test',
    title, summaryZh: summary,
    contentHash: `h-${stamp}`,
    matchedRegions: regionIds,
  }).returning()
  return n!
}

describe('findMatchingPredictions', () => {
  test('region + V + T match → reason=region+vehicle+task', async () => {
    const stamp = Date.now()
    const reg = await makeRegion(ctx.db, `match-r-${stamp}`)
    const { vc, tc } = await makeVT(ctx.db, `应急救援车${stamp}`, `抢险救援${stamp}`)
    const pred = await makePrediction(ctx.db, reg, vc, tc)
    const news = await makeNews(ctx.db,
      `${vc.name}部署${tc.name}`,
      'irrelevant summary',
      [reg.id])

    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(1)
    expect(r[0]!.predictionId).toBe(pred.id)
    expect(r[0]!.reason).toBe('region+vehicle+task')
  })

  test('region + V only → reason=region+vehicle', async () => {
    const stamp = Date.now() + 1
    const reg = await makeRegion(ctx.db, `match-r-v-${stamp}`)
    const { vc, tc } = await makeVT(ctx.db, `特殊车${stamp}`, `特殊任务${stamp}`)
    const pred = await makePrediction(ctx.db, reg, vc, tc)
    const news = await makeNews(ctx.db,
      `${vc.name}动态`, 'no task name',
      [reg.id])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(1)
    expect(r[0]!.predictionId).toBe(pred.id)
    expect(r[0]!.reason).toBe('region+vehicle')
  })

  test('region only → reason=region-only', async () => {
    const stamp = Date.now() + 2
    const reg = await makeRegion(ctx.db, `match-r-only-${stamp}`)
    const { vc, tc } = await makeVT(ctx.db, `vname-${stamp}`, `tname-${stamp}`)
    const pred = await makePrediction(ctx.db, reg, vc, tc)
    const news = await makeNews(ctx.db,
      `unrelated title`, 'unrelated summary',
      [reg.id])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(1)
    expect(r[0]!.predictionId).toBe(pred.id)
    expect(r[0]!.reason).toBe('region-only')
  })

  test('returns empty for news with empty matched_regions', async () => {
    const news = await makeNews(ctx.db, 'irrelevant', 'no regions', [])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(0)
  })

  test('excludes EXPIRED predictions', async () => {
    const stamp = Date.now() + 3
    const reg = await makeRegion(ctx.db, `match-exp-${stamp}`)
    const { vc, tc } = await makeVT(ctx.db, `v-exp-${stamp}`, `t-exp-${stamp}`)
    await makePrediction(ctx.db, reg, vc, tc, 'EXPIRED')
    const news = await makeNews(ctx.db, 'irrelevant', 'no v t', [reg.id])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(0)
  })

  test('excludes predictions expired by expires_at', async () => {
    const stamp = Date.now() + 4
    const reg = await makeRegion(ctx.db, `match-pastdue-${stamp}`)
    const { vc, tc } = await makeVT(ctx.db, `v-past-${stamp}`, `t-past-${stamp}`)
    // expiresInDays=-1 → 已过 expiresAt
    await makePrediction(ctx.db, reg, vc, tc, 'PROPOSED', -1)
    const news = await makeNews(ctx.db, 'x', 'x', [reg.id])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(0)
  })

  test('orders strongest match first', async () => {
    const stamp = Date.now() + 5
    const reg = await makeRegion(ctx.db, `match-order-${stamp}`)
    const { vc: vc1, tc: tc1 } = await makeVT(ctx.db, `vboth-${stamp}`, `tboth-${stamp}`)
    const { vc: vc2, tc: tc2 } = await makeVT(ctx.db, `vronly-${stamp}`, `tronly-${stamp}`)
    const pBoth = await makePrediction(ctx.db, reg, vc1, tc1)
    const pRegion = await makePrediction(ctx.db, reg, vc2, tc2)
    const news = await makeNews(ctx.db,
      `${vc1.name}执行${tc1.name}`, '',
      [reg.id])
    const r = await findMatchingPredictions(ctx.db, news.id)
    expect(r.length).toBe(2)
    // pBoth (V+T match) comes before pRegion (region-only)
    expect(r[0]!.predictionId).toBe(pBoth.id)
    expect(r[0]!.reason).toBe('region+vehicle+task')
    expect(r[1]!.predictionId).toBe(pRegion.id)
    expect(r[1]!.reason).toBe('region-only')
  })
})
