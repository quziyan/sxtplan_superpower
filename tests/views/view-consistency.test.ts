/**
 * View Data Contract — cross-view 一致性测试
 *
 * 锁住 docs/superpowers/specs/2026-05-11-view-data-contract.md 定义的不变量:
 *   - Inv-A1/A2/A3, Anti-A1/A2/A3 (Analyst)
 *   - Inv-D1, Anti-D1/D2 (Decider)
 *   - Inv-R1, Anti-R1 (Reviewer — partial,retrospective worker 是异步派生)
 *   - Inv-S1/S2, Anti-S1 (Schedule)
 *   - X1 (同一 id 跨视图字段一致), X3 (Schedule ⊇ Analyst ∪ Decider)
 *
 * 测试 seed 一组覆盖 7 status 的 prediction,然后通过真实 HTTP 接口断言每个视图
 * 后端返回的集合 = 契约期望。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql, eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions } from '@/db/schema/prediction'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let deciderCookie: string
let analystCookie: string
let reviewerCookie: string

type Seed = {
  status: 'PROPOSED' | 'VALIDATED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'COMPLETED' | 'EXPIRED'
  withEvidence: boolean
  daysOffset: number
  id?: string
}
const SEEDS: Seed[] = [
  { status: 'PROPOSED',   withEvidence: true,  daysOffset:  1 },  // Analyst 应见
  { status: 'PROPOSED',   withEvidence: false, daysOffset:  2 },  // Analyst 不应见(Anti-A3)
  { status: 'VALIDATED',  withEvidence: true,  daysOffset:  3 },  // Decider 应见
  { status: 'APPROVED',   withEvidence: true,  daysOffset:  4 },  // 无视图 + Schedule 可见
  { status: 'REJECTED',   withEvidence: true,  daysOffset:  5 },  // 无视图 + Schedule 可见
  { status: 'DISPATCHED', withEvidence: true,  daysOffset:  6 },  // 无视图 + Schedule 可见
  { status: 'COMPLETED',  withEvidence: true,  daysOffset:  7 },  // Reviewer 派生 + Schedule 可见
  { status: 'EXPIRED',    withEvidence: true,  daysOffset:  8 },  // Reviewer 派生 + Schedule 可见
]

async function loginWithRole(email: string, roleKey: string) {
  const res = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  const c = (res.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c },
    body: JSON.stringify({ roleKey }),
  })
  return c
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()

  const ensureRole = async (key: string, label: string) => {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label }).returning()
    return r!
  }
  const ensureUserWithRole = async (email: string, roleKey: string) => {
    const role = await ensureRole(roleKey, roleKey)
    const [u] = await ctx.db.insert(users).values({
      email, passwordHash: await hashPassword('pass1234'),
    }).returning()
    await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: role.id })
    return loginWithRole(email, roleKey)
  }
  analystCookie = await ensureUserWithRole(`vc-analyst+${stamp}@x`, 'ANALYST')
  deciderCookie = await ensureUserWithRole(`vc-decider+${stamp}@x`, 'DECIDER')
  reviewerCookie = await ensureUserWithRole(`vc-reviewer+${stamp}@x`, 'REVIEWER')

  // region + V + T 共用
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'vc-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [v] = await ctx.db.insert(vehicleClasses).values({ name: `vc-v-${stamp}`, level: 1 }).returning()
  const [t] = await ctx.db.insert(taskClasses).values({ name: `vc-t-${stamp}`, level: 1 }).returning()

  // Seed: 一条 prediction + 可选 news_evidence
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]!
    const windowDate = new Date()
    windowDate.setHours(0, 0, 0, 0)
    windowDate.setDate(windowDate.getDate() + s.daysOffset)
    const expiresAt = new Date(windowDate)
    expiresAt.setDate(windowDate.getDate() + 1)
    const [p] = await ctx.db.insert(predictions).values({
      sourceKind: 'WATCHLIST', sourceId: v!.id,
      regionId: reg.id, regionVersion: reg.version,
      windowDate, windowHalf: 'AM',
      vehicleClassId: v!.id, taskClassId: t!.id,
      kDays: 1, confidenceNow: 50,
      status: s.status, expiresAt,
    }).returning()
    s.id = p!.id
    if (s.withEvidence) {
      const [news] = await ctx.db.execute<{ id: string }>(sql`
        INSERT INTO news_items (
          source_kind, source_label, url, title, summary_zh, published_at, raw_snippet, content_hash
        ) VALUES (
          'MAINSTREAM', 'view-consistency-test',
          ${'https://example.local/vc-' + stamp + '-' + i},
          ${'[vc-test] seed-' + i},
          ${'seed ' + s.status}, NOW(), ${'seed ' + s.status},
          ${`hash-${stamp}-${i}`}
        ) RETURNING id
      `)
      await ctx.db.execute(sql`
        INSERT INTO news_evidence (prediction_id, news_id, weight, cited, added_at)
        VALUES (${p!.id}, ${news!.id}, 'HIGH', true, NOW())
      `)
    }
  }
})

afterAll(async () => { await ctx.cleanup() })

describe('Cross-view data consistency contract', () => {
  // Inv-A1/A2 + Anti-A1/A2/A3
  test('Analyst sees PROPOSED with evidence only', async () => {
    const res = await app.request('/predictions?status=PROPOSED&has_evidence=true', {
      headers: { cookie: analystCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string; status: string }>
    const seenIds = new Set(body.map((p) => p.id))

    // Inv-A1: 仅 PROPOSED
    expect(body.every((p) => p.status === 'PROPOSED')).toBe(true)
    // Inv-A2: PROPOSED+evidence 应见
    const propEvId = SEEDS.find((s) => s.status === 'PROPOSED' && s.withEvidence)!.id!
    expect(seenIds.has(propEvId)).toBe(true)
    // Anti-A3: PROPOSED 无证据不应见
    const propNoEvId = SEEDS.find((s) => s.status === 'PROPOSED' && !s.withEvidence)!.id!
    expect(seenIds.has(propNoEvId)).toBe(false)
    // Anti-A1/A2: 其他 status 都不应见
    for (const s of SEEDS) {
      if (s.status !== 'PROPOSED') expect(seenIds.has(s.id!)).toBe(false)
    }
  })

  // Inv-D1 + Anti-D1/D2
  test('Decider sees VALIDATED only', async () => {
    const res = await app.request('/predictions?status=VALIDATED', { headers: { cookie: deciderCookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string; status: string }>
    const seenIds = new Set(body.map((p) => p.id))

    const valId = SEEDS.find((s) => s.status === 'VALIDATED')!.id!
    expect(seenIds.has(valId)).toBe(true)
    for (const s of SEEDS) {
      if (s.status !== 'VALIDATED') expect(seenIds.has(s.id!)).toBe(false)
    }
  })

  // Inv-S1: Schedule 全显示(无 status 过滤);Inv-S2 / X3: ⊇ Analyst + Decider
  test('Schedule shows all statuses in date range', async () => {
    const from = new Date(); from.setDate(from.getDate() - 1)
    const to = new Date(); to.setDate(to.getDate() + 30)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const res = await app.request(`/predictions?from=${fmt(from)}&to=${fmt(to)}&limit=500`, {
      headers: { cookie: analystCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string; status: string }>
    const seenIds = new Set(body.map((p) => p.id))

    // Inv-S1: 7 个 status 都至少出现一次(我们 8 个 seed 覆盖 7 status,PROPOSED 重复一次)
    const distinctStatuses = new Set(body.map((p) => p.status))
    for (const s of SEEDS) {
      expect(seenIds.has(s.id!)).toBe(true)  // 全部 8 条 seed 都应在 Schedule
    }
    expect(distinctStatuses.has('PROPOSED')).toBe(true)
    expect(distinctStatuses.has('VALIDATED')).toBe(true)
    expect(distinctStatuses.has('APPROVED')).toBe(true)
    expect(distinctStatuses.has('REJECTED')).toBe(true)
    expect(distinctStatuses.has('DISPATCHED')).toBe(true)
    expect(distinctStatuses.has('COMPLETED')).toBe(true)
    expect(distinctStatuses.has('EXPIRED')).toBe(true)
  })

  // X1: 同一 id 跨 GET / 与 GET /:id 字段一致(基础字段)
  test('Same prediction.id returns identical fields across list + detail', async () => {
    const valId = SEEDS.find((s) => s.status === 'VALIDATED')!.id!

    const listRes = await app.request('/predictions?status=VALIDATED', { headers: { cookie: deciderCookie } })
    const list = await listRes.json() as Array<{ id: string; status: string; confidenceNow: number; windowDate: string; windowHalf: string }>
    const fromList = list.find((p) => p.id === valId)!

    const detailRes = await app.request(`/predictions/${valId}`, { headers: { cookie: deciderCookie } })
    const detail = (await detailRes.json() as { prediction: typeof fromList }).prediction

    expect(detail.id).toBe(fromList.id)
    expect(detail.status).toBe(fromList.status)
    expect(detail.confidenceNow).toBe(fromList.confidenceNow)
    expect(detail.windowDate.slice(0, 10)).toBe(fromList.windowDate.slice(0, 10))
    expect(detail.windowHalf).toBe(fromList.windowHalf)
  })

  // X3 explicit: 我们的 8 条 seed 都在 windowDate today+1..today+8,Schedule 用宽
  // 范围拉取后,SEED 中本应在 Analyst / Decider 里的那些 id 都必须 ⊆ Schedule。
  //
  // 注意:测试 DB 共享(无 tx 隔离),其他测试也插了 PROPOSED+evidence 行。
  // 因此只对"本测试自己 seed"的 id 集合断言 Schedule ⊇ 该子集,不去枚举全集。
  test('Schedule covers union of all role views plus terminal states (scoped to own seeds)', async () => {
    const from = new Date(); from.setDate(from.getDate() - 1)
    const to = new Date(); to.setDate(to.getDate() + 30)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const schedRes = await app.request(`/predictions?from=${fmt(from)}&to=${fmt(to)}&limit=1000`, {
      headers: { cookie: analystCookie },
    })
    const schedIds = new Set((await schedRes.json() as Array<{ id: string }>).map((p) => p.id))

    // 仅断言:我们的 seed 中应该被 Analyst / Decider 看到的 id 必须 ⊆ Schedule
    const ownAnalystExpected = SEEDS
      .filter((s) => s.status === 'PROPOSED' && s.withEvidence)
      .map((s) => s.id!)
    const ownDeciderExpected = SEEDS
      .filter((s) => s.status === 'VALIDATED')
      .map((s) => s.id!)

    for (const id of ownAnalystExpected) expect(schedIds.has(id)).toBe(true)
    for (const id of ownDeciderExpected) expect(schedIds.has(id)).toBe(true)
    // 加固:其余 5 条 seed(APPROVED/REJECTED/DISPATCHED/COMPLETED/EXPIRED)Schedule 也必须见
    for (const s of SEEDS) {
      if (s.status !== 'PROPOSED' || s.withEvidence) {
        // 跳过无证据 PROPOSED:它在 Schedule 内是 OK 的(Schedule 无 evidence 过滤)
      }
      expect(schedIds.has(s.id!)).toBe(true)
    }
  })
})
