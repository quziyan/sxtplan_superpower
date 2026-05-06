import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { eq } from 'drizzle-orm'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const email = `tax+${Date.now()}@x`
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
})
afterAll(async () => { await ctx.cleanup() })

describe('taxonomy routes', () => {
  test('POST /taxonomy/vehicles creates level 1', async () => {
    const res = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `货车-${Date.now()}`, level: 1 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; name: string; level: number }
    expect(body.level).toBe(1)
    expect(body.id).toBeTruthy()
  })

  test('POST /taxonomy/vehicles creates level 2 with parentId', async () => {
    // First create a level 1 parent
    const parentRes = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `大货车-${Date.now()}`, level: 1 }),
    })
    const parent = await parentRes.json() as { id: string }

    const res = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `重型货车-${Date.now()}`, level: 2, parentId: parent.id }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; name: string; level: number; parentId: string }
    expect(body.level).toBe(2)
    expect(body.parentId).toBe(parent.id)
  })

  test('POST /taxonomy/vehicles/:id/tags creates edge tag', async () => {
    // Create a vehicle class to attach tag to
    const vcRes = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `客车-${Date.now()}`, level: 1 }),
    })
    const vc = await vcRes.json() as { id: string }

    const res = await app.request(`/taxonomy/vehicles/${vc.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ tag: `electric-${Date.now()}` }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; vehicleClassId: string; tag: string }
    expect(body.vehicleClassId).toBe(vc.id)
    expect(body.tag).toContain('electric')
  })

  test('GET /taxonomy/vehicles returns ordered list (by level, name)', async () => {
    const res = await app.request('/taxonomy/vehicles')
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string; level: number; name: string }>
    expect(Array.isArray(body)).toBe(true)
    // Verify ordering: level should be non-decreasing
    for (let i = 1; i < body.length; i++) {
      expect(body[i]!.level).toBeGreaterThanOrEqual(body[i - 1]!.level)
    }
  })

  test('POST /taxonomy/vehicles without auth returns 401', async () => {
    const res = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `未授权-${Date.now()}`, level: 1 }),
    })
    expect(res.status).toBe(401)
  })
})
