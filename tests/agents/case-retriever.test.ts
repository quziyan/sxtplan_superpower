import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { retrieveCases } from '@/agents/case-retriever'
import { predictions } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function makeRegion(db: typeof ctx.db, label: string) {
  return (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
}

describe('retrieveCases', () => {
  test('returns COMPLETED as HIT and EXPIRED as MISS, ordered DESC by window_date, limited', async () => {
    const { db } = ctx
    const stamp = `case-${Date.now()}`
    const reg = await makeRegion(db, stamp)
    const [vc] = await db.insert(vehicleClasses).values({ name: `vc-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `tc-${stamp}`, level: 1 }).returning()

    // Insert 6 historical predictions:
    //   3 COMPLETED, 2 EXPIRED, 1 PROPOSED (excluded);
    //   K_days span: 5, 6, 7, 8, 9, 10 (target K=8 → window kMin=5, kMax=11 → all in range)
    const past = [
      { kDays: 5,  status: 'COMPLETED' as const, dateStr: '2026-04-01', conf: 70 },
      { kDays: 6,  status: 'EXPIRED'   as const, dateStr: '2026-04-05', conf: 30 },
      { kDays: 7,  status: 'COMPLETED' as const, dateStr: '2026-04-10', conf: 80 },
      { kDays: 8,  status: 'EXPIRED'   as const, dateStr: '2026-04-15', conf: 25 },
      { kDays: 9,  status: 'COMPLETED' as const, dateStr: '2026-04-20', conf: 75 },
      { kDays: 10, status: 'PROPOSED'  as const, dateStr: '2026-04-25', conf: 50 },
    ]
    for (const p of past) {
      await db.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: vc!.id,
        regionId: reg.id, regionVersion: reg.version,
        windowDate: new Date(p.dateStr), windowHalf: 'AM',
        vehicleClassId: vc!.id, taskClassId: tc!.id,
        kDays: p.kDays, confidenceNow: p.conf, status: p.status,
        expiresAt: new Date(Date.now() + 86400_000),
      })
    }

    const cases = await retrieveCases(ctx.db, {
      vehicleClassId: vc!.id, taskClassId: tc!.id, kDays: 8,
    })
    // Expect exactly 5 (default topK), excluding the PROPOSED one
    expect(cases.length).toBe(5)
    // Verify mapping
    const outcomes = cases.map(c => c.outcome).sort()
    expect(outcomes).toEqual((['HIT', 'HIT', 'HIT', 'MISS', 'MISS'] as const).slice().sort())
    // Verify ordering: dates descending
    const dateStrings = cases.map(c => c.summary.slice(0, 10))
    expect(dateStrings).toEqual([...dateStrings].sort().reverse())
  })

  test('K_days outside window excluded', async () => {
    const { db } = ctx
    const stamp = `case-out-${Date.now()}`
    const reg = await makeRegion(db, stamp)
    const [vc] = await db.insert(vehicleClasses).values({ name: `vc-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `tc-${stamp}`, level: 1 }).returning()

    // K=20 in DB, target K=5 → 5±3=[2,8] → 20 outside → 0 cases
    await db.insert(predictions).values({
      sourceKind: 'WATCHLIST', sourceId: vc!.id,
      regionId: reg.id, regionVersion: reg.version,
      windowDate: new Date('2026-04-01'), windowHalf: 'AM',
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      kDays: 20, confidenceNow: 50, status: 'COMPLETED',
      expiresAt: new Date(Date.now() + 86400_000),
    })

    const cases = await retrieveCases(ctx.db, {
      vehicleClassId: vc!.id, taskClassId: tc!.id, kDays: 5,
    })
    expect(cases.length).toBe(0)
  })

  test('topK overrides default 5', async () => {
    const { db } = ctx
    const stamp = `case-topk-${Date.now()}`
    const reg = await makeRegion(db, stamp)
    const [vc] = await db.insert(vehicleClasses).values({ name: `vc-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `tc-${stamp}`, level: 1 }).returning()

    for (let i = 0; i < 4; i++) {
      await db.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: vc!.id,
        regionId: reg.id, regionVersion: reg.version,
        windowDate: new Date(`2026-04-0${i + 1}`), windowHalf: 'AM',
        vehicleClassId: vc!.id, taskClassId: tc!.id,
        kDays: 5, confidenceNow: 60, status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 86400_000),
      })
    }
    const cases = await retrieveCases(ctx.db, {
      vehicleClassId: vc!.id, taskClassId: tc!.id, kDays: 5, topK: 2,
    })
    expect(cases.length).toBe(2)
  })
})
