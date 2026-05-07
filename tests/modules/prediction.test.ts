import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql, eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions } from '@/db/schema/prediction'
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
