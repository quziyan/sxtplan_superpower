import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions } from '@/db/schema/prediction'
import { retrospectives } from '@/db/schema/retrospective'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let reviewerCookie: string
let analystCookie: string

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

async function loginWithRole(email: string, roleKey: string) {
  const res = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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

/**
 * Seed a (region, vehicle class, task class, prediction, retrospective) chain
 * for a single test row. Returns ids for assertion.
 */
async function seedRetrospective(
  stamp: string,
  overrides: {
    predictionOutcome?: 'HIT' | 'MISS' | 'NO_DATA'
    captureOutcome?: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
    outcomeOverridden?: boolean
    overriddenReason?: string | null
  } = {},
): Promise<{ retroId: string; predictionId: string; vehicleClassName: string; taskClassName: string; regionName: string }> {
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'retro-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `vc-retro-${stamp}`, level: 1 }).returning()
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `tc-retro-${stamp}`, level: 1 }).returning()
  const [p] = await ctx.db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-06-15'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 7,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  }).returning()

  const predictionOutcome = overrides.predictionOutcome ?? 'HIT'
  const captureOutcome = overrides.captureOutcome ?? 'CAPTURED'
  const outcomeOverridden = overrides.outcomeOverridden ?? false
  const overriddenReason = overrides.overriddenReason ?? null

  const [r] = await ctx.db.insert(retrospectives).values({
    predictionId: p!.id,
    predictionOutcome,
    captureOutcome,
    scoreV: 80,
    scoreR: 70,
    scoreW: 60,
    scoreT: 50,
    composite: 65,
    causalMd: '## Causal\nbecause',
    summaryMd: '## Summary\nworked',
    outcomeOverridden,
    overriddenReason,
  }).returning()

  return {
    retroId: r!.id,
    predictionId: p!.id,
    vehicleClassName: vc!.name,
    taskClassName: tc!.name,
    regionName: 'retro-region-' + stamp,
  }
}

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()

  // REVIEWER user
  const reviewerEmail = `retro-reviewer+${stamp}@x`
  const [ru] = await ctx.db.insert(users).values({
    email: reviewerEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [rr] = await ctx.db.select().from(roles).where(eq(roles.key, 'REVIEWER'))
  if (!rr) [rr] = await ctx.db.insert(roles).values({ key: 'REVIEWER', label: '复盘师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: ru!.id, roleId: rr!.id })
  reviewerCookie = await loginWithRole(reviewerEmail, 'REVIEWER')

  // ANALYST user (for negative-auth test)
  const analystEmail = `retro-analyst+${stamp}@x`
  const [au] = await ctx.db.insert(users).values({
    email: analystEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [ar] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!ar) [ar] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: au!.id, roleId: ar!.id })
  analystCookie = await loginWithRole(analystEmail, 'ANALYST')
})

afterAll(async () => { await ctx.cleanup() })

describe('retrospective routes — list', () => {
  test('GET /retrospectives returns ok + items array (always succeeds; baseline)', async () => {
    const res = await app.request('/retrospectives?limit=1&offset=999999', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; items: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.items)).toBe(true)
    // Empty result for absurd offset.
    expect(body.items.length).toBe(0)
  })

  test('GET /retrospectives?predictionOutcome=HIT filters by HIT only', async () => {
    const stamp = `flt-hit-${Date.now()}`
    const hit = await seedRetrospective(`${stamp}-h`, { predictionOutcome: 'HIT', captureOutcome: 'CAPTURED' })
    const miss = await seedRetrospective(`${stamp}-m`, { predictionOutcome: 'MISS', captureOutcome: 'NOT_CAPTURED' })

    const res = await app.request('/retrospectives?predictionOutcome=HIT&limit=200', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ id: string; predictionOutcome: string }> }
    expect(body.items.every((i) => i.predictionOutcome === 'HIT')).toBe(true)
    expect(body.items.some((i) => i.id === hit.retroId)).toBe(true)
    expect(body.items.some((i) => i.id === miss.retroId)).toBe(false)
  })

  test('GET /retrospectives?captureOutcome=CAPTURED filters by capture outcome', async () => {
    const stamp = `flt-cap-${Date.now()}`
    const captured = await seedRetrospective(`${stamp}-c`, { predictionOutcome: 'HIT', captureOutcome: 'CAPTURED' })
    const notCaptured = await seedRetrospective(`${stamp}-n`, { predictionOutcome: 'MISS', captureOutcome: 'NOT_CAPTURED' })

    const res = await app.request('/retrospectives?captureOutcome=CAPTURED&limit=200', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ id: string; captureOutcome: string }> }
    expect(body.items.every((i) => i.captureOutcome === 'CAPTURED')).toBe(true)
    expect(body.items.some((i) => i.id === captured.retroId)).toBe(true)
    expect(body.items.some((i) => i.id === notCaptured.retroId)).toBe(false)
  })

  test('GET /retrospectives?overridden=true filters by overridden flag', async () => {
    const stamp = `flt-ovr-${Date.now()}`
    const overridden = await seedRetrospective(`${stamp}-o`, {
      predictionOutcome: 'HIT', captureOutcome: 'CAPTURED',
      outcomeOverridden: true, overriddenReason: 'manual reclassify',
    })
    const normal = await seedRetrospective(`${stamp}-n`, {
      predictionOutcome: 'HIT', captureOutcome: 'CAPTURED',
    })

    const res = await app.request('/retrospectives?overridden=true&limit=200', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Array<{ id: string; outcomeOverridden: boolean }> }
    expect(body.items.every((i) => i.outcomeOverridden === true)).toBe(true)
    expect(body.items.some((i) => i.id === overridden.retroId)).toBe(true)
    expect(body.items.some((i) => i.id === normal.retroId)).toBe(false)
  })
})

describe('retrospective routes — get', () => {
  test('GET /retrospectives/:id found returns 200 + prediction join fields', async () => {
    const seed = await seedRetrospective(`get-ok-${Date.now()}`)
    const res = await app.request(`/retrospectives/${seed.retroId}`, { headers: { cookie: reviewerCookie } })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      retrospective: {
        id: string
        predictionId: string
        prediction: { vehicleClass: string; taskClass: string; regionName: string | null }
      }
    }
    expect(body.ok).toBe(true)
    expect(body.retrospective.id).toBe(seed.retroId)
    expect(body.retrospective.predictionId).toBe(seed.predictionId)
    expect(body.retrospective.prediction.vehicleClass).toBe(seed.vehicleClassName)
    expect(body.retrospective.prediction.taskClass).toBe(seed.taskClassName)
    expect(body.retrospective.prediction.regionName).toBe(seed.regionName)
  })

  test('GET /retrospectives/:id not found returns 404', async () => {
    const res = await app.request('/retrospectives/00000000-0000-0000-0000-000000000000', {
      headers: { cookie: reviewerCookie },
    })
    expect(res.status).toBe(404)
  })
})

describe('retrospective routes — override (REVIEWER / D-role)', () => {
  test('POST /retrospectives/:id/override requires REVIEWER role (ANALYST → 401)', async () => {
    const seed = await seedRetrospective(`auth-${Date.now()}`)
    const res = await app.request(`/retrospectives/${seed.retroId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ newPredictionOutcome: 'MISS', reason: 'reclassify' }),
    })
    // roleRequired throws Unauthorized → 401 (matches m2 module pattern)
    expect(res.status).toBe(401)
  })

  test('POST /retrospectives/:id/override missing reason returns 400', async () => {
    const seed = await seedRetrospective(`no-reason-${Date.now()}`)
    const res = await app.request(`/retrospectives/${seed.retroId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: reviewerCookie },
      body: JSON.stringify({ newPredictionOutcome: 'MISS' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /retrospectives/:id/override neither outcome → 400', async () => {
    const seed = await seedRetrospective(`no-outcome-${Date.now()}`)
    const res = await app.request(`/retrospectives/${seed.retroId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: reviewerCookie },
      body: JSON.stringify({ reason: 'just because' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /retrospectives/:id/override CAPTURED+(non-HIT) → 400', async () => {
    // Seed starts as HIT/CAPTURED. Override to MISS while leaving capture=CAPTURED.
    // Service should pre-validate the 二轴 rule and reject before the DB.
    const seed = await seedRetrospective(`bad-combo-${Date.now()}`, {
      predictionOutcome: 'HIT',
      captureOutcome: 'CAPTURED',
    })
    const res = await app.request(`/retrospectives/${seed.retroId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: reviewerCookie },
      body: JSON.stringify({ newPredictionOutcome: 'MISS', reason: 'try invalid combo' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { message: string } }
    expect(body.error.message.toLowerCase()).toContain('captured')
  })

  test('POST /retrospectives/:id/override happy path: row updated + audit log written', async () => {
    const seed = await seedRetrospective(`happy-${Date.now()}`, {
      predictionOutcome: 'HIT',
      captureOutcome: 'CAPTURED',
    })
    const reason = 'analyst evidence revisit'
    const res = await app.request(`/retrospectives/${seed.retroId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: reviewerCookie },
      body: JSON.stringify({
        newPredictionOutcome: 'MISS',
        newCaptureOutcome: 'NOT_CAPTURED',
        reason,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      retrospective: {
        id: string
        predictionOutcome: string
        captureOutcome: string
        outcomeOverridden: boolean
        overriddenReason: string | null
      }
    }
    expect(body.ok).toBe(true)
    expect(body.retrospective.id).toBe(seed.retroId)
    expect(body.retrospective.predictionOutcome).toBe('MISS')
    expect(body.retrospective.captureOutcome).toBe('NOT_CAPTURED')
    expect(body.retrospective.outcomeOverridden).toBe(true)
    expect(body.retrospective.overriddenReason).toBe(reason)

    // Confirm audit log row exists with the right action + reason.
    const auditRows = await ctx.db.execute<{ action: string; target_id: string; reason: string }>(sql`
      SELECT action, target_id, reason
      FROM audit.operation_audit
      WHERE action = 'RETROSPECTIVE_OVERRIDE' AND target_id = ${seed.retroId}::uuid
    `)
    expect(auditRows.length).toBeGreaterThan(0)
    expect(auditRows[0]!.reason).toBe(reason)
  })

  test('POST /retrospectives/:id/override non-existent id → 404', async () => {
    const res = await app.request('/retrospectives/00000000-0000-0000-0000-000000000000/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: reviewerCookie },
      body: JSON.stringify({ newPredictionOutcome: 'MISS', reason: 'ghost row' }),
    })
    expect(res.status).toBe(404)
  })
})
