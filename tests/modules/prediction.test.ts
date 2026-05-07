import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import { sql, eq, and, desc } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions } from '@/db/schema/prediction'
import { dispatchTasks } from '@/db/schema/dispatch'
import { operationAudit } from '@/db/schema/audit'
import { authRoutes } from '@/auth/routes'
import { predictionRoutes } from '@/modules/prediction/routes'
import { AppError } from '@/lib/errors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let deciderCookie: string
let analystCookie: string
let predictionId: string

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

async function loginWithRole(email: string, roleKey: string) {
  const res = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  const c = (res.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: c },
    body: JSON.stringify({ roleKey }),
  })
  return c
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()

  // Create DECIDER user
  const deciderEmail = `pred-decider+${stamp}@x`
  const [du] = await ctx.db.insert(users).values({
    email: deciderEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [dr] = await ctx.db.select().from(roles).where(eq(roles.key, 'DECIDER'))
  if (!dr) [dr] = await ctx.db.insert(roles).values({ key: 'DECIDER', label: '决策者' }).returning()
  await ctx.db.insert(userRoles).values({ userId: du!.id, roleId: dr!.id })
  deciderCookie = await loginWithRole(deciderEmail, 'DECIDER')

  // Create ANALYST user
  const analystEmail = `pred-analyst+${stamp}@x`
  const [au] = await ctx.db.insert(users).values({
    email: analystEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [ar] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!ar) [ar] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: au!.id, roleId: ar!.id })
  analystCookie = await loginWithRole(analystEmail, 'ANALYST')

  // Create a prediction directly in DB for route tests
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'pred-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-pred-${stamp}`, level: 1 }).returning()
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-pred-${stamp}`, level: 1 }).returning()

  const [p] = await ctx.db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-06-15'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 7,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  }).returning()
  predictionId = p!.id
})

afterAll(async () => { await ctx.cleanup() })

describe('prediction routes', () => {
  test('GET /predictions returns list', async () => {
    const res = await app.request('/predictions', { headers: { cookie: deciderCookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((p) => p.id === predictionId)).toBe(true)
  })

  test('GET /predictions?status=PROPOSED filters by status', async () => {
    const res = await app.request('/predictions?status=PROPOSED', { headers: { cookie: deciderCookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ status: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.every((p) => p.status === 'PROPOSED')).toBe(true)
  })

  test('GET /predictions/:id returns detail + snapshots', async () => {
    const res = await app.request(`/predictions/${predictionId}`, { headers: { cookie: deciderCookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as { prediction: { id: string; status: string }; snapshots: unknown[] }
    expect(body.prediction.id).toBe(predictionId)
    expect(body.prediction.status).toBe('PROPOSED')
    expect(Array.isArray(body.snapshots)).toBe(true)
  })

  test('GET /predictions/:id 404 for unknown id', async () => {
    const res = await app.request('/predictions/00000000-0000-0000-0000-000000000000', {
      headers: { cookie: deciderCookie },
    })
    expect(res.status).toBe(404)
  })

  test('POST /predictions/:id/manual-confidence requires ANALYST role', async () => {
    const res = await app.request(`/predictions/${predictionId}/manual-confidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: deciderCookie },
      body: JSON.stringify({ confidence: 60, reason: 'manual anchor' }),
    })
    // DECIDER does not have ANALYST role — should be 401
    expect(res.status).toBe(401)
  })

  test('POST /predictions/:id/manual-confidence as ANALYST writes snapshot', async () => {
    const res = await app.request(`/predictions/${predictionId}/manual-confidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ confidence: 55, reason: 'analyst override' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; snapshot: { confidence: number; kind: string } }
    expect(body.ok).toBe(true)
    expect(body.snapshot.confidence).toBe(55)
    expect(body.snapshot.kind).toBe('MANUAL')
  })

  test('POST /predictions/:id/manual-confidence validates ciLow <= ciHigh', async () => {
    const res = await app.request(`/predictions/${predictionId}/manual-confidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ confidence: 50, reason: 'bad ci range', ciLow: 80, ciHigh: 20 }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /predictions/:id/recompute-now requires ANALYST role', async () => {
    const res = await app.request(`/predictions/${predictionId}/recompute-now`, {
      method: 'POST',
      headers: { cookie: deciderCookie },
    })
    expect(res.status).toBe(401)
  })

  test('POST /predictions/:id/recompute-now as ANALYST returns ok + audit', async () => {
    const res = await app.request(`/predictions/${predictionId}/recompute-now`, {
      method: 'POST',
      headers: { cookie: analystCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; message: string }
    expect(body.ok).toBe(true)
    expect(body.message).toContain('stub')
  })

  test('POST /predictions/:id/approve requires DECIDER role', async () => {
    // Analyst cannot approve
    const res = await app.request(`/predictions/${predictionId}/approve`, {
      method: 'POST',
      headers: { cookie: analystCookie },
    })
    expect(res.status).toBe(401)
  })

  test('POST /predictions/:id/approve as DECIDER transitions to APPROVED', async () => {
    const res = await app.request(`/predictions/${predictionId}/approve`, {
      method: 'POST',
      headers: { cookie: deciderCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; prediction: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.prediction.status).toBe('APPROVED')
  })

  test('POST /predictions/:id/approve already-approved returns 500 (not PROPOSED)', async () => {
    // predictionId is now APPROVED, cannot approve again
    const res = await app.request(`/predictions/${predictionId}/approve`, {
      method: 'POST',
      headers: { cookie: deciderCookie },
    })
    expect(res.status).toBe(500)
  })

  test('POST /predictions/:id/reject creates new PROPOSED prediction then rejects', async () => {
    // Create a fresh prediction to reject
    const stamp = Date.now()
    const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${'reject-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `))[0]!
    const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-rej-${stamp}`, level: 1 }).returning()
    const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-rej-${stamp}`, level: 1 }).returning()
    const { predictions: predTable } = await import('@/db/schema/prediction')
    const [p] = await ctx.db.insert(predTable).values({
      sourceKind: 'TASKCARD', sourceId: vc!.id,
      regionId: reg.id, regionVersion: reg.version,
      windowDate: new Date('2026-07-01'), windowHalf: 'PM',
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      kDays: 5, expiresAt: new Date(Date.now() + 5 * 86400_000),
    }).returning()

    const res = await app.request(`/predictions/${p!.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: deciderCookie },
      body: JSON.stringify({ reason: 'Not applicable' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; prediction: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.prediction.status).toBe('REJECTED')
  })
})

/**
 * Plan-C T16 / ISC-24: post-approval trigger wiring.
 *
 * The approve route should fire `triggerDispatchAfterApproval(predictionId)`
 * after the status transition is committed. We verify this via the route's
 * DI seam: build a parallel test app that injects a spy trigger function,
 * then drive it through HTTP and assert the spy was called with the right id.
 *
 * Trigger failure must NOT poison the approve response — there's a
 * dedicated test for that path too.
 */
describe('approve route → post-approval dispatch trigger', () => {
  function buildAppWithDeps(
    db: ReturnType<typeof createTestDb> extends Promise<infer T>
      ? T extends { db: infer D } ? D : never
      : never,
    triggerSpy: (predictionId: string) => Promise<void>,
  ) {
    const app = new Hono()
    app.onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
      }
      return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
    })
    app.route('/auth', authRoutes(db))
    app.route('/predictions', predictionRoutes(db, { triggerDispatchAfterApproval: triggerSpy }))
    return app
  }

  async function seedPropsedPrediction(stamp: string): Promise<string> {
    const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${'trig-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `))[0]!
    const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-trig-${stamp}`, level: 1 }).returning()
    const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-trig-${stamp}`, level: 1 }).returning()
    const [p] = await ctx.db.insert(predictions).values({
      sourceKind: 'WATCHLIST',
      sourceId: vc!.id,
      regionId: reg.id,
      regionVersion: reg.version,
      windowDate: new Date('2026-08-15'),
      windowHalf: 'AM',
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      kDays: 7,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    }).returning()
    return p!.id
  }

  test('approve as DECIDER fires post-approval trigger with the prediction id', async () => {
    const stamp = `trig-ok-${Date.now()}`
    const id = await seedPropsedPrediction(stamp)
    const calls: string[] = []
    const spy = mock(async (predictionId: string) => {
      calls.push(predictionId)
    })

    const app = buildAppWithDeps(ctx.db, spy)
    const res = await app.request(`/predictions/${id}/approve`, {
      method: 'POST',
      headers: { cookie: deciderCookie },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; prediction: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.prediction.status).toBe('APPROVED')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([id])
  })

  test('trigger failure does NOT poison the approve response (still 200)', async () => {
    const stamp = `trig-fail-${Date.now()}`
    const id = await seedPropsedPrediction(stamp)
    const failingSpy = mock(async (_predictionId: string) => {
      throw new Error('redis kaboom')
    })

    const app = buildAppWithDeps(ctx.db, failingSpy)
    const res = await app.request(`/predictions/${id}/approve`, {
      method: 'POST',
      headers: { cookie: deciderCookie },
    })

    // Approve must succeed — the prediction is already APPROVED in the DB,
    // and the dispatch can be retried out-of-band.
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; prediction: { status: string } }
    expect(body.ok).toBe(true)
    expect(body.prediction.status).toBe('APPROVED')
    expect(failingSpy).toHaveBeenCalledTimes(1)
  })
})

/**
 * Plan-C T24 / ISC-32: POST /predictions/:id/cancel — full cancellation flow.
 *
 * The route looks up the prediction's most recent dispatch in a cancel-able
 * state (QUEUED/SENT/IN_PROGRESS), invokes the service-layer requestCancel
 * (CANCEL_PENDING + adapter.cancel), and writes an audit-log entry tagged
 * `dispatch_cancel`. The mock adapter is in-process so the adapter call
 * resolves immediately; real CANCELLED transition lands later via webhook.
 */
describe('POST /predictions/:id/cancel — Plan-C T24', () => {
  async function freshPrediction(label: string): Promise<string> {
    const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${'cancel-region-' + label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `))[0]!
    const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-cancel-${label}`, level: 1 }).returning()
    const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-cancel-${label}`, level: 1 }).returning()
    const [p] = await ctx.db.insert(predictions).values({
      sourceKind: 'WATCHLIST', sourceId: vc!.id,
      regionId: reg.id, regionVersion: reg.version,
      windowDate: new Date('2026-09-15'), windowHalf: 'AM',
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      kDays: 7, expiresAt: new Date(Date.now() + 7 * 86400_000),
    }).returning()
    return p!.id
  }

  async function seedDispatch(predictionId: string, state: 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED') {
    const [row] = await ctx.db.insert(dispatchTasks).values({
      predictionId,
      adapterKey: 'mock',
      state,
      externalId: `mock-${Math.random().toString(36).slice(2, 10)}`,
      paramsJson: {},
    }).returning()
    return row!
  }

  test('unauthenticated → 401', async () => {
    const id = await freshPrediction(`unauth-${Date.now()}`)
    const res = await app.request(`/predictions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'no auth' }),
    })
    expect(res.status).toBe(401)
  })

  test('missing reason → 400 (zod validation)', async () => {
    const id = await freshPrediction(`noreason-${Date.now()}`)
    await seedDispatch(id, 'SENT')
    const res = await app.request(`/predictions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('no active dispatch → 404', async () => {
    const id = await freshPrediction(`noactive-${Date.now()}`)
    // Don't seed any dispatch — there's nothing to cancel.
    const res = await app.request(`/predictions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ reason: 'no dispatch' }),
    })
    expect(res.status).toBe(404)
  })

  test('happy path SENT → CANCEL_PENDING + audit log entry written', async () => {
    const id = await freshPrediction(`happy-${Date.now()}`)
    const seeded = await seedDispatch(id, 'SENT')
    const res = await app.request(`/predictions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ reason: 'analyst withdrew approval' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; dispatch: { id: string; state: string; cancellationReason: string } }
    expect(body.ok).toBe(true)
    expect(body.dispatch.id).toBe(seeded.id)
    expect(body.dispatch.state).toBe('CANCEL_PENDING')
    expect(body.dispatch.cancellationReason).toBe('analyst withdrew approval')

    // Audit log: most recent dispatch_cancel entry for this dispatch.
    const [audit] = await ctx.db.select().from(operationAudit)
      .where(and(
        eq(operationAudit.targetKind, 'dispatch'),
        eq(operationAudit.targetId, seeded.id),
        eq(operationAudit.action, 'dispatch_cancel'),
      ))
      .orderBy(desc(operationAudit.occurredAt))
      .limit(1)
    expect(audit).toBeDefined()
    expect(audit!.reason).toBe('analyst withdrew approval')
    expect(audit!.actorRoleKey).toBe('ANALYST')
    expect((audit!.before as { state: string }).state).toBe('SENT')
    expect((audit!.after as { state: string }).state).toBe('CANCEL_PENDING')
  })

  test('dispatch already COMPLETED → 404 (no active dispatch in cancel-able state)', async () => {
    const id = await freshPrediction(`completed-${Date.now()}`)
    // Seed a COMPLETED dispatch — it's terminal so the route's "active" lookup
    // (QUEUED/SENT/IN_PROGRESS only) won't find it. The route returns 404
    // for "no active dispatch" rather than reaching the requestCancel call
    // that could yield a 400. The 400-from-canTransition path is unreachable
    // through this route today; see the comment in routes.ts near the
    // BadRequest branch. canTransition rejection of CANCEL_PENDING/CANCELLED
    // is exercised at the service layer in tests/dispatch/cancel-flow.test.ts.
    await ctx.db.insert(dispatchTasks).values({
      predictionId: id, adapterKey: 'mock', state: 'COMPLETED',
      externalId: `mock-completed-${Date.now()}`, paramsJson: {},
    })
    const res = await app.request(`/predictions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ reason: 'too late' }),
    })
    // No active dispatch in cancel-able state → 404.
    expect(res.status).toBe(404)
  })
})
