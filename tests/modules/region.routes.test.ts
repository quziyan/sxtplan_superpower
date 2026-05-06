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
  const email = `r+${Date.now()}@x`
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

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

describe('region routes', () => {
  test('POST /regions creates ADMIN_NAMED', async () => {
    const res = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'ADMIN_NAMED', name: `测试朝阳区-${Date.now()}`, geom: poly }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { name: string }
    expect(body.name).toContain('测试朝阳区')
  })

  test('GET /regions/:id returns current version', async () => {
    const create = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'AD_HOC', geom: poly }),
    })
    const r = await create.json() as { id: string }
    const get = await app.request(`/regions/${r.id}`)
    expect(get.status).toBe(200)
  })

  test('POST /regions without auth returns 401', async () => {
    const res = await app.request('/regions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'AD_HOC', geom: poly }),
    })
    expect(res.status).toBe(401)
  })
})
