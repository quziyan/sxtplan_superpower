import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { runPredictionAgent } from '@/agents/prediction-agent'
import { dispatchTasks } from '@/db/schema/dispatch'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { enqueueDispatch } from '@/dispatch/service'
import { createTestDb } from '../helpers/test-db'
import { buildTestApp } from '../helpers/test-server'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string
let userId: string

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)

  // Seed user with all 3 roles
  const email = `e2e+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()
  userId = u!.id
  for (const key of ['DECIDER', 'ANALYST', 'REVIEWER'] as const) {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label: key }).returning()
    await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
  }

  // Login
  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
})
afterAll(async () => { await ctx.cleanup() })

describe('m2 prediction flow E2E', () => {
  test('watchlist → agent prediction → list → approve → dispatch', async () => {
    const stamp = Date.now()
    // 1. Region + V/T classes
    const regResult = await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${'e2e-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `)
    const reg = regResult[0]!
    const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `应急救援车-${stamp}`, level: 1 }).returning()
    const [tc] = await ctx.db.insert(taskClasses).values({ name: `抢险救援-${stamp}`, level: 1 }).returning()

    // Switch to ANALYST first
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'ANALYST' }),
    })

    // 2. Create watchlist via API
    const wlRes = await app.request('/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: `e2e-wl-${stamp}`,
        vehicleClassId: vc!.id,
        taskClassId: tc!.id,
        regionId: reg.id,
        regionVersion: reg.version,
      }),
    })
    expect(wlRes.status).toBe(201)
    const watchlist = await wlRes.json() as { id: string }

    // 3. Seed a Prediction (m2 doesn't have a "create prediction" route; agent normally inserts.
    //    We seed via direct SQL then run the agent in FULL mode to write a snapshot.)
    const predResult = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO predictions
        (source_kind, source_id, region_id, region_version,
         window_date, window_half, vehicle_class_id, task_class_id,
         k_days, expires_at)
      VALUES
        ('WATCHLIST', ${watchlist.id}::uuid, ${reg.id}::uuid, ${reg.version},
         '2026-05-15'::date, 'AM', ${vc!.id}::uuid, ${tc!.id}::uuid,
         9, NOW() + INTERVAL '10 days')
      RETURNING id
    `)
    const predictionId = (predResult[0] as { id: string }).id

    // Run PredictionAgent with mocked infer
    const fakeInfer = (async () => ({
      text: JSON.stringify({
        confidence: 78, ci_low: 71, ci_high: 84,
        reasoning: '基于茂名应急局公告与主流报道,综合判断 II 级响应启动后调度概率较高',
        evidence_ids: [], key_signals: ['II 级响应'],
      }),
      promptTokens: 100, completionTokens: 50, totalTokens: 150, model: 'mock',
    }))
    await runPredictionAgent(ctx.db, { predictionId, kind: 'FULL' }, fakeInfer as never)

    // 4. List predictions via API
    const listRes = await app.request('/predictions?status=PROPOSED', { headers: { cookie } })
    expect(listRes.status).toBe(200)
    const list = await listRes.json() as Array<{ id: string; confidenceNow: number }>
    const found = list.find(p => p.id === predictionId)
    expect(found).toBeDefined()
    expect(found!.confidenceNow).toBe(78)

    // 5. Switch to DECIDER and approve
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'DECIDER' }),
    })
    const approveRes = await app.request(`/predictions/${predictionId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: '{}',
    })
    expect(approveRes.status).toBe(200)
    const approved = await approveRes.json() as { prediction: { status: string } }
    expect(approved.prediction.status).toBe('APPROVED')

    // 6. Direct dispatch (m2: not routed; m3 BullMQ worker)
    const dispatch = await enqueueDispatch(ctx.db, { predictionId, adapterKey: 'mock' })
    expect(dispatch.state).toBe('SENT')
    expect(dispatch.adapterKey).toBe('mock')
    expect(dispatch.externalId).toMatch(/^mock-/)

    // 7. Verify dispatch_tasks row exists.
    // approve 路由的 triggerDispatchAfterApproval 把 job 入 BullMQ 队列,
    // 但测试环境不跑 worker → job 残留 Redis,不写表;唯一的 dispatch_tasks
    // 行来自 step 6 的显式 enqueueDispatch。totals = 1。
    const dispatchCount = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM dispatch_tasks WHERE prediction_id = ${predictionId}::uuid
    `)
    expect((dispatchCount[0] as { n: number }).n).toBe(1)
  })
})
