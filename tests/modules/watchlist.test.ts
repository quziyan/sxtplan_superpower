import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql, eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string
let regionId: string
let regionVersion: number
let vehicleClassId: string
let taskClassId: string

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()
  const email = `wl+${stamp}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()

  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })

  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!

  // Set active role
  await app.request('/auth/role-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roleKey: 'ANALYST' }),
  })

  // Create supporting data
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'wl-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  regionId = reg.id
  regionVersion = reg.version

  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-wl-${stamp}`, level: 1 }).returning()
  vehicleClassId = vc!.id
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-wl-${stamp}`, level: 1 }).returning()
  taskClassId = tc!.id
})

afterAll(async () => { await ctx.cleanup() })

describe('watchlist routes', () => {
  let createdId: string

  test('POST /watchlists creates a watchlist', async () => {
    const res = await app.request('/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: `监视清单-${Date.now()}`,
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; isActive: boolean; kRangeMin: number; kRangeMax: number }
    expect(body.id).toBeTruthy()
    expect(body.isActive).toBe(true)
    expect(body.kRangeMin).toBe(1)
    expect(body.kRangeMax).toBe(14)
    createdId = body.id
  })

  test('GET /watchlists returns list', async () => {
    const res = await app.request('/watchlists', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((w) => w.id === createdId)).toBe(true)
  })

  test('GET /watchlists/:id returns single watchlist', async () => {
    const res = await app.request(`/watchlists/${createdId}`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; name: string }
    expect(body.id).toBe(createdId)
  })

  test('PATCH /watchlists/:id/active deactivates', async () => {
    const res = await app.request(`/watchlists/${createdId}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ isActive: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { isActive: boolean }
    expect(body.isActive).toBe(false)
  })

  test('GET /watchlists?active=true filters inactive', async () => {
    // The just-deactivated item should not appear
    const res = await app.request('/watchlists?active=true', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string }>
    expect(body.every((w) => w.id !== createdId)).toBe(true)
  })

  test('GET /watchlists/:id 404 for unknown id', async () => {
    const res = await app.request('/watchlists/00000000-0000-0000-0000-000000000000', { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  test('POST /watchlists without auth returns 401', async () => {
    const res = await app.request('/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'no-auth',
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
      }),
    })
    expect(res.status).toBe(401)
  })
})
