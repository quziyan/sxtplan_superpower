import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { computeDriftSinceLastFull } from '@/scheduler/drift-detector'
import { confidenceSnapshots, predictions } from '@/db/schema/prediction'
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

async function snap(db: typeof ctx.db, predictionId: string, kind: 'INCR' | 'FULL' | 'MANUAL', confidence: number, ts: Date) {
  await db.insert(confidenceSnapshots).values({
    predictionId, kind, confidence, occurredAt: ts,
    operator: 'PredictionAgent',
  })
}

describe('computeDriftSinceLastFull', () => {
  test('returns 0 when no FULL exists', async () => {
    const p = await seed(ctx.db, `drift-empty-${Date.now()}`)
    expect(await computeDriftSinceLastFull(ctx.db, p.id)).toBe(0)
  })

  test('returns 0 when only one snapshot (just FULL)', async () => {
    const p = await seed(ctx.db, `drift-fullonly-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date('2026-05-01'))
    expect(await computeDriftSinceLastFull(ctx.db, p.id)).toBe(0)
  })

  test('sums absolute INCR deltas after FULL', async () => {
    const p = await seed(ctx.db, `drift-sum-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date('2026-05-01T00:00:00Z'))
    await snap(ctx.db, p.id, 'INCR', 55, new Date('2026-05-02T00:00:00Z'))  // +5
    await snap(ctx.db, p.id, 'INCR', 58, new Date('2026-05-03T00:00:00Z'))  // +3
    await snap(ctx.db, p.id, 'INCR', 53, new Date('2026-05-04T00:00:00Z'))  // -5
    // |5| + |3| + |5| = 13
    expect(await computeDriftSinceLastFull(ctx.db, p.id)).toBe(13)
  })

  test('ignores snapshots before last FULL', async () => {
    const p = await seed(ctx.db, `drift-pre-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date('2026-05-01T00:00:00Z'))
    await snap(ctx.db, p.id, 'INCR', 60, new Date('2026-05-02T00:00:00Z'))  // before second FULL,被 reset
    await snap(ctx.db, p.id, 'FULL', 70, new Date('2026-05-03T00:00:00Z'))
    await snap(ctx.db, p.id, 'INCR', 75, new Date('2026-05-04T00:00:00Z'))  // +5
    expect(await computeDriftSinceLastFull(ctx.db, p.id)).toBe(5)
  })

  test('MANUAL不计入累加', async () => {
    const p = await seed(ctx.db, `drift-man-${Date.now()}`)
    await snap(ctx.db, p.id, 'FULL', 50, new Date('2026-05-01T00:00:00Z'))
    await snap(ctx.db, p.id, 'INCR', 55, new Date('2026-05-02T00:00:00Z'))   // +5
    await snap(ctx.db, p.id, 'MANUAL', 90, new Date('2026-05-03T00:00:00Z')) // 不计 (kind != INCR)
    await snap(ctx.db, p.id, 'INCR', 92, new Date('2026-05-04T00:00:00Z'))   // |92-90|=2
    expect(await computeDriftSinceLastFull(ctx.db, p.id)).toBe(7) // 5 + 2
  })
})
