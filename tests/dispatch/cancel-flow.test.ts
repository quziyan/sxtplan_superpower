import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import {
  initAdapterPool,
  registerAdapter,
  resetAdapterPoolForTests,
} from '@/dispatch/adapter-pool'
import { requestCancel } from '@/dispatch/service'
import type { CameraAdapter, CancelAck, DispatchAck, DispatchRequest, DispatchStatus } from '@/dispatch/types'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

/**
 * Spy adapter — records cancel() calls so tests can assert externalId +
 * idempotency key shape, and lets us inject a synthetic failure mode.
 *
 * Registered under the key 'spy' for the duration of each test; the pool is
 * reset in `afterEach` so other test files keep seeing the default mock.
 */
class SpyAdapter implements CameraAdapter {
  readonly key = 'spy'
  readonly cancelCalls: Array<{ externalId: string; idempotencyKey: string }> = []
  shouldFailCancel = false

  async dispatch(_req: DispatchRequest): Promise<DispatchAck> {
    return { externalId: `spy-${Math.random().toString(36).slice(2, 10)}`, acceptedAt: new Date().toISOString() }
  }
  async cancel(externalId: string, idempotencyKey: string): Promise<CancelAck> {
    this.cancelCalls.push({ externalId, idempotencyKey })
    if (this.shouldFailCancel) throw new Error('spy adapter: simulated cancel failure')
    return { externalId, cancelledAt: new Date().toISOString() }
  }
  async pollStatus(externalId: string): Promise<DispatchStatus> {
    return { externalId, state: 'IN_PROGRESS' }
  }
}

let spy: SpyAdapter

beforeEach(() => {
  resetAdapterPoolForTests()
  initAdapterPool() // re-registers 'mock'
  spy = new SpyAdapter()
  registerAdapter(spy)
})

afterEach(() => {
  resetAdapterPoolForTests()
  initAdapterPool()
})

async function setup(label: string) {
  const { db } = ctx
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

/** Insert a dispatch row directly in a chosen state. We don't go through
 *  enqueueDispatch because most cancel-flow tests need pre-set states like
 *  COMPLETED or CANCEL_PENDING that enqueue can't produce. */
async function seedDispatch(predictionId: string, opts: {
  state: 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCEL_PENDING' | 'CANCELLED'
  adapterKey?: string
  externalId?: string | null
}) {
  const { db } = ctx
  const externalId = opts.externalId === undefined
    ? `${opts.adapterKey ?? 'spy'}-ext-${Math.random().toString(36).slice(2, 10)}`
    : opts.externalId
  const [row] = await db.insert(dispatchTasks).values({
    predictionId,
    adapterKey: opts.adapterKey ?? 'spy',
    state: opts.state,
    ...(externalId !== null ? { externalId } : {}),
    paramsJson: {},
  }).returning()
  return row!
}

describe('Plan-C T24: requestCancel — service layer', () => {
  test('SENT → CANCEL_PENDING + reason set + adapter.cancel called with deterministic idempotency key', async () => {
    const p = await setup(`cancel-sent-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'SENT' })
    const updated = await requestCancel(ctx.db, seeded.id, 'analyst withdrew approval')

    expect(updated.state).toBe('CANCEL_PENDING')
    expect(updated.cancellationReason).toBe('analyst withdrew approval')
    expect(updated.completedAt).toBeNull()
    // Adapter contract: deterministic key so retries don't double-fire.
    expect(spy.cancelCalls).toEqual([
      { externalId: seeded.externalId!, idempotencyKey: `cancel-${seeded.id}` },
    ])
  })

  test('QUEUED → CANCEL_PENDING (no externalId yet → adapter.cancel skipped)', async () => {
    const p = await setup(`cancel-queued-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'QUEUED', externalId: null })
    const updated = await requestCancel(ctx.db, seeded.id, 'pre-send cancel')
    expect(updated.state).toBe('CANCEL_PENDING')
    expect(updated.cancellationReason).toBe('pre-send cancel')
    // No externalId means the backend never accepted the dispatch — nothing to cancel there.
    expect(spy.cancelCalls).toEqual([])
  })

  test('IN_PROGRESS → CANCEL_PENDING (mid-execution cancel)', async () => {
    const p = await setup(`cancel-inprog-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'IN_PROGRESS' })
    const updated = await requestCancel(ctx.db, seeded.id, 'changed our mind')
    expect(updated.state).toBe('CANCEL_PENDING')
    expect(spy.cancelCalls.length).toBe(1)
    expect(spy.cancelCalls[0]!.idempotencyKey).toBe(`cancel-${seeded.id}`)
  })

  test('COMPLETED dispatch rejects cancel with clear error (terminal state)', async () => {
    const p = await setup(`cancel-completed-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'COMPLETED' })
    await expect(requestCancel(ctx.db, seeded.id, 'too late'))
      .rejects.toThrow(/cannot cancel: state is COMPLETED/)
    // Adapter never touched on rejected transition.
    expect(spy.cancelCalls).toEqual([])
    // DB row unchanged.
    const [row] = await ctx.db.select().from(dispatchTasks).where(eq(dispatchTasks.id, seeded.id))
    expect(row!.state).toBe('COMPLETED')
    expect(row!.cancellationReason).toBeNull()
  })

  test('already-CANCEL_PENDING dispatch rejects re-cancel (idempotency at state level)', async () => {
    const p = await setup(`cancel-already-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'CANCEL_PENDING' })
    await expect(requestCancel(ctx.db, seeded.id, 'redundant'))
      .rejects.toThrow(/cannot cancel: state is CANCEL_PENDING/)
    expect(spy.cancelCalls).toEqual([])
  })

  test('non-existent dispatch throws unknown dispatch', async () => {
    await expect(requestCancel(ctx.db, '00000000-0000-0000-0000-000000000000', 'x'))
      .rejects.toThrow(/unknown dispatch/)
  })

  test('adapter.cancel failure does NOT roll back the CANCEL_PENDING write', async () => {
    const p = await setup(`cancel-adapter-fail-${Date.now()}`)
    const seeded = await seedDispatch(p.id, { state: 'SENT' })
    spy.shouldFailCancel = true
    // Service layer swallows adapter errors — DB row is already CANCEL_PENDING.
    const updated = await requestCancel(ctx.db, seeded.id, 'adapter will explode')
    expect(updated.state).toBe('CANCEL_PENDING')
    expect(updated.cancellationReason).toBe('adapter will explode')
    expect(spy.cancelCalls.length).toBe(1)
    // DB confirms persistence.
    const [row] = await ctx.db.select().from(dispatchTasks).where(eq(dispatchTasks.id, seeded.id))
    expect(row!.state).toBe('CANCEL_PENDING')
  })
})
