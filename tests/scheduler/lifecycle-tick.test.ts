/**
 * lifecycle-tick worker — 闭合 view-data-contract X2(7 status 全闭环)。
 *
 * 覆盖 3 个 transition path:
 *   - DISPATCHED → COMPLETED(dispatch_task.state = 'COMPLETED')
 *   - DISPATCHED → EXPIRED(dispatch_task 全部失败族)
 *   - {PROPOSED,VALIDATED,APPROVED,DISPATCHED} 过期 → EXPIRED
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions } from '@/db/schema/prediction'
import { dispatchTasks } from '@/db/schema/dispatch'
import { tickLifecycle } from '@/scheduler/workers/lifecycle-tick'
import { createTestDb } from '../helpers/test-db'

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

let ctx: Awaited<ReturnType<typeof createTestDb>>
let regId: string
let regVer: number
let vcId: string
let tcId: string

beforeAll(async () => {
  ctx = await createTestDb()
  const stamp = Date.now()
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'lt-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  regId = reg.id; regVer = reg.version
  const [v] = await ctx.db.insert(vehicleClasses).values({ name: `lt-v-${stamp}`, level: 1 }).returning()
  const [t] = await ctx.db.insert(taskClasses).values({ name: `lt-t-${stamp}`, level: 1 }).returning()
  vcId = v!.id; tcId = t!.id
})

afterAll(async () => { await ctx.cleanup() })

async function seedPred(status: 'DISPATCHED' | 'APPROVED' | 'PROPOSED' | 'VALIDATED', expiresInDays: number): Promise<string> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  const windowDate = new Date()
  const [p] = await ctx.db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vcId,
    regionId: regId, regionVersion: regVer,
    windowDate, windowHalf: 'AM',
    vehicleClassId: vcId, taskClassId: tcId,
    kDays: 1, confidenceNow: 50, status, expiresAt,
  }).returning()
  return p!.id
}

async function getStatus(id: string): Promise<string> {
  const [row] = await ctx.db.select({ status: predictions.status }).from(predictions).where(sql`id = ${id}`)
  return row!.status
}

async function seedDispatchTask(predId: string, state: 'COMPLETED' | 'SENT' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'): Promise<string> {
  const [dt] = await ctx.db.insert(dispatchTasks).values({
    predictionId: predId,
    adapterKey: 'test-adapter',
    paramsJson: {},
    state,
  }).returning()
  return dt!.id
}

describe('lifecycle-tick', () => {
  test('DISPATCHED + dispatch COMPLETED → prediction COMPLETED', async () => {
    const id = await seedPred('DISPATCHED', 7)
    await seedDispatchTask(id, 'COMPLETED')

    const r = await tickLifecycle(ctx.db)
    expect(r.settledCompleted).toBeGreaterThanOrEqual(1)
    expect(await getStatus(id)).toBe('COMPLETED')
  })

  test('DISPATCHED + dispatch FAILED only → prediction EXPIRED', async () => {
    const id = await seedPred('DISPATCHED', 7)
    await seedDispatchTask(id, 'FAILED')

    const r = await tickLifecycle(ctx.db)
    expect(r.settledExpired).toBeGreaterThanOrEqual(1)
    expect(await getStatus(id)).toBe('EXPIRED')
  })

  test('DISPATCHED + dispatch CANCELLED + TIMED_OUT → prediction EXPIRED', async () => {
    const id = await seedPred('DISPATCHED', 7)
    await seedDispatchTask(id, 'CANCELLED')
    await seedDispatchTask(id, 'TIMED_OUT')

    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('EXPIRED')
  })

  test('DISPATCHED + dispatch SENT (not terminal) → no change', async () => {
    const id = await seedPred('DISPATCHED', 7)
    await seedDispatchTask(id, 'SENT')

    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('DISPATCHED')
  })

  test('PROPOSED past expires_at → EXPIRED', async () => {
    const id = await seedPred('PROPOSED', -1)  // expired yesterday

    const r = await tickLifecycle(ctx.db)
    expect(r.expired).toBeGreaterThanOrEqual(1)
    expect(await getStatus(id)).toBe('EXPIRED')
  })

  test('VALIDATED past expires_at → EXPIRED', async () => {
    const id = await seedPred('VALIDATED', -1)
    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('EXPIRED')
  })

  test('APPROVED past expires_at → EXPIRED', async () => {
    const id = await seedPred('APPROVED', -1)
    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('EXPIRED')
  })

  test('PROPOSED still in window → no change', async () => {
    const id = await seedPred('PROPOSED', 7)
    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('PROPOSED')
  })

  test('idempotent — second tick is no-op on already-settled', async () => {
    const id = await seedPred('DISPATCHED', 7)
    await seedDispatchTask(id, 'COMPLETED')
    await tickLifecycle(ctx.db)
    expect(await getStatus(id)).toBe('COMPLETED')

    const r2 = await tickLifecycle(ctx.db)
    // 不能保证 r2.settledCompleted === 0(其他测试可能并发 seed),但本条 prediction 不再变
    expect(await getStatus(id)).toBe('COMPLETED')
  })
})
