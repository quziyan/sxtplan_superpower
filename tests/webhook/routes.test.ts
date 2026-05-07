import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { dispatchResults, dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { webhookEnvelopes } from '@/db/schema/webhook'
import { resetEnvCacheForTests } from '@/env'
import { processIngest, type MediaFetchQueueLike } from '@/webhook/ingest'
import { computeSignature } from '@/webhook/signature'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

const SECRET = 'test-secret-32-chars-min-required-xx'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  process.env.WEBHOOK_HMAC_SECRET = SECRET
  resetEnvCacheForTests()
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
})
afterAll(async () => {
  await ctx.cleanup()
  resetEnvCacheForTests()
})

describe('webhook routes', () => {
  test('valid signature → 200 PROCESSED with envelopeId', async () => {
    const body = JSON.stringify({ event: 'test', n: 1 })
    const sig = computeSignature(body, SECRET)
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
        'x-idempotency-key': `valid-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; envelopeId: string; status: string }
    expect(json.ok).toBe(true)
    expect(json.status).toBe('PROCESSED')
    expect(json.envelopeId).toBeTruthy()
  })

  test('bad signature → 401', async () => {
    const body = JSON.stringify({ event: 'bad' })
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'deadbeef'.repeat(8), // 64 hex chars but wrong
        'x-idempotency-key': `bad-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  test('duplicate idempotency-key → second returns DUPLICATE', async () => {
    const body = JSON.stringify({ event: 'dup', n: 2 })
    const sig = computeSignature(body, SECRET)
    const idem = `dup-${Date.now()}-${Math.random()}`
    const headers = {
      'content-type': 'application/json',
      'x-signature': sig,
      'x-idempotency-key': idem,
    }
    const r1 = await app.request('/webhook/mock', { method: 'POST', headers, body })
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { status: string; envelopeId: string }
    expect(j1.status).toBe('PROCESSED')

    const r2 = await app.request('/webhook/mock', { method: 'POST', headers, body })
    expect(r2.status).toBe(200)
    const j2 = (await r2.json()) as { status: string; envelopeId: string }
    expect(j2.status).toBe('DUPLICATE')
    expect(j2.envelopeId).toBe(j1.envelopeId)
  })

  test('unknown adapter → 404', async () => {
    const body = JSON.stringify({ event: 'x' })
    const sig = computeSignature(body, SECRET)
    const res = await app.request('/webhook/nonexistent-adapter', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
        'x-idempotency-key': `unk-${Date.now()}`,
      },
      body,
    })
    expect(res.status).toBe(404)
  })

  test('missing signature header → 401', async () => {
    const body = JSON.stringify({ event: 'no-sig' })
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': `nosig-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(401)
  })
})

// --- Helper: build a prediction + dispatch_task row in any state. -----------
const TRIAGE_POLY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function seedDispatchTask(
  db: typeof ctx.db,
  opts: { label: string; adapterKey: string; externalId: string; state: 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' },
): Promise<{ taskId: string; predictionId: string }> {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${opts.label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(TRIAGE_POLY)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${opts.label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${opts.label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vc!.id,
    regionId: reg.id, regionVersion: reg.version,
    windowDate: new Date('2026-05-15'), windowHalf: 'AM',
    vehicleClassId: vc!.id, taskClassId: tc!.id,
    kDays: 9, expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()
  const [task] = await db.insert(dispatchTasks).values({
    predictionId: p!.id,
    adapterKey: opts.adapterKey,
    externalId: opts.externalId,
    state: opts.state,
    paramsJson: {},
  }).returning()
  return { taskId: task!.id, predictionId: p!.id }
}

type RecordedJob = {
  name: string
  data: { dispatchId: string; sourceUrl: string; mediaType: 'image' | 'video' | 'metadata' }
}

function makeRecordingQueue(): { queue: MediaFetchQueueLike; jobs: RecordedJob[] } {
  const jobs: RecordedJob[] = []
  const queue: MediaFetchQueueLike = {
    add: async (name, data) => {
      jobs.push({ name, data })
      return { id: `mock-${jobs.length}` }
    },
  }
  return { queue, jobs }
}

describe('webhook → dispatch state machine', () => {
  test('happy path: SENT → COMPLETED with payload + mediaUrls enqueues media-fetch jobs', async () => {
    const { db } = ctx
    const adapterKey = 'mock'
    const externalId = `ext-int-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const { taskId } = await seedDispatchTask(db, {
      label: `wh-complete-${Date.now()}`,
      adapterKey, externalId,
      state: 'SENT',
    })

    const body = JSON.stringify({
      externalId,
      state: 'COMPLETED',
      meta: { ok: true, score: 0.93 },
      mediaUrls: [
        'http://localhost:3000/static/sim-media/x.jpg',
        'http://localhost:3000/static/sim-media/y.jpg',
      ],
    })
    const sig = computeSignature(body, SECRET)
    const { queue, jobs } = makeRecordingQueue()
    const r = await processIngest(
      db, SECRET,
      {
        adapterKey,
        rawBody: body,
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `int-complete-${Date.now()}-${Math.random()}`,
        },
      },
      { mediaFetchQueue: queue },
    )
    expect(r.status).toBe('PROCESSED')

    const [task] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, taskId))
    expect(task!.state).toBe('COMPLETED')
    expect(task!.completedAt).not.toBeNull()

    const results = await db.select().from(dispatchResults).where(eq(dispatchResults.dispatchId, taskId))
    expect(results.length).toBe(1)
    expect(results[0]!.payloadJson).toEqual({ ok: true, score: 0.93 })

    expect(jobs.length).toBe(2)
    expect(jobs[0]).toEqual({
      name: 'fetch',
      data: { dispatchId: taskId, sourceUrl: 'http://localhost:3000/static/sim-media/x.jpg', mediaType: 'image' },
    })
    expect(jobs[1]!.data.sourceUrl).toBe('http://localhost:3000/static/sim-media/y.jpg')

    const [envRow] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, r.envelopeId))
    expect(envRow!.status).toBe('PROCESSED')
    expect(envRow!.processedDispatchId).toBe(taskId)
  })

  test('QUEUED → SENT advance via webhook (no media)', async () => {
    const { db } = ctx
    const adapterKey = 'mock'
    const externalId = `ext-int-sent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const { taskId } = await seedDispatchTask(db, {
      label: `wh-sent-${Date.now()}`,
      adapterKey, externalId,
      state: 'QUEUED',
    })

    const body = JSON.stringify({ externalId, state: 'SENT' })
    const sig = computeSignature(body, SECRET)
    const { queue, jobs } = makeRecordingQueue()
    const r = await processIngest(
      db, SECRET,
      {
        adapterKey,
        rawBody: body,
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `int-sent-${Date.now()}-${Math.random()}`,
        },
      },
      { mediaFetchQueue: queue },
    )
    expect(r.status).toBe('PROCESSED')
    expect(jobs.length).toBe(0)

    const [task] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, taskId))
    expect(task!.state).toBe('SENT')

    const [envRow] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, r.envelopeId))
    expect(envRow!.status).toBe('PROCESSED')
  })

  test('invalid transition (COMPLETED → FAILED) marks envelope PROCESSING_FAILED, leaves task untouched', async () => {
    const { db } = ctx
    const adapterKey = 'mock'
    const externalId = `ext-int-bad-trans-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const { taskId } = await seedDispatchTask(db, {
      label: `wh-bad-trans-${Date.now()}`,
      adapterKey, externalId,
      state: 'COMPLETED',
    })

    const body = JSON.stringify({ externalId, state: 'FAILED' })
    const sig = computeSignature(body, SECRET)
    const { queue, jobs } = makeRecordingQueue()
    const r = await processIngest(
      db, SECRET,
      {
        adapterKey,
        rawBody: body,
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `int-bad-trans-${Date.now()}-${Math.random()}`,
        },
      },
      { mediaFetchQueue: queue },
    )
    // Public response shape is preserved — the request was understood + persisted.
    expect(r.status).toBe('PROCESSED')
    expect(jobs.length).toBe(0)

    const [envRow] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, r.envelopeId))
    expect(envRow!.status).toBe('PROCESSING_FAILED')
    expect(envRow!.error).toMatch(/invalid transition/)
    expect(envRow!.processedDispatchId).toBeNull()

    const [task] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, taskId))
    expect(task!.state).toBe('COMPLETED')
  })

  test('bad JSON body marks envelope PROCESSING_FAILED', async () => {
    const { db } = ctx
    const body = 'not-json'
    const sig = computeSignature(body, SECRET)
    const { queue, jobs } = makeRecordingQueue()
    const r = await processIngest(
      db, SECRET,
      {
        adapterKey: 'mock',
        rawBody: body,
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `int-badjson-${Date.now()}-${Math.random()}`,
        },
      },
      { mediaFetchQueue: queue },
    )
    expect(r.status).toBe('PROCESSED')
    expect(jobs.length).toBe(0)

    const [envRow] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, r.envelopeId))
    expect(envRow!.status).toBe('PROCESSING_FAILED')
    expect(envRow!.error).toMatch(/invalid JSON/i)
  })

  test('unknown externalId marks envelope PROCESSING_FAILED with `unknown dispatch`', async () => {
    const { db } = ctx
    const body = JSON.stringify({
      externalId: `ext-int-ghost-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      state: 'SENT',
    })
    const sig = computeSignature(body, SECRET)
    const { queue, jobs } = makeRecordingQueue()
    const r = await processIngest(
      db, SECRET,
      {
        adapterKey: 'mock',
        rawBody: body,
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `int-ghost-${Date.now()}-${Math.random()}`,
        },
      },
      { mediaFetchQueue: queue },
    )
    expect(r.status).toBe('PROCESSED')
    expect(jobs.length).toBe(0)

    const [envRow] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, r.envelopeId))
    expect(envRow!.status).toBe('PROCESSING_FAILED')
    expect(envRow!.error).toMatch(/unknown dispatch/)
  })
})
