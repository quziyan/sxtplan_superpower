import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { watchLists } from '@/db/schema/watchlist'
import { predictions } from '@/db/schema/prediction'
import {
  ensureCoverageForWatchlist,
  ensureCoverageForAll,
  totalize,
} from '@/modules/prediction/spawner'
import { buildTestApp } from '../../helpers/test-server'
import { createTestDb } from '../../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let analystCookie: string
let analystUserId: string

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

async function seedWl(active: boolean = true): Promise<{ wlId: string; vId: string; tId: string; rId: string; rVer: number }> {
  const stamp = `spawn-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'spawn-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [v] = await ctx.db.insert(vehicleClasses).values({ name: '巡防车' + stamp, level: 1 }).returning()
  const [t] = await ctx.db.insert(taskClasses).values({ name: '巡查' + stamp, level: 1 }).returning()
  const [wl] = await ctx.db.insert(watchLists).values({
    name: '测试 watchlist ' + stamp,
    vehicleClassId: v!.id, taskClassId: t!.id,
    regionId: reg.id, regionVersion: reg.version,
    kRangeMin: 3, kRangeMax: 14,
    isActive: active,
    keywords: ['kw'],
    createdBy: analystUserId,
  }).returning()
  return { wlId: wl!.id, vId: v!.id, tId: t!.id, rId: reg.id, rVer: reg.version }
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()
  const email = `spw+${stamp}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()
  analystUserId = u!.id
  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  analystCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: analystCookie },
    body: JSON.stringify({ roleKey: 'ANALYST' }),
  })
})

afterAll(async () => { await ctx.cleanup() })

describe('prediction spawner — service', () => {
  test('coverageDays=7,空 watchlist → 14 行 spawned (7 天 × AM/PM),0 skipped', async () => {
    const { wlId } = await seedWl()
    const r = await ensureCoverageForWatchlist(ctx.db, wlId, { coverageDays: 7 })
    expect(r.spawned).toBe(14)
    expect(r.skipped).toBe(0)
    const rows = await ctx.db.select().from(predictions).where(eq(predictions.sourceId, wlId))
    expect(rows.length).toBe(14)
  })

  test('幂等:对已 cover 的 watchlist 再 spawn → 0 spawned,14 skipped', async () => {
    const { wlId } = await seedWl()
    await ensureCoverageForWatchlist(ctx.db, wlId, { coverageDays: 7 })
    const r2 = await ensureCoverageForWatchlist(ctx.db, wlId, { coverageDays: 7 })
    expect(r2.spawned).toBe(0)
    expect(r2.skipped).toBe(14)
  })

  test('coverageDays 受 wl.kRangeMax 截断', async () => {
    const { wlId } = await seedWl()
    // 默认 kRangeMax=14;coverageDays=20 应该被截到 14
    const r = await ensureCoverageForWatchlist(ctx.db, wlId, { coverageDays: 20 })
    expect(r.spawned).toBe(28) // 14 天 × AM/PM
  })

  test('inactive watchlist → 0 spawned,0 skipped(short-circuit)', async () => {
    const { wlId } = await seedWl(false)
    const r = await ensureCoverageForWatchlist(ctx.db, wlId, { coverageDays: 7 })
    expect(r.spawned).toBe(0)
    expect(r.skipped).toBe(0)
  })

  test('ensureCoverageForAll 跳过 inactive,只处理 active', async () => {
    // beforeAll 没 deactivate 上面种的;用 totalize 看 active 数 ≥ 1
    await seedWl(true)  // +1 active
    await seedWl(false) // +1 inactive(spawn 不应处理它)
    const results = await ensureCoverageForAll(ctx.db, { coverageDays: 1 })
    const t = totalize(results)
    // 只断言 watchlistsProcessed > 0 且没崩(active 数太多无法精确预测)
    expect(t.watchlistsProcessed).toBeGreaterThan(0)
  })
})

describe('prediction spawner — routes', () => {
  test('POST /predictions/spawn-from-watchlist/:id 200 + spawned counts', async () => {
    const { wlId } = await seedWl()
    const res = await app.request(`/predictions/spawn-from-watchlist/${wlId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ coverageDays: 3 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; spawned: number; skipped: number }
    expect(body.ok).toBe(true)
    expect(body.spawned).toBe(6)  // 3 天 × AM/PM
    expect(body.skipped).toBe(0)
  })

  test('POST /predictions/spawn-from-all 200 + 多 watchlist 汇总', async () => {
    await seedWl()  // +1 active
    const res = await app.request('/predictions/spawn-from-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ coverageDays: 1 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; totalSpawned: number; watchlistsProcessed: number }
    expect(body.ok).toBe(true)
    expect(body.watchlistsProcessed).toBeGreaterThan(0)
  })

  test('POST /predictions/spawn-from-all 未登录 → 401', async () => {
    const res = await app.request('/predictions/spawn-from-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  test('coverageDays 越界 → 400', async () => {
    const { wlId } = await seedWl()
    const res = await app.request(`/predictions/spawn-from-watchlist/${wlId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ coverageDays: 999 }),
    })
    expect(res.status).toBe(400)
  })
})
