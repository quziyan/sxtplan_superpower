/**
 * Plan-D Task 5 / ISC-C5 — GET /retrospectives/aggregate integration test.
 *
 * The route returns a single SQL GROUP BY over the `retrospectives` table —
 * no `[DEMO]%` scoping in the SQL. To get a deterministic 15-row baseline we:
 *   1. wipe the entire `retrospectives` table (and `case_library_entries` for
 *      FK safety) inside the test DB;
 *   2. seed via `seedDemoData` to get the known 15-retro distribution;
 *   3. call the route with a REVIEWER cookie;
 *   4. assert total + hitRate + the (HIT, CAPTURED) cell against the seed plan.
 *
 * The 15-retro distribution from `src/seeds/demo-data.ts` RETRO_PLAN:
 *   4 HIT/CAPTURED · 2 HIT/NOT_CAPTURED · 1 HIT/NOT_DISPATCHED
 *   3 MISS/NOT_CAPTURED · 2 MISS/NOT_DISPATCHED
 *   2 NO_DATA/NOT_DISPATCHED · 1 NO_DATA/UNKNOWN
 * Total HIT = 7, hitRate = 7/15 ≈ 0.4667.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { MockOssAdapter } from '@/media/adapters/mock-oss'
import { cleanupDemoData, seedDemoData } from '@/seeds/demo-data'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let reviewerCookie: string

async function loginWithRole(email: string, roleKey: string) {
  const res = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  const c = (res.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: c },
    body: JSON.stringify({ roleKey }),
  })
  return c
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)

  // Wipe ALL retrospectives so the aggregate sees only what we seed.
  // case_library_entries → retrospectives FK cascades on delete, but we
  // delete it explicitly first for clarity.
  await ctx.db.execute(sql`DELETE FROM case_library_entries`)
  await ctx.db.execute(sql`DELETE FROM retrospectives`)

  // Seed the known 15-retro demo distribution.
  const oss = new MockOssAdapter()
  const seeded = await seedDemoData(ctx.db, oss)
  if (seeded.retrospectives !== 15) {
    throw new Error(`expected 15 seeded retrospectives, got ${seeded.retrospectives}`)
  }

  // REVIEWER login
  const stamp = Date.now()
  const reviewerEmail = `agg-reviewer+${stamp}@x`
  const [ru] = await ctx.db.insert(users).values({
    email: reviewerEmail,
    passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [rr] = await ctx.db.select().from(roles).where(eq(roles.key, 'REVIEWER'))
  if (!rr) [rr] = await ctx.db.insert(roles).values({ key: 'REVIEWER', label: '复盘师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: ru!.id, roleId: rr!.id })
  reviewerCookie = await loginWithRole(reviewerEmail, 'REVIEWER')
})

afterAll(async () => {
  if (ctx) {
    // Clean up the seeded demo rows so the next test file starts clean.
    const oss = new MockOssAdapter()
    await cleanupDemoData(ctx.db, oss)
    await ctx.cleanup()
  }
})

describe('GET /retrospectives/aggregate', () => {
  test('returns rolled-up KPI + per-cell counts for seeded demo data', async () => {
    const res = await app.request('/retrospectives/aggregate', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      aggregate: {
        total: number
        byOutcome: Array<{
          predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
          captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
          count: number
          overriddenCount: number
        }>
        hitRate: number
        missRate: number
        capturedRate: number
        overriddenRate: number
      }
    }

    expect(body.ok).toBe(true)
    const agg = body.aggregate

    // Seed plan: 15 retros total. HIT=7 (4+2+1), MISS=5 (3+2), NO_DATA=3 (2+1).
    expect(agg.total).toBe(15)
    expect(agg.hitRate).toBeCloseTo(7 / 15, 2)
    expect(agg.missRate).toBeCloseTo(5 / 15, 2)
    expect(agg.capturedRate).toBeCloseTo(4 / 15, 2)
    // Demo seed never sets outcome_overridden=true.
    expect(agg.overriddenRate).toBe(0)

    // 7 distinct (predictionOutcome, captureOutcome) pairs in the seed plan.
    expect(agg.byOutcome.length).toBe(7)

    // The HIT/CAPTURED bucket has exactly 4 rows per RETRO_PLAN.
    const hitCaptured = agg.byOutcome.find(
      (r) => r.predictionOutcome === 'HIT' && r.captureOutcome === 'CAPTURED',
    )
    expect(hitCaptured).toBeDefined()
    expect(hitCaptured!.count).toBe(4)
    expect(hitCaptured!.overriddenCount).toBe(0)

    // Spot-check the rarest cell: NO_DATA/UNKNOWN = 1.
    const noDataUnknown = agg.byOutcome.find(
      (r) => r.predictionOutcome === 'NO_DATA' && r.captureOutcome === 'UNKNOWN',
    )
    expect(noDataUnknown).toBeDefined()
    expect(noDataUnknown!.count).toBe(1)

    // Counts must sum back to total.
    const sum = agg.byOutcome.reduce((s, r) => s + r.count, 0)
    expect(sum).toBe(agg.total)
  })

  test('rejects unauthenticated requests', async () => {
    const res = await app.request('/retrospectives/aggregate')
    // authRequired middleware throws Unauthorized → 401
    expect(res.status).toBe(401)
  })
})
