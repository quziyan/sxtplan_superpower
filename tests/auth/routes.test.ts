import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { eq } from 'drizzle-orm'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let testEmail: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  testEmail = `t+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email: testEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'DECIDER'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'DECIDER', label: '决策者' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
})
afterAll(async () => { await ctx.cleanup() })

describe('auth routes', () => {
  test('login + me + role-state + logout', async () => {
    const loginRes = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'pass1234' }),
    })
    expect(loginRes.status).toBe(200)
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const sessionCookie = cookie.split(';')[0]!

    const meRes = await app.request('/auth/me', { headers: { cookie: sessionCookie } })
    expect(meRes.status).toBe(200)
    const me = await meRes.json() as { user: { email: string }; availableRoles: string[] }
    expect(me.user.email).toBe(testEmail)
    expect(me.availableRoles).toContain('DECIDER')

    const switchRes = await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ roleKey: 'DECIDER' }),
    })
    expect(switchRes.status).toBe(200)

    const logoutRes = await app.request('/auth/logout', {
      method: 'POST', headers: { cookie: sessionCookie },
    })
    expect(logoutRes.status).toBe(200)
  })

  test('login with wrong password returns 401', async () => {
    const res = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  test('role-state with role user lacks returns 400', async () => {
    const loginRes = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'pass1234' }),
    })
    const sessionCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]!
    const res = await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ roleKey: 'REVIEWER' }),
    })
    expect(res.status).toBe(400)
  })
})
