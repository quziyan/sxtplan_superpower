import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const email = `smoke+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()
  for (const key of ['DECIDER', 'ANALYST', 'REVIEWER'] as const) {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label: key }).returning()
    await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
  }
  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
})
afterAll(async () => { await ctx.cleanup() })

describe('m1 smoke', () => {
  test('full path: login → me → switch role → create region → create taxonomy', async () => {
    // me
    const meRes = await app.request('/auth/me', { headers: { cookie } })
    expect(meRes.status).toBe(200)
    const me = await meRes.json() as { availableRoles: string[] }
    expect(me.availableRoles.length).toBe(3)

    // switch to ANALYST
    const switchRes = await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'ANALYST' }),
    })
    expect(switchRes.status).toBe(200)

    // create region
    const regionRes = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        kind: 'AD_HOC',
        geom: { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] },
      }),
    })
    expect(regionRes.status).toBe(201)

    // create vehicle class
    const vRes = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `消防车-${Date.now()}`, level: 1 }),
    })
    expect(vRes.status).toBe(201)
  })
})
