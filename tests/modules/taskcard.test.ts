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
  const email = `tc+${stamp}@x`
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

  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'tc-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  regionId = reg.id
  regionVersion = reg.version

  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-tc-${stamp}`, level: 1 }).returning()
  vehicleClassId = vc!.id
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-tc-${stamp}`, level: 1 }).returning()
  taskClassId = tc!.id
})

afterAll(async () => { await ctx.cleanup() })

describe('taskcard routes', () => {
  let createdId: string

  test('POST /taskcards creates a taskcard', async () => {
    const res = await app.request('/taskcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: `任务卡-${Date.now()}`,
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
        targetWindowDate: '2026-06-15',
        targetWindowHalf: 'AM',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: string; targetWindowHalf: string }
    expect(body.id).toBeTruthy()
    expect(body.targetWindowHalf).toBe('AM')
    createdId = body.id
  })

  test('GET /taskcards returns list containing created card', async () => {
    const res = await app.request('/taskcards', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((c) => c.id === createdId)).toBe(true)
  })

  test('GET /taskcards/:id returns single taskcard', async () => {
    const res = await app.request(`/taskcards/${createdId}`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; name: string }
    expect(body.id).toBe(createdId)
  })

  test('GET /taskcards/:id 404 for unknown id', async () => {
    const res = await app.request('/taskcards/00000000-0000-0000-0000-000000000000', { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  test('POST /taskcards PM half-day creates correctly', async () => {
    const res = await app.request('/taskcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: `任务卡-PM-${Date.now()}`,
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
        targetWindowDate: '2026-07-01',
        targetWindowHalf: 'PM',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { targetWindowHalf: string }
    expect(body.targetWindowHalf).toBe('PM')
  })

  test('POST /taskcards without auth returns 401', async () => {
    const res = await app.request('/taskcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'no-auth',
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
        targetWindowDate: '2026-06-15',
        targetWindowHalf: 'AM',
      }),
    })
    expect(res.status).toBe(401)
  })
})
