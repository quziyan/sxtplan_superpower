import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { appSettings } from '@/db/schema/settings'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()
  const email = `set+${stamp}@x`
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
  await app.request('/auth/role-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roleKey: 'ANALYST' }),
  })
})

afterAll(async () => { await ctx.cleanup() })

describe('settings — news_freshness_days', () => {
  test('GET 默认 fallback 到 env(NEWS_FRESHNESS_DAYS=30)', async () => {
    // 清掉可能从前次跑残留的 row
    await ctx.db.delete(appSettings).where(eq(appSettings.key, 'news_freshness_days'))
    const res = await app.request('/settings/news-freshness-days', { headers: { cookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as { value: number }
    expect(body.value).toBe(30)
  })

  test('PUT 写入后 GET 返回新值', async () => {
    const put = await app.request('/settings/news-freshness-days', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ value: 45 }),
    })
    expect(put.status).toBe(200)
    const putBody = await put.json() as { ok: boolean; value: number }
    expect(putBody.ok).toBe(true)
    expect(putBody.value).toBe(45)

    const get = await app.request('/settings/news-freshness-days', { headers: { cookie } })
    const getBody = await get.json() as { value: number }
    expect(getBody.value).toBe(45)
  })

  test('PUT 越界(< 1 / > 365)→ 400', async () => {
    for (const bad of [0, -1, 366, 999]) {
      const res = await app.request('/settings/news-freshness-days', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ value: bad }),
      })
      expect(res.status).toBe(400)
    }
  })

  test('PUT 多次为同一 key → upsert,只有一行', async () => {
    await app.request('/settings/news-freshness-days', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ value: 60 }),
    })
    await app.request('/settings/news-freshness-days', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ value: 90 }),
    })
    const rows = await ctx.db.select().from(appSettings)
      .where(eq(appSettings.key, 'news_freshness_days'))
    expect(rows.length).toBe(1)
    expect(rows[0]!.valueInt).toBe(90)
  })

  test('未登录 GET → 401', async () => {
    const res = await app.request('/settings/news-freshness-days')
    expect(res.status).toBe(401)
  })
})
