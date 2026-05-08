/**
 * Plan-E G5 / Task 10 — recompute-now dual-mode integration tests.
 *
 * Covers ISC-G5.1 / G5.2 / G5.3:
 *   - default body / no body → enqueues full-recalc with manualTrigger=true
 *     and writes a `recompute_now_requested` audit row with reason
 *     "FULL P5 manual trigger"
 *   - {kind:"INCR", newEvidenceNewsIds:[...]} → enqueues a refresh INCR job
 *     and writes an audit row with reason "INCR with N news ids"
 *   - {kind:"INCR"} (no ids) → 400 BAD_REQUEST, no audit row written
 *
 * Auth follows the existing m3 pattern from tests/modules/prediction.test.ts:
 * login via POST /auth/login + POST /auth/role-state to capture a cookie.
 *
 * Real BullMQ queues are used — Redis must be reachable. The route only
 * calls `queue.add(...)`, which is fire-and-forget; no worker runs in test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql, eq, and, desc } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { predictions, newsItems } from '@/db/schema/prediction'
import { operationAudit } from '@/db/schema/audit'
import { buildTestApp } from '../../helpers/test-server'
import { createTestDb } from '../../helpers/test-db'

const poly = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let analystCookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const stamp = Date.now()

  const analystEmail = `rcn-analyst+${stamp}@x`
  const [au] = await ctx.db.insert(users).values({
    email: analystEmail,
    passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [ar] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!ar) {
    [ar] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  }
  await ctx.db.insert(userRoles).values({ userId: au!.id, roleId: ar!.id })

  // login → role-state(ANALYST)
  const loginRes = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: analystEmail, password: 'pass1234' }),
  })
  const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]!
  await app.request('/auth/role-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roleKey: 'ANALYST' }),
  })
  analystCookie = cookie
})

afterAll(async () => {
  await ctx.cleanup()
})

/** Insert a fresh region/vehicleClass/taskClass triple + a PROPOSED prediction. */
async function seedPrediction(label: string): Promise<string> {
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
  const [tc] = await ctx.db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()
  const [p] = await ctx.db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-12-31'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 7,
    cadenceMinutes: 60,
    expiresAt: new Date(Date.now() + 86400_000),
  }).returning()
  return p!.id
}

describe('POST /predictions/:id/recompute-now — dual mode (Plan-E G5)', () => {
  test('default body → enqueues full-recalc with manualTrigger=true + audit', async () => {
    const id = await seedPrediction(`rcn-full-${Date.now()}`)

    const res = await app.request(`/predictions/${id}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; mode: string; message: string }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('FULL')

    // Audit row written with FULL reason.
    const audits = await ctx.db
      .select()
      .from(operationAudit)
      .where(and(
        eq(operationAudit.targetId, id),
        eq(operationAudit.action, 'recompute_now_requested'),
      ))
      .orderBy(desc(operationAudit.occurredAt))
    expect(audits.length).toBeGreaterThanOrEqual(1)
    expect(audits[0]!.reason).toBe('FULL P5 manual trigger')
  })

  test('INCR mode with newEvidenceNewsIds → enqueues refresh INCR + audit', async () => {
    const id = await seedPrediction(`rcn-incr-${Date.now()}`)

    // Need a real news_items row so the uuid passes the schema validator
    // and is plausibly persisted (the route itself doesn't FK-check, but a
    // real row keeps the test honest about the contract).
    const stamp = Date.now()
    const [news] = await ctx.db.insert(newsItems).values({
      url: `https://rcn.test/${stamp}`,
      title: 'rcn news',
      sourceLabel: 'rcn.test',
      sourceKind: 'MAINSTREAM',
      contentHash: `h-${stamp}`,
    }).returning()

    const res = await app.request(`/predictions/${id}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ kind: 'INCR', newEvidenceNewsIds: [news!.id] }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; mode: string }
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('INCR')

    const audits = await ctx.db
      .select()
      .from(operationAudit)
      .where(and(
        eq(operationAudit.targetId, id),
        eq(operationAudit.action, 'recompute_now_requested'),
      ))
      .orderBy(desc(operationAudit.occurredAt))
    expect(audits.length).toBeGreaterThanOrEqual(1)
    expect(audits[0]!.reason).toBe('INCR with 1 news ids')
  })

  test('INCR mode without newEvidenceNewsIds → 400, no audit row', async () => {
    const id = await seedPrediction(`rcn-incr-bad-${Date.now()}`)

    const res = await app.request(`/predictions/${id}/recompute-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: analystCookie },
      body: JSON.stringify({ kind: 'INCR' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BAD_REQUEST')

    const audits = await ctx.db
      .select()
      .from(operationAudit)
      .where(and(
        eq(operationAudit.targetId, id),
        eq(operationAudit.action, 'recompute_now_requested'),
      ))
    expect(audits.length).toBe(0)
  })
})
