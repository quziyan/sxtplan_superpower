import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { dispatchResults, dispatchTasks, mediaAssets } from '@/db/schema/dispatch'
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

async function setupRow(db: typeof ctx.db, label: string) {
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
  return { prediction: p! }
}

describe('dispatch schema', () => {
  test('create dispatch task with default state QUEUED', async () => {
    const { db } = ctx
    const { prediction } = await setupRow(db, `dispatch-q-${Date.now()}`)
    const [d] = await db.insert(dispatchTasks).values({
      predictionId: prediction.id, adapterKey: 'mock',
    }).returning()
    expect(d!.state).toBe('QUEUED')
    expect(d!.paramsJson).toEqual({})
  })

  test('insert result + media assets', async () => {
    const { db } = ctx
    const { prediction } = await setupRow(db, `dispatch-r-${Date.now()}`)
    const [d] = await db.insert(dispatchTasks).values({
      predictionId: prediction.id, adapterKey: 'mock', state: 'IN_PROGRESS',
    }).returning()
    const [r] = await db.insert(dispatchResults).values({
      dispatchId: d!.id, payloadJson: { hello: 'world' },
    }).returning()
    expect(r!.payloadJson).toEqual({ hello: 'world' })
    const [m] = await db.insert(mediaAssets).values({
      dispatchId: d!.id, ossUri: 'oss://bucket/key.jpg',
      sourceUrl: 'https://cam.example/key.jpg', mediaType: 'image',
    }).returning()
    expect(m!.scanStatus).toBe('PENDING')
  })
})
