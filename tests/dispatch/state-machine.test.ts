import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { dispatchResults, dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { advanceFromWebhook } from '@/dispatch/service'
import { canTransition, type DispatchState } from '@/dispatch/state-machine'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.cleanup()
})

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [120, 30],
      [121, 30],
      [121, 31],
      [120, 31],
      [120, 30],
    ],
  ],
}

async function setupPrediction(db: typeof ctx.db, label: string) {
  const reg = (
    await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `)
  )[0]!
  const [vc] = await db
    .insert(vehicleClasses)
    .values({ name: `v-${label}`, level: 1 })
    .returning()
  const [tc] = await db
    .insert(taskClasses)
    .values({ name: `t-${label}`, level: 1 })
    .returning()
  const [p] = await db
    .insert(predictions)
    .values({
      sourceKind: 'WATCHLIST',
      sourceId: vc!.id,
      regionId: reg.id,
      regionVersion: reg.version,
      windowDate: new Date('2026-05-15'),
      windowHalf: 'AM',
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      kDays: 9,
      expiresAt: new Date(Date.now() + 9 * 86400_000),
    })
    .returning()
  return p!
}

async function insertDispatch(
  db: typeof ctx.db,
  predictionId: string,
  state: DispatchState,
  externalId: string,
  adapterKey = 'simulated-gzp',
) {
  const [t] = await db
    .insert(dispatchTasks)
    .values({
      predictionId,
      adapterKey,
      externalId,
      state,
    })
    .returning()
  return t!
}

describe('canTransition (pure)', () => {
  test('QUEUED → SENT: allowed', () => {
    expect(canTransition('QUEUED', 'SENT')).toBe(true)
  })

  test('QUEUED → COMPLETED: forbidden (must traverse SENT/IN_PROGRESS)', () => {
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false)
  })

  test('SENT → QUEUED: forbidden (no backwards)', () => {
    expect(canTransition('SENT', 'QUEUED')).toBe(false)
  })

  test('SENT → COMPLETED: allowed (adapter may skip IN_PROGRESS)', () => {
    expect(canTransition('SENT', 'COMPLETED')).toBe(true)
  })

  test('IN_PROGRESS → COMPLETED: allowed', () => {
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true)
  })

  test('COMPLETED → anything: forbidden (terminal)', () => {
    const others: DispatchState[] = [
      'QUEUED',
      'SENT',
      'IN_PROGRESS',
      'FAILED',
      'REJECTED_BY_ADAPTER',
      'CANCEL_PENDING',
      'CANCELLED',
      'TIMED_OUT',
    ]
    for (const to of others) {
      expect(canTransition('COMPLETED', to)).toBe(false)
    }
  })

  test('FAILED is terminal', () => {
    expect(canTransition('FAILED', 'COMPLETED')).toBe(false)
    expect(canTransition('FAILED', 'IN_PROGRESS')).toBe(false)
  })

  test('CANCEL_PENDING → CANCELLED: allowed', () => {
    expect(canTransition('CANCEL_PENDING', 'CANCELLED')).toBe(true)
  })

  test('CANCEL_PENDING → IN_PROGRESS: forbidden (no resurrection)', () => {
    expect(canTransition('CANCEL_PENDING', 'IN_PROGRESS')).toBe(false)
  })

  test('QUEUED → REJECTED_BY_ADAPTER: allowed', () => {
    expect(canTransition('QUEUED', 'REJECTED_BY_ADAPTER')).toBe(true)
  })
})

describe('advanceFromWebhook (integration)', () => {
  test('QUEUED → SENT updates state and returns row', async () => {
    const { db } = ctx
    const p = await setupPrediction(db, `sm-sent-${Date.now()}`)
    const ext = `ext-sent-${Date.now()}`
    await insertDispatch(db, p.id, 'QUEUED', ext)

    const updated = await advanceFromWebhook(db, {
      externalId: ext,
      adapterKey: 'simulated-gzp',
      newState: 'SENT',
    })

    expect(updated.state).toBe('SENT')
    expect(updated.externalId).toBe(ext)
  })

  test('SENT → COMPLETED with payload writes dispatch_results row', async () => {
    const { db } = ctx
    const p = await setupPrediction(db, `sm-done-${Date.now()}`)
    const ext = `ext-done-${Date.now()}`
    const task = await insertDispatch(db, p.id, 'SENT', ext)

    const updated = await advanceFromWebhook(db, {
      externalId: ext,
      adapterKey: 'simulated-gzp',
      newState: 'COMPLETED',
      payload: { ok: true, frames: 42 },
    })

    expect(updated.state).toBe('COMPLETED')
    expect(updated.completedAt).not.toBeNull()

    const results = await db
      .select()
      .from(dispatchResults)
      .where(eq(dispatchResults.dispatchId, task.id))
    expect(results.length).toBe(1)
    expect(results[0]!.payloadJson).toEqual({ ok: true, frames: 42 })
    expect(results[0]!.capturedAt).not.toBeNull()
  })

  test('IN_PROGRESS transition stamps callbackAt', async () => {
    const { db } = ctx
    const p = await setupPrediction(db, `sm-prog-${Date.now()}`)
    const ext = `ext-prog-${Date.now()}`
    await insertDispatch(db, p.id, 'SENT', ext)

    const updated = await advanceFromWebhook(db, {
      externalId: ext,
      adapterKey: 'simulated-gzp',
      newState: 'IN_PROGRESS',
    })

    expect(updated.state).toBe('IN_PROGRESS')
    expect(updated.callbackAt).not.toBeNull()
    expect(updated.completedAt).toBeNull()
  })

  test('illegal transition (COMPLETED → FAILED) throws', async () => {
    const { db } = ctx
    const p = await setupPrediction(db, `sm-bad-${Date.now()}`)
    const ext = `ext-bad-${Date.now()}`
    await insertDispatch(db, p.id, 'COMPLETED', ext)

    await expect(
      advanceFromWebhook(db, {
        externalId: ext,
        adapterKey: 'simulated-gzp',
        newState: 'FAILED',
      }),
    ).rejects.toThrow(/invalid transition/)
  })

  test('unknown externalId throws', async () => {
    const { db } = ctx
    await expect(
      advanceFromWebhook(db, {
        externalId: `ext-nope-${Date.now()}`,
        adapterKey: 'simulated-gzp',
        newState: 'SENT',
      }),
    ).rejects.toThrow(/unknown dispatch/)
  })

  test('COMPLETED without payload does NOT insert results row', async () => {
    const { db } = ctx
    const p = await setupPrediction(db, `sm-nopay-${Date.now()}`)
    const ext = `ext-nopay-${Date.now()}`
    const task = await insertDispatch(db, p.id, 'IN_PROGRESS', ext)

    await advanceFromWebhook(db, {
      externalId: ext,
      adapterKey: 'simulated-gzp',
      newState: 'COMPLETED',
    })

    const results = await db
      .select()
      .from(dispatchResults)
      .where(eq(dispatchResults.dispatchId, task.id))
    expect(results.length).toBe(0)
  })

  test('concurrent webhooks: optimistic lock — exactly one wins per race', async () => {
    // T08's SimulatedGuangzhouPoliceCamAdapter schedules IN_PROGRESS and
    // COMPLETED via setTimeout and POSTs them in parallel through the
    // webhook. Without the optimistic-lock predicate, both calls read the
    // same QUEUED pre-image, both pass canTransition, and both UPDATE —
    // the later write clobbering the earlier and possibly producing an
    // orphan dispatch_results row. With the fix, exactly ONE call wins per
    // race; the loser hits one of two paths:
    //   (a) Truly-concurrent SELECT: both read QUEUED, only one gated
    //       UPDATE matches, the other returns zero rows → throws
    //       `state changed concurrently`.
    //   (b) Sequential SELECT: loser's SELECT lands after winner commits,
    //       reads the new state, and `canTransition` rejects it →
    //       throws `invalid transition`.
    // Both outcomes preserve the safety invariant. We stress 8 iterations
    // to ensure path (a) — the optimistic lock specifically — fires at
    // least once, proving the predicate is wired and effective. The first
    // iteration is excluded from the path-(a) counter because cold
    // connection setup tends to serialize.
    const { db } = ctx

    let lockFiredAtLeastOnce = false
    const ITERATIONS = 8

    for (let i = 0; i < ITERATIONS; i++) {
      const p = await setupPrediction(db, `sm-race-${Date.now()}-${i}`)
      const ext = `ext-race-${Date.now()}-${i}`
      await insertDispatch(db, p.id, 'QUEUED', ext)

      // Two valid transitions out of QUEUED. We pick SENT and
      // REJECTED_BY_ADAPTER specifically because neither is reachable
      // from the other — so if both calls succeed it can ONLY be due to
      // the bug (clobbered writes), not due to a legitimate sequential
      // re-read of the post-image.
      const results = await Promise.allSettled([
        advanceFromWebhook(db, {
          externalId: ext,
          adapterKey: 'simulated-gzp',
          newState: 'SENT',
        }),
        advanceFromWebhook(db, {
          externalId: ext,
          adapterKey: 'simulated-gzp',
          newState: 'REJECTED_BY_ADAPTER',
        }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')

      // Hard invariant: regardless of timing, exactly one of the two
      // parallel calls succeeds. Both succeeding is the bug; both failing
      // would be a regression elsewhere.
      expect(fulfilled.length).toBe(1)
      expect(rejected.length).toBe(1)

      const loser = rejected[0] as PromiseRejectedResult
      const loserMsg =
        loser.reason instanceof Error ? loser.reason.message : String(loser.reason)
      // Loser must throw one of the two documented safe paths.
      expect(loserMsg).toMatch(/state changed concurrently|invalid transition/)

      if (/state changed concurrently/.test(loserMsg)) {
        lockFiredAtLeastOnce = true
        expect(loserMsg).toContain('expected QUEUED')
      }

      // Final row reflects the winner's target state — never QUEUED, and
      // never a half-applied mix.
      const [row] = await db
        .select()
        .from(dispatchTasks)
        .where(eq(dispatchTasks.externalId, ext))
      expect(row).toBeDefined()
      expect(['SENT', 'REJECTED_BY_ADAPTER']).toContain(row!.state)
    }

    // Across 8 iterations the optimistic-lock path must fire at least
    // once, proving the predicate is in place and effective. Without the
    // fix, the bug would manifest as fulfilled.length === 2 and this
    // test would have already failed above; the lock-firing assertion is
    // additional rigor that the gated UPDATE specifically did its job.
    expect(lockFiredAtLeastOnce).toBe(true)
  })

  test('atomic rollback: dispatchResults insert failure preserves pre-state', async () => {
    // The transaction must include both the UPDATE and the conditional
    // dispatch_results INSERT. If the INSERT fails for any reason, the
    // state UPDATE must roll back — otherwise we'd advance to COMPLETED
    // without ever recording the payload, silently losing data.
    //
    // Trigger the failure by passing a payload containing a BigInt:
    // Drizzle's jsonb column serializes via JSON.stringify, which throws
    // `TypeError: Do not know how to serialize a BigInt`. The throw
    // happens inside the tx callback, so PG rolls back the UPDATE.
    const { db } = ctx
    const p = await setupPrediction(db, `sm-rollback-${Date.now()}`)
    const ext = `ext-rollback-${Date.now()}`
    const task = await insertDispatch(db, p.id, 'IN_PROGRESS', ext)

    // Sanity: read pre-state.
    const [pre] = await db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, task.id))
    expect(pre!.state).toBe('IN_PROGRESS')
    expect(pre!.completedAt).toBeNull()

    // BigInt values are not JSON-serializable; the insert blows up inside
    // the transaction.
    const poisonPayload: Record<string, unknown> = { count: 1n }
    await expect(
      advanceFromWebhook(db, {
        externalId: ext,
        adapterKey: 'simulated-gzp',
        newState: 'COMPLETED',
        payload: poisonPayload,
      }),
    ).rejects.toThrow()

    // Verify rollback: state is still IN_PROGRESS, completedAt still null,
    // and no orphan dispatch_results row was committed.
    const [post] = await db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, task.id))
    expect(post!.state).toBe('IN_PROGRESS')
    expect(post!.completedAt).toBeNull()

    const results = await db
      .select()
      .from(dispatchResults)
      .where(eq(dispatchResults.dispatchId, task.id))
    expect(results.length).toBe(0)
  })
})
