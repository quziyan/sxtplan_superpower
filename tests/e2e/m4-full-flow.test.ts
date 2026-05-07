import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { roles, userRoles, users } from '@/db/schema/user'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { hashPassword } from '@/auth/password'
import { initAdapterPool, resetAdapterPoolForTests } from '@/dispatch/adapter-pool'
import { resetEnvCacheForTests } from '@/env'
import { tickAutoCancel } from '@/scheduler/workers/auto-cancel'
import { processDispatchJob } from '@/scheduler/workers/dispatch'
import { computeSignature } from '@/webhook/signature'
import { createTestDb } from '../helpers/test-db'
import { buildTestApp } from '../helpers/test-server'

/**
 * Plan-D Task 21 / ISC-INT.1 — m4 full-flow E2E.
 *
 * This is the m4 sibling of `tests/e2e/m3-full-flow.test.ts`. It exercises
 * the *m4-specific* additions on top of the m3 baseline:
 *   1. real-gzp Camera adapter (打真客户 backend) wired through the dispatch
 *      pipeline with `globalThis.fetch` stubbed.
 *   2. Customer-style webhook (signed HMAC) advancing dispatch state
 *      SENT → IN_PROGRESS → COMPLETED.
 *   3. Auto-cancel tick (B1) — when a prediction's confidence drops below
 *      threshold and ages out of the lag window, `tickAutoCancel` cancels
 *      the dispatch and writes an audit row.
 *
 * Out-of-scope flows (already covered by sibling tests; pulling them in here
 * would duplicate fixture pumping with no extra signal):
 *   - PredictionAgent inference path → covered by m3-full-flow.test.ts
 *   - Bing News + gov scrapers signal fusion → covered by news adapter unit
 *     tests; this e2e only stubs their fetch calls so any module that boots
 *     the news pool at import time doesn't blow up on default 404.
 *   - Media-fetch + retro pipeline → covered by m3-full-flow.test.ts; this
 *     test verifies the dispatch state reaches COMPLETED but skips the OSS
 *     download + retrospective generation.
 *   - REVIEWER override of retrospective outcome → covered by m3-full-flow.
 *
 * The minimum bar (per plan-D T21 spec): real-gzp dispatch + webhook +
 * auto-cancel must all transit successfully in one test.
 */

const SECRET = 'm4-e2e-secret-32-chars-min-required-yyy'
const REAL_BACKEND = 'https://camera-real.example.com.cn'

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string
let originalFetch: typeof fetch
const externalIdSeen: { current: string | null } = { current: null }

beforeAll(async () => {
  // Env: select real-gzp as the active backend, give it the customer-style
  // credentials our stub will accept. resetEnvCache + resetAdapterPool +
  // initAdapterPool re-reads these and rebuilds the pool with a real-gzp
  // factory wired up.
  process.env.SESSION_SECRET = '0'.repeat(64)
  process.env.WEBHOOK_HMAC_SECRET = SECRET
  process.env.CAMERA_BACKEND_KIND = 'real-gzp'
  process.env.REAL_GZP_API_KEY = 'm4-e2e-key'
  process.env.REAL_GZP_BACKEND_URL = REAL_BACKEND
  process.env.REAL_GZP_REQUEST_TIMEOUT_MS = '30000'

  resetEnvCacheForTests()
  resetAdapterPoolForTests()
  initAdapterPool()

  ctx = await createTestDb()
  app = buildTestApp(ctx.db)

  // Stub globalThis.fetch routing per Plan-D T21:
  //   - real-gzp /dispatch + /cancel → 200 with externalId/acceptedAt
  //   - api.bing.microsoft.com         → empty results envelope
  //   - gd.gov.cn / gz.gov.cn         → empty HTML (robots.txt allow-all)
  //   - everything else                → 404 (default; surfaces stub gaps)
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: unknown): Promise<Response> => {
    const u = String(url)

    // real-gzp adapter (talks to customer backend). Our stub intercepts the
    // outgoing /dispatch + /cancel calls and replies with a customer-shaped
    // ack so the adapter can hand back an externalId.
    if (u.startsWith(REAL_BACKEND) || u.includes('camera-real')) {
      if (u.endsWith('/dispatch')) {
        const externalId = `m4-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`
        externalIdSeen.current = externalId
        return new Response(
          JSON.stringify({ externalId, acceptedAt: new Date().toISOString() }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (u.endsWith('/cancel')) {
        return new Response(
          JSON.stringify({
            externalId: externalIdSeen.current ?? 'm4-ext-cancel',
            cancelledAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    // Bing News v7 — m4 A2-α path. Stub returns empty results so any caller
    // gets a clean degraded fallback.
    if (u.includes('api.bing.microsoft.com')) {
      return new Response(JSON.stringify({ value: [] }), { status: 200 })
    }

    // Gov scrapers — m4 A2-γ. robots.txt → allow-all, page bodies → empty
    // HTML. Adapters return [] in this case.
    if (u.includes('gd.gov.cn') || u.includes('gz.gov.cn')) {
      if (u.endsWith('/robots.txt')) return new Response('User-agent: *\n', { status: 200 })
      return new Response('<html><body></body></html>', { status: 200 })
    }

    return new Response('not stubbed', { status: 404 })
  }) as unknown as typeof fetch

  // Seed user with the 3 m3/m4 roles. ANALYST creates watchlists/predictions,
  // DECIDER approves + the auto-cancel inbox notification target.
  const email = `m4-e2e+${Date.now()}@x`
  const [u] = await ctx.db
    .insert(users)
    .values({ email, passwordHash: await hashPassword('pass1234') })
    .returning()
  for (const key of ['DECIDER', 'ANALYST', 'REVIEWER'] as const) {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label: key }).returning()
    await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
  }
  const login = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  expect(login.status).toBe(200)
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  // Restore env so other suites in the same bun process don't see real-gzp.
  delete process.env.CAMERA_BACKEND_KIND
  delete process.env.REAL_GZP_API_KEY
  delete process.env.REAL_GZP_BACKEND_URL
  delete process.env.REAL_GZP_REQUEST_TIMEOUT_MS
  resetEnvCacheForTests()
  resetAdapterPoolForTests()
  initAdapterPool()
  await ctx.cleanup()
})

describe('m4 full flow E2E (T21 / ISC-INT.1)', () => {
  test('real-gzp dispatch → webhook IN_PROGRESS+COMPLETED → confidence drop → tickAutoCancel', async () => {
    const stamp = `m4-${Date.now()}`

    // ── Phase 1: Seed taxonomy + region + watchlist + PROPOSED prediction ──
    const regResult = await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `)
    const reg = regResult[0]!
    const [vc] = await ctx.db
      .insert(vehicleClasses)
      .values({ name: `应急车-${stamp}`, level: 1 })
      .returning()
    const [tc] = await ctx.db
      .insert(taskClasses)
      .values({ name: `救援-${stamp}`, level: 1 })
      .returning()

    // Build a prediction directly via SQL — the prediction-agent path is
    // already exercised by m3-full-flow; what this test cares about is the
    // *dispatch* path with real-gzp, and the auto-cancel path off a low
    // confidence_now. Start with confidence_now=50 (above the 0.3 threshold)
    // so phase-1 dispatch goes through cleanly.
    const [predRow] = await ctx.db
      .insert(predictions)
      .values({
        sourceKind: 'WATCHLIST',
        sourceId: vc!.id,
        regionId: reg.id,
        regionVersion: reg.version,
        windowDate: new Date('2026-05-15'),
        windowHalf: 'AM',
        vehicleClassId: vc!.id,
        taskClassId: tc!.id,
        confidenceNow: 50, // above 30 = above threshold
        kDays: 9,
        expiresAt: new Date(Date.now() + 9 * 86400_000),
      })
      .returning()
    const predictionId = predRow!.id

    // ── Phase 2: Dispatch via processDispatchJob → real-gzp adapter ────────
    // The default dispatch pool has real-gzp registered now (alsoRegister
    // from CAMERA_BACKEND_KIND=real-gzp). enqueueDispatch is called inside
    // the worker handler; the adapter calls `${REAL_BACKEND}/dispatch`,
    // which our stubbed fetch intercepts and ack's.
    const dispatchOut = await processDispatchJob(ctx.db, {
      predictionId,
      adapterKey: 'real-gzp',
    })
    expect(dispatchOut.dispatchId).toBeTruthy()
    expect(dispatchOut.externalId).toBeTruthy()
    expect(dispatchOut.externalId).toMatch(/^m4-ext-/)

    const [taskAfterSend] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatchOut.dispatchId))
    expect(taskAfterSend!.state).toBe('SENT')
    expect(taskAfterSend!.adapterKey).toBe('real-gzp')
    expect(taskAfterSend!.externalId).toBe(dispatchOut.externalId)

    // ── Phase 3: Customer webhook → IN_PROGRESS ────────────────────────────
    // Real-gzp adapter does NOT push webhooks itself — it only calls
    // /dispatch + /cancel. State advancement comes from the customer
    // POST'ing to our /webhook/real-gzp endpoint with a signed body.
    const inProgressBody = JSON.stringify({
      externalId: dispatchOut.externalId,
      state: 'IN_PROGRESS',
      meta: { ack: 'crew dispatched' },
    })
    const inProgressRes = await app.request('/webhook/real-gzp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': computeSignature(inProgressBody, SECRET),
        'x-idempotency-key': `m4-wh-prog-${Date.now()}`,
      },
      body: inProgressBody,
    })
    expect(inProgressRes.status).toBe(200)
    const [taskAfterProg] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatchOut.dispatchId))
    expect(taskAfterProg!.state).toBe('IN_PROGRESS')

    // ── Phase 4: Customer webhook → COMPLETED with mediaUrls ───────────────
    const completedBody = JSON.stringify({
      externalId: dispatchOut.externalId,
      state: 'COMPLETED',
      mediaUrls: [
        { url: 'https://customer-cdn.example/m4/img1.jpg', type: 'image' },
        { url: 'https://customer-cdn.example/m4/img2.jpg', type: 'image' },
      ],
    })
    const completedRes = await app.request('/webhook/real-gzp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': computeSignature(completedBody, SECRET),
        'x-idempotency-key': `m4-wh-done-${Date.now()}`,
      },
      body: completedBody,
    })
    expect(completedRes.status).toBe(200)
    const [taskAfterDone] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatchOut.dispatchId))
    expect(taskAfterDone!.state).toBe('COMPLETED')
    expect(taskAfterDone!.completedAt).not.toBeNull()

    // ── Phase 5: Auto-cancel scenario on a SECOND prediction ───────────────
    // The first prediction is COMPLETED — auto-cancel SQL filter excludes
    // it (state IN QUEUED/SENT/IN_PROGRESS only). Stand up a second
    // prediction + dispatch in SENT state, then drop confidence_now under
    // the 0.3 threshold and age `auto_cancel_below_since` past the 15-min
    // lag. tickAutoCancel should pick it up and cancel.
    const [pred2] = await ctx.db
      .insert(predictions)
      .values({
        sourceKind: 'WATCHLIST',
        sourceId: vc!.id,
        regionId: reg.id,
        regionVersion: reg.version,
        windowDate: new Date('2026-05-16'),
        windowHalf: 'AM',
        vehicleClassId: vc!.id,
        taskClassId: tc!.id,
        confidenceNow: 50, // start above threshold
        kDays: 9,
        expiresAt: new Date(Date.now() + 9 * 86400_000),
      })
      .returning()
    const [dispatch2] = await ctx.db
      .insert(dispatchTasks)
      .values({
        predictionId: pred2!.id,
        adapterKey: 'mock', // mock adapter is safe to cancel without real network
        externalId: `m4-ext2-${Date.now()}`,
        state: 'SENT',
        paramsJson: {},
      })
      .returning()

    // Drop confidence + age the below-since marker past the 15-minute lag.
    await ctx.db.execute(sql`
      UPDATE predictions
      SET confidence_now = 20,
          auto_cancel_below_since = NOW() - INTERVAL '20 minutes'
      WHERE id = ${pred2!.id}::uuid
    `)

    const acResult = await tickAutoCancel({
      db: ctx.db,
      threshold: 0.3,
      lagMinutes: 15,
      notify: true,
    })
    expect(acResult.errors).toBe(0)
    expect(acResult.cancelled).toBeGreaterThanOrEqual(1)

    const [task2After] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatch2!.id))
    expect(task2After!.state).toBe('CANCEL_PENDING')

    // Audit row written for the auto-cancel.
    const audits = await ctx.db.execute<{ action: string; reason: string }>(sql`
      SELECT action, reason FROM audit.operation_audit
      WHERE target_kind = 'dispatch'
        AND target_id = ${dispatch2!.id}::uuid
        AND action = 'AUTO_CANCEL_DISPATCH'
    `)
    const auditRows = audits as unknown as Array<{ action: string; reason: string }>
    expect(auditRows.length).toBe(1)
    expect(auditRows[0]!.reason).toMatch(/\[AUTO\] confidence dropped to 0\.200/)

    // ── Phase 6 (deferred): Retro aggregate endpoint ──────────────────────
    // GET /retrospectives/aggregate is exercised by tests/modules/retrospective
    // unit suites. Pulling it into this e2e would require running the
    // retrospective worker (LLM mock, 7-day retention bypass) for a flow
    // already proven by m3-full-flow + the C-5 dedicated suite. Leaving as a
    // trace breadcrumb here for the m4 acceptance checklist.
  }, 30000)
})
