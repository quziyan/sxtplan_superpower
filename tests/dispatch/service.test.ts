import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { enqueueDispatch, requestCancel } from '@/dispatch/service'
import { dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function setup(db: typeof ctx.db, label: string) {
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

describe('enqueueDispatch + requestCancel (mock adapter)', () => {
  test('enqueue creates QUEUED → SENT with externalId', async () => {
    const { db } = ctx
    const p = await setup(db, `disp-q-${Date.now()}`)
    const task = await enqueueDispatch(db, { predictionId: p.id })
    expect(task.state).toBe('SENT')
    expect(task.adapterKey).toBe('mock')
    expect(task.externalId).toMatch(/^mock-/)
    expect(task.sentAt).not.toBeNull()
  })

  test('paramsJson persisted', async () => {
    const { db } = ctx
    const p = await setup(db, `disp-params-${Date.now()}`)
    const task = await enqueueDispatch(db, {
      predictionId: p.id,
      paramsJson: { camera_ids: ['CAM-001', 'CAM-002'] },
    })
    expect(task.paramsJson).toEqual({ camera_ids: ['CAM-001', 'CAM-002'] })
  })

  test('requestCancel transitions to CANCELLED with reason', async () => {
    const { db } = ctx
    const p = await setup(db, `disp-cancel-${Date.now()}`)
    const sent = await enqueueDispatch(db, { predictionId: p.id })
    const cancelled = await requestCancel(db, sent.id, 'analyst withdrew approval')
    expect(cancelled.state).toBe('CANCELLED')
    expect(cancelled.cancellationReason).toBe('analyst withdrew approval')
    expect(cancelled.completedAt).not.toBeNull()
  })

  test('requestCancel on missing dispatch throws', async () => {
    const { db } = ctx
    await expect(requestCancel(db, '00000000-0000-0000-0000-000000000000', 'x'))
      .rejects.toThrow(/not found/)
  })

  test('unknown adapter key throws on enqueue', async () => {
    const { db } = ctx
    const p = await setup(db, `disp-bad-${Date.now()}`)
    await expect(enqueueDispatch(db, { predictionId: p.id, adapterKey: 'nope' }))
      .rejects.toThrow(/not registered/)
  })
})
