import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { authRoutes } from '@/auth/routes'
import { roles, userRoles, users } from '@/db/schema/user'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { AppError } from '@/lib/errors'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { demoRoutes } from '@/__demo/routes'
import { createTestDb } from '../helpers/test-db'

/**
 * Plan-C T37 / Slice 0 — coverage for the customer-demo helper
 * routes (`POST /__demo/seed-prediction`, `POST /__demo/run-retro`).
 *
 * Goals:
 *   1. /__demo/seed-prediction creates a PROPOSED prediction tied to
 *      the watchlist's V/T/R + writes a confidence_now > 0.
 *   2. /__demo/run-retro on a not-yet-settled prediction returns 400
 *      (the agent rejects PROPOSED rows). This verifies the helper
 *      wires the agent's failure path through to a clean 400 instead
 *      of a 500.
 *   3. /__demo/* requires auth (401 without cookie).
 *
 * The full happy-path retro-run lives in `tests/e2e/m3-full-flow.test.ts`
 * — that test already drives `processRetrospectiveJob` end-to-end with a
 * mocked LLM and exercises the same code path the demo helper invokes.
 * Re-running it here would need another infer mock + bypass of the
 * agent's strict status check; the e2e test is the canonical coverage.
 */

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: Hono
let cookie: string
let regionId: string
let regionVersion: number
let vehicleClassId: string
let taskClassId: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()

  // Custom mini-app with just auth + watchlist + demo routes — keeps the
  // test focused on the helper without dragging the full production app.
  app = new Hono()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
    }
    console.error(err)
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
  })
  app.route('/auth', authRoutes(ctx.db))
  app.route('/watchlists', watchlistRoutes(ctx.db))
  app.route('/__demo', demoRoutes(ctx.db))

  const stamp = Date.now()
  const email = `demo+${stamp}@x`
  const [u] = await ctx.db
    .insert(users)
    .values({ email, passwordHash: await hashPassword('pass1234') })
    .returning()

  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })

  const login = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roleKey: 'ANALYST' }),
  })

  // Supporting data — region + V/T classes.
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'demo-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  regionId = reg.id
  regionVersion = reg.version

  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `demo-vc-${stamp}`, level: 1 }).returning()
  vehicleClassId = vc!.id
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `demo-tc-${stamp}`, level: 1 }).returning()
  taskClassId = tc!.id
})

afterAll(async () => {
  await ctx.cleanup()
})

describe('__demo helper routes (Plan-C T37)', () => {
  let watchListId: string
  let predictionId: string

  test('seed-prediction requires auth', async () => {
    const res = await app.request('/__demo/seed-prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchListId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(401)
  })

  test('seed-prediction returns 404 for unknown watchlist', async () => {
    const res = await app.request('/__demo/seed-prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ watchListId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(404)
  })

  test('seed-prediction creates PROPOSED prediction with confidence_now > 0', async () => {
    // Create a watchlist via the real API so this test exercises the
    // full lookup path (FK constraint + V/T/R load by id).
    const wlRes = await app.request('/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: `demo-wl-${Date.now()}`,
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
      }),
    })
    expect(wlRes.status).toBe(201)
    watchListId = ((await wlRes.json()) as { id: string }).id

    const seedRes = await app.request('/__demo/seed-prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ watchListId }),
    })
    expect(seedRes.status).toBe(201)
    const seedBody = (await seedRes.json()) as { ok: boolean; predictionId: string }
    expect(seedBody.ok).toBe(true)
    expect(seedBody.predictionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    predictionId = seedBody.predictionId

    // Confirm DB state: status PROPOSED, confidence_now=78, snapshot exists.
    const rows = await ctx.db.execute<{
      status: string
      confidence_now: number
      source_kind: string
      source_id: string
    }>(sql`
      SELECT status, confidence_now, source_kind, source_id::text AS source_id
      FROM predictions WHERE id = ${predictionId}::uuid
    `)
    const pred = rows[0]
    expect(pred).toBeDefined()
    expect(pred!.status).toBe('PROPOSED')
    expect(pred!.confidence_now).toBe(78)
    expect(pred!.source_kind).toBe('WATCHLIST')
    expect(pred!.source_id).toBe(watchListId)

    const snaps = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM confidence_snapshots
      WHERE prediction_id = ${predictionId}::uuid
    `)
    expect(Number((snaps[0] as { n: number }).n)).toBe(1)
  })

  test('run-retro requires auth', async () => {
    const res = await app.request('/__demo/run-retro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ predictionId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(401)
  })

  test('run-retro on PROPOSED prediction returns 400 (agent requires settled status)', async () => {
    // The seeded prediction is still PROPOSED — runRetrospectiveAgent's
    // contract requires the prediction be settled (COMPLETED / EXPIRED).
    // Helper translates that throw into a 400 so the demo person sees a
    // clean DevTools error instead of a 500.
    const res = await app.request('/__demo/run-retro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ predictionId }),
    })
    expect(res.status).toBe(400)
  })

  test('run-retro on unknown prediction returns 400', async () => {
    const res = await app.request('/__demo/run-retro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ predictionId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(400)
  })
})
