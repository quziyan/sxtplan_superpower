import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { eq, sql } from 'drizzle-orm'
import { runPredictionAgent } from '@/agents/prediction-agent'
import { runRetrospectiveAgent } from '@/agents/retrospective-agent'
import { authRoutes } from '@/auth/routes'
import { hashPassword } from '@/auth/password'
import { dispatchTasks, mediaAssets } from '@/db/schema/dispatch'
import { roles, userRoles, users } from '@/db/schema/user'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { registerAdapter } from '@/dispatch/adapter-pool'
import { SimulatedGuangzhouPoliceCamAdapter } from '@/dispatch/adapters/simulated-gzp'
import type { FetcherDeps } from '@/media/fetcher'
import { fetchAndPersist } from '@/media/fetcher'
import { AppError } from '@/lib/errors'
import { predictionRoutes } from '@/modules/prediction/routes'
import { retrospectiveRoutes } from '@/modules/retrospective/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { seedPoliceTaxonomy } from '@/seeds/police-taxonomy'
import { processDispatchJob } from '@/scheduler/workers/dispatch'
import { processMediaFetchJob } from '@/scheduler/workers/media-fetch'
import { processRefreshJob } from '@/scheduler/workers/refresh'
import { processRetrospectiveJob } from '@/scheduler/workers/retrospective'
import { processIngest, type MediaFetchQueueLike } from '@/webhook/ingest'
import { createTestDb } from '../helpers/test-db'

/**
 * Plan-C T34 / ISC-42 — m3 full-flow E2E.
 *
 * Walks all 10 steps of the m3 pipeline:
 *   1. seed police taxonomy
 *   2. login as user with all 3 roles
 *   3. create watchlist
 *   4. insert PROPOSED prediction + run PredictionAgent (mock infer)
 *   5. POST /predictions/:id/approve (DECIDER) → captured dispatch job
 *   6. processDispatchJob → simulated-gzp adapter ack with externalId
 *   7. simulated adapter's setTimeout fires IN_PROGRESS webhook (50ms)
 *      → mocked fetch routes to processIngest → state advances
 *   8. setTimeout fires COMPLETED webhook (100ms) with mediaUrls
 *      → processIngest enqueues media-fetch jobs → state advances
 *   9. drain captured media-fetch jobs through processMediaFetchJob with
 *      mocked putObject → MediaAsset rows written
 *  10. processRetrospectiveJob with mock infer (HIT/CAPTURED) → retrospective
 *      row + case_library_entry written
 *  11. GET /retrospectives (REVIEWER) → response includes the retro
 *  12. POST /retrospectives/:id/override → outcomeOverridden=true
 *
 * Adaptations vs plan-C wording:
 *   - 5s/30s adapter delays cut to 50ms/100ms (config DI on T08 adapter)
 *   - infer fns mocked (no LLM calls)
 *   - putObject mocked (no real OSS)
 *   - BullMQ skipped: handlers called directly with stub queue/deps
 *   - real Chrome / browser-fetch loop replaced with globalThis.fetch swap
 *     that routes simulated adapter's webhook POSTs into processIngest
 */

const SECRET = 'm3-e2e-secret-32-chars-min-required-xxx'
const WEBHOOK_URL = 'http://localhost:9999/webhook/simulated-gzp'
const FAKE_MEDIA_BASE = 'http://localhost:9999/static/sim-media/'
const PLACEHOLDER_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

let ctx: Awaited<ReturnType<typeof createTestDb>>
/**
 * Custom Hono app — uses `predictionRoutes(db, deps)` so we can inject a
 * stub `triggerDispatchAfterApproval` that records the job (no Redis hit)
 * and lets the test drive `processDispatchJob` directly.
 */
let app: Hono
let cookie: string
let originalFetch: typeof fetch
const capturedDispatchJobs: Array<{ predictionId: string; adapterKey: string }> = []
const capturedMediaJobs: Array<{
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}> = []

const recordingMediaQueue: MediaFetchQueueLike = {
  add: async (_name, data) => {
    capturedMediaJobs.push(data)
    return { id: `e2e-media-${capturedMediaJobs.length}` }
  },
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  process.env.WEBHOOK_HMAC_SECRET = SECRET
  ctx = await createTestDb()

  // Override the auto-init simulated-gzp adapter with one whose delays
  // are short enough for a deterministic test. registerAdapter() replaces
  // any prior registration for the same key.
  registerAdapter(
    new SimulatedGuangzhouPoliceCamAdapter({
      apiKey: 'm3-e2e-key',
      webhookSecret: SECRET,
      webhookUrl: WEBHOOK_URL,
      fakeMediaBaseUrl: FAKE_MEDIA_BASE,
      inProgressDelayMs: 50,
      completedDelayMs: 100,
      cancelDelayMs: 30,
    }),
  )

  // Build a custom test app with DI for predictionRoutes — captures the
  // dispatch trigger fire instead of pushing to BullMQ.
  app = new Hono()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
    }
    console.error(err)
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
  })
  app.route('/auth', authRoutes(ctx.db))
  app.route('/taxonomy', taxonomyRoutes(ctx.db))
  app.route('/watchlists', watchlistRoutes(ctx.db))
  app.route(
    '/predictions',
    predictionRoutes(ctx.db, {
      triggerDispatchAfterApproval: async (predictionId) => {
        capturedDispatchJobs.push({ predictionId, adapterKey: 'simulated-gzp' })
      },
    }),
  )
  app.route('/retrospectives', retrospectiveRoutes(ctx.db))

  // Swap globalThis.fetch — the simulated adapter posts its webhook via
  // fetch(WEBHOOK_URL, ...). We intercept those posts and forward to
  // processIngest synchronously (skipping the real /webhook HTTP layer).
  // Other URLs (the fake-media URLs hit later by processMediaFetchJob)
  // get a tiny JPEG body so fetchAndPersist can hash + write a row.
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<Response> => {
    const u = String(url)
    if (u === WEBHOOK_URL) {
      const headers = init?.headers ?? {}
      const lowered: Record<string, string> = {}
      for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v
      // Drive the dispatch state machine directly; recording-queue swallows
      // the media-fetch jobs so we can drain them after.
      await processIngest(
        ctx.db,
        SECRET,
        {
          adapterKey: 'simulated-gzp',
          rawBody: init?.body ?? '',
          headers: lowered,
        },
        { mediaFetchQueue: recordingMediaQueue },
      )
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (u.startsWith(FAKE_MEDIA_BASE)) {
      // Tiny JPEG bytes — enough for fetchAndPersist's sha256 + size logic.
      return new Response(PLACEHOLDER_JPEG, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    }
    // No other URLs are exercised by this test; fall through to the real
    // fetch (cast through `unknown` to dodge RequestInfo typing differences
    // between bun-types and the `fetch` signature we're emulating).
    return (originalFetch as (...args: unknown[]) => Promise<Response>)(url, init)
  }) as unknown as typeof fetch

  // Seed user with all 3 roles
  const email = `m3-e2e+${Date.now()}@x`
  const [u] = await ctx.db
    .insert(users)
    .values({ email, passwordHash: await hashPassword('pass1234') })
    .returning()
  for (const key of ['DECIDER', 'ANALYST', 'REVIEWER'] as const) {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label: key }).returning()
    await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })
  }
  // Login → grab session cookie
  const login = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  expect(login.status).toBe(200)
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
})

afterAll(async () => {
  // Wait briefly so any late simulated-adapter timers fire into the swapped
  // fetch (NOT the original) before we restore. .unref() means they don't
  // hold the event loop, but if they fire after the swap is reverted they
  // would hit real localhost:9999 and surface as test noise.
  await new Promise((r) => setTimeout(r, 200))
  globalThis.fetch = originalFetch
  await ctx.cleanup()
})

const PRED_AGENT_OUTPUT = {
  confidence: 78,
  ci_low: 71,
  ci_high: 84,
  reasoning: '基于茂名应急局公告与主流报道,综合判断 II 级响应启动后调度概率较高',
  evidence_ids: [],
  key_signals: ['II 级响应'],
}

const RETRO_OUTPUT = {
  prediction_outcome: 'HIT' as const,
  capture_outcome: 'CAPTURED' as const,
  score_v: 90,
  score_r: 85,
  score_w: 80,
  score_t: 88,
  composite: 86,
  causal_md: '## 命中分析\n茂名应急局公告启动 II 级响应,实拍回传确认调度。',
  summary_md: '该预测命中,实拍证实。',
  evidence_news_ids: [],
  key_signals: ['II 级响应启动', '实拍回传'],
}

function mockInferConst(
  payload: object,
): typeof import('@/inference/client').infer {
  return (async () => ({
    text: JSON.stringify(payload),
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    model: 'mock',
  })) as unknown as typeof import('@/inference/client').infer
}

describe('m3 full flow E2E (T34 / ISC-42)', () => {
  test('seed → predict → approve → dispatch → webhook → media → retro → override', async () => {
    const stamp = `m3-${Date.now()}`

    // ── Step 1: seed police taxonomy (idempotent) ──────────────────────
    await seedPoliceTaxonomy(ctx.db)
    const policeVehicles = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM vehicle_classes
      WHERE level = 2 AND parent_id IN (SELECT id FROM vehicle_classes WHERE name = '警务车辆' AND level = 1)
    `)
    expect(Number((policeVehicles[0] as { n: number }).n)).toBe(5)

    // ── Step 2: prepare region + V/T classes for the watchlist ─────────
    // The taxonomy seed creates the policing namespace; the prediction is
    // narrower so we use fresh per-test V/T rows to keep this test isolated
    // from the seeded baseline.
    const regResult = await ctx.db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `)
    const reg = regResult[0]!
    const [vc] = await ctx.db
      .insert(vehicleClasses)
      .values({ name: `应急救援车-${stamp}`, level: 1 })
      .returning()
    const [tc] = await ctx.db
      .insert(taskClasses)
      .values({ name: `抢险救援-${stamp}`, level: 1 })
      .returning()

    // ── Step 3: create watchlist via API as ANALYST ────────────────────
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'ANALYST' }),
    })
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
    const watchlist = (await wlRes.json()) as { id: string }

    // ── Step 4: insert PROPOSED prediction + run PredictionAgent ───────
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

    // Drive PredictionAgent through the worker handler with mocked infer —
    // exercises the same code path the BullMQ worker would run.
    const refreshResult = await processRefreshJob(
      ctx.db,
      { predictionId, kind: 'FULL' },
      mockInferConst(PRED_AGENT_OUTPUT),
    )
    expect(refreshResult.confidence).toBe(78)

    // Sanity check: confidence_now updated + a snapshot was written
    const listRes = await app.request('/predictions?status=PROPOSED', { headers: { cookie } })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as Array<{ id: string; confidenceNow: number }>
    const found = list.find((p) => p.id === predictionId)
    expect(found).toBeDefined()
    expect(found!.confidenceNow).toBe(78)

    // ── Step 5: approve as DECIDER → trigger captured ──────────────────
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'DECIDER' }),
    })
    capturedDispatchJobs.length = 0
    const approveRes = await app.request(`/predictions/${predictionId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: '{}',
    })
    expect(approveRes.status).toBe(200)
    const approved = (await approveRes.json()) as { prediction: { status: string } }
    expect(approved.prediction.status).toBe('APPROVED')

    // The post-approval trigger fired exactly once with simulated-gzp.
    expect(capturedDispatchJobs.length).toBe(1)
    expect(capturedDispatchJobs[0]!).toEqual({
      predictionId,
      adapterKey: 'simulated-gzp',
    })

    // ── Step 6: drive the dispatch worker handler ──────────────────────
    // processDispatchJob → enqueueDispatch → simulated-gzp adapter.dispatch.
    // The adapter immediately schedules two .unref()'d setTimeouts that
    // will reverse-post webhooks to WEBHOOK_URL via globalThis.fetch — our
    // swapped fetch routes those into processIngest, which advances the
    // dispatch_task state row + (on COMPLETED) enqueues media-fetch jobs.
    const dispatchOut = await processDispatchJob(ctx.db, capturedDispatchJobs[0]!)
    expect(dispatchOut.dispatchId).toBeTruthy()
    expect(dispatchOut.externalId).toMatch(/^gzp-/)

    // Right after dispatch, the row is SENT (enqueueDispatch is synchronous
    // through to the adapter ack).
    const [taskAfterSend] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatchOut.dispatchId))
    expect(taskAfterSend!.state).toBe('SENT')
    expect(taskAfterSend!.externalId).toBe(dispatchOut.externalId)

    // ── Step 7+8: wait for IN_PROGRESS + COMPLETED webhooks to drain ───
    // Adapter delays: inProgressDelayMs=50, completedDelayMs=100. Wait
    // 250ms to give both setTimeouts time to fire AND processIngest's
    // async work (envelope insert + advanceFromWebhook txn) to complete.
    await new Promise((r) => setTimeout(r, 250))

    const [taskAfterWebhooks] = await ctx.db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.id, dispatchOut.dispatchId))
    expect(taskAfterWebhooks!.state).toBe('COMPLETED')
    expect(taskAfterWebhooks!.callbackAt).not.toBeNull()
    expect(taskAfterWebhooks!.completedAt).not.toBeNull()

    // The COMPLETED webhook carried 2 mediaUrls — the recording queue
    // captured them as media-fetch jobs targeting our dispatch_task id.
    const ourJobs = capturedMediaJobs.filter((j) => j.dispatchId === dispatchOut.dispatchId)
    expect(ourJobs.length).toBe(2)
    for (const j of ourJobs) {
      expect(j.sourceUrl.startsWith(FAKE_MEDIA_BASE)).toBe(true)
      expect(j.mediaType).toBe('image')
    }

    // ── Step 9: drain media-fetch jobs through the worker handler ──────
    // processMediaFetchJob calls fetchAndPersist by default, which uses
    // the real OSS putObject. We shim putObject via the inner fetcher's
    // FetcherDeps so no real OSS call happens; the fetched bytes come
    // from our globalThis.fetch swap (placeholder JPEG).
    const ossCalls: Array<{ key: string; bytes: number }> = []
    const fetcherDeps: FetcherDeps = {
      putObject: async (key, body) => {
        ossCalls.push({ key, bytes: body.byteLength })
        return { uri: `oss://m3-test/${key}` }
      },
    }
    for (const j of ourJobs) {
      await processMediaFetchJob(ctx.db, j, {
        fetchAndPersist: (db, task) => fetchAndPersist(db, task, fetcherDeps),
      })
    }
    expect(ossCalls.length).toBe(2)

    const mediaRows = await ctx.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.dispatchId, dispatchOut.dispatchId))
    expect(mediaRows.length).toBe(2)
    for (const m of mediaRows) {
      expect(m.ossUri.startsWith('oss://m3-test/')).toBe(true)
      expect(m.scanStatus).toBe('OK')
      expect(m.sizeBytes).toBe(PLACEHOLDER_JPEG.byteLength)
    }

    // ── Step 10: drive the retrospective worker handler ────────────────
    // Skip the 7-day retention wait; processRetrospectiveJob delegates to
    // runRetrospectiveAgent with our HIT/CAPTURED mock.
    const retroOut = await processRetrospectiveJob(
      ctx.db,
      { predictionId },
      {
        runRetrospectiveAgent: (db, input) =>
          runRetrospectiveAgent(db, input, mockInferConst(RETRO_OUTPUT)),
      },
    )
    expect(retroOut.predictionOutcome).toBe('HIT')
    expect(retroOut.captureOutcome).toBe('CAPTURED')

    // ── Step 11: GET /retrospectives (REVIEWER) sees the row ───────────
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'REVIEWER' }),
    })
    const listRetroRes = await app.request('/retrospectives?limit=200', { headers: { cookie } })
    expect(listRetroRes.status).toBe(200)
    const listRetroBody = (await listRetroRes.json()) as {
      ok: boolean
      items: Array<{ id: string; predictionId: string; outcomeOverridden: boolean }>
    }
    const ourRetro = listRetroBody.items.find((r) => r.predictionId === predictionId)
    expect(ourRetro).toBeDefined()
    expect(ourRetro!.id).toBe(retroOut.retrospectiveId)
    expect(ourRetro!.outcomeOverridden).toBe(false)

    // ── Step 12: POST /retrospectives/:id/override (REVIEWER) ──────────
    const overrideRes = await app.request(
      `/retrospectives/${retroOut.retrospectiveId}/override`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          newPredictionOutcome: 'MISS',
          newCaptureOutcome: 'NOT_CAPTURED',
          reason: 'reviewer-judged miss after manual review',
        }),
      },
    )
    expect(overrideRes.status).toBe(200)
    const overrideBody = (await overrideRes.json()) as {
      ok: boolean
      retrospective: {
        id: string
        outcomeOverridden: boolean
        predictionOutcome: string
        captureOutcome: string
      }
    }
    expect(overrideBody.retrospective.outcomeOverridden).toBe(true)
    expect(overrideBody.retrospective.predictionOutcome).toBe('MISS')
    expect(overrideBody.retrospective.captureOutcome).toBe('NOT_CAPTURED')

    // List again: outcomeOverridden=true is now reflected
    const listAfterOverride = await app.request('/retrospectives?limit=200', { headers: { cookie } })
    const listAfterBody = (await listAfterOverride.json()) as {
      items: Array<{ id: string; outcomeOverridden: boolean }>
    }
    const overriddenRow = listAfterBody.items.find((r) => r.id === retroOut.retrospectiveId)
    expect(overriddenRow!.outcomeOverridden).toBe(true)
  }, 30000)
})
