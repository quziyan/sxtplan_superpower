/**
 * Plan-D Task 5 / ISC-C5 — GET /retrospectives/aggregate integration test.
 *
 * The route returns a single SQL GROUP BY over the `retrospectives` table —
 * no `[DEMO]%` scoping in the SQL. To stay safe under parallel test execution
 * (other test files insert non-`[DEMO]` retrospectives concurrently against
 * the shared Postgres `localhost:5433/cnp`), we use **count-delta semantics**:
 *
 *   1. capture a baseline aggregate BEFORE seeding;
 *   2. seed via `seedDemoData` (idempotent, `[DEMO]%`-scoped) → +15 retros;
 *   3. call the route again → assert per-cell count deltas match the seed plan.
 *
 * The 15-retro distribution from `src/seeds/demo-data.ts` RETRO_PLAN:
 *   4 HIT/CAPTURED · 2 HIT/NOT_CAPTURED · 1 HIT/NOT_DISPATCHED
 *   3 MISS/NOT_CAPTURED · 2 MISS/NOT_DISPATCHED
 *   2 NO_DATA/NOT_DISPATCHED · 1 NO_DATA/UNKNOWN
 * Total HIT delta = 7, MISS delta = 5, NO_DATA delta = 3.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { MockOssAdapter } from '@/media/adapters/mock-oss'
import { cleanupDemoData, seedDemoData } from '@/seeds/demo-data'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let reviewerCookie: string

type RetroAggregateRow = {
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  count: number
  overriddenCount: number
}

type RetroAggregate = {
  total: number
  byOutcome: RetroAggregateRow[]
  hitRate: number
  missRate: number
  capturedRate: number
  overriddenRate: number
}

let baseline: RetroAggregate

/** Index a byOutcome rows array as a Map<"PRED+CAP", count> for delta lookups. */
function indexBy(rows: RetroAggregateRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(`${r.predictionOutcome}+${r.captureOutcome}`, r.count)
  return m
}

/** Index a byOutcome rows array as a Map<"PRED+CAP", overriddenCount>. */
function indexOverridden(rows: RetroAggregateRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(`${r.predictionOutcome}+${r.captureOutcome}`, r.overriddenCount)
  return m
}

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

async function fetchAggregate(cookie: string): Promise<RetroAggregate> {
  const res = await app.request('/retrospectives/aggregate', {
    headers: { cookie },
  })
  expect(res.status).toBe(200)
  const body = await res.json() as { ok: boolean; aggregate: RetroAggregate }
  expect(body.ok).toBe(true)
  return body.aggregate
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)

  // REVIEWER login — must happen BEFORE the baseline call since the route is
  // role-gated. Done before seedDemoData so the baseline reflects whatever
  // pre-existing rows the shared DB holds (parallel test files may have
  // inserted non-`[DEMO]` retrospectives that we must not disturb).
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

  // Baseline: capture aggregate state BEFORE seeding. Tests assert deltas
  // against this so concurrent foreign rows don't contaminate assertions.
  // No DELETE — we never wipe the table, only seed `[DEMO]%`-prefixed rows
  // (idempotent) and let `cleanupDemoData` scope the teardown.
  baseline = await fetchAggregate(reviewerCookie)

  // Seed the known 15-retro demo distribution.
  const oss = new MockOssAdapter()
  const seeded = await seedDemoData(ctx.db, oss)
  if (seeded.retrospectives !== 15) {
    throw new Error(`expected 15 seeded retrospectives, got ${seeded.retrospectives}`)
  }
})

afterAll(async () => {
  if (ctx) {
    // Clean up the seeded demo rows so the next test file starts clean.
    // `cleanupDemoData` deletes only `[DEMO]%`-scoped rows.
    const oss = new MockOssAdapter()
    await cleanupDemoData(ctx.db, oss)
    await ctx.cleanup()
  }
})

describe('GET /retrospectives/aggregate', () => {
  test('returns rolled-up KPI + per-cell counts for seeded demo data', async () => {
    const agg = await fetchAggregate(reviewerCookie)

    // ── Total delta — exactly the 15 seeded rows ──────────────────────────
    expect(agg.total - baseline.total).toBe(15)

    // ── Per-cell count deltas (integer-exact, baseline-independent) ───────
    const before = indexBy(baseline.byOutcome)
    const after = indexBy(agg.byOutcome)
    const delta = (key: string) => (after.get(key) ?? 0) - (before.get(key) ?? 0)

    // Seed plan: 7 distinct (predictionOutcome, captureOutcome) pairs.
    expect(delta('HIT+CAPTURED')).toBe(4)
    expect(delta('HIT+NOT_CAPTURED')).toBe(2)
    expect(delta('HIT+NOT_DISPATCHED')).toBe(1)
    expect(delta('MISS+NOT_CAPTURED')).toBe(3)
    expect(delta('MISS+NOT_DISPATCHED')).toBe(2)
    expect(delta('NO_DATA+NOT_DISPATCHED')).toBe(2)
    expect(delta('NO_DATA+UNKNOWN')).toBe(1)

    // ── Sum of all deltas equals the total delta ──────────────────────────
    const sumDelta = agg.byOutcome.reduce((s, r) => s + r.count, 0)
      - baseline.byOutcome.reduce((s, r) => s + r.count, 0)
    expect(sumDelta).toBe(15)

    // ── Overridden delta — demo seed never sets outcome_overridden=true ──
    const beforeOverridden = indexOverridden(baseline.byOutcome)
    const afterOverridden = indexOverridden(agg.byOutcome)
    const overriddenDelta = (key: string) =>
      (afterOverridden.get(key) ?? 0) - (beforeOverridden.get(key) ?? 0)
    expect(overriddenDelta('HIT+CAPTURED')).toBe(0)
    const totalOverriddenDelta = agg.byOutcome.reduce((s, r) => s + r.overriddenCount, 0)
      - baseline.byOutcome.reduce((s, r) => s + r.overriddenCount, 0)
    expect(totalOverriddenDelta).toBe(0)

    // ── Rate sanity (rates depend on baseline so we only bound them) ──────
    expect(agg.hitRate).toBeGreaterThanOrEqual(0)
    expect(agg.hitRate).toBeLessThanOrEqual(1)
    expect(agg.missRate).toBeGreaterThanOrEqual(0)
    expect(agg.missRate).toBeLessThanOrEqual(1)
    expect(agg.capturedRate).toBeGreaterThanOrEqual(0)
    expect(agg.capturedRate).toBeLessThanOrEqual(1)
    expect(agg.overriddenRate).toBeGreaterThanOrEqual(0)
    expect(agg.overriddenRate).toBeLessThanOrEqual(1)
  })

  test('rejects unauthenticated requests', async () => {
    const res = await app.request('/retrospectives/aggregate')
    // authRequired middleware throws Unauthorized → 401
    expect(res.status).toBe(401)
  })
})
