import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import IORedis from 'ioredis'
import { sql } from 'drizzle-orm'
import { confidenceSnapshots, newsItems, predictions } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import type { InferenceRequest, InferenceResponse } from '@/inference/types'
import { createRefreshWorker, processRefreshJob } from '@/scheduler/workers/refresh'
import { createTestDb } from '../../helpers/test-db'

const FAKE_OUTPUT = {
  confidence: 82,
  ci_low: 76,
  ci_high: 88,
  reasoning: '基于茂名应急局公告 + 主流报道,综合判断 II 级响应启动后调度概率较高',
  evidence_ids: [],
  key_signals: ['II 级响应启动'],
}

function makeMockInfer() {
  const calls: InferenceRequest[] = []
  const fn = async (req: InferenceRequest): Promise<InferenceResponse> => {
    calls.push(req)
    return {
      text: JSON.stringify(FAKE_OUTPUT),
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: 'mock',
    }
  }
  return { fn, calls }
}

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function setupPrediction(db: typeof ctx.db, label: string) {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `应急车-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `抢险-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-05-15'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    kDays: 9,
    expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()
  return { prediction: p! }
}

async function redisReachable(): Promise<boolean> {
  const c = new IORedis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  try {
    await c.connect()
    await c.quit()
    return true
  } catch {
    try { c.disconnect() } catch { /* ignore */ }
    return false
  }
}

describe('processRefreshJob', () => {
  test('FULL: returns confidence and writes confidence_snapshots row', async () => {
    const { db } = ctx
    const stamp = `wf-full-${Date.now()}`
    const { prediction } = await setupPrediction(db, stamp)
    const { fn: mockInfer } = makeMockInfer()

    const out = await processRefreshJob(
      db,
      { predictionId: prediction.id, kind: 'FULL' },
      mockInfer,
    )
    expect(out.confidence).toBe(82)

    const snaps = await db.select().from(confidenceSnapshots)
      .where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.kind).toBe('FULL')
    expect(snaps[0]!.confidence).toBe(82)

    const [updated] = await db.select().from(predictions).where(sql`id = ${prediction.id}::uuid`)
    expect(updated!.confidenceNow).toBe(82)
    expect(updated!.lastFullAt).not.toBeNull()
  })

  test('INCR: returns confidence and writes INCR snapshot', async () => {
    const { db } = ctx
    const stamp = `wf-incr-${Date.now()}`
    const { prediction } = await setupPrediction(db, stamp)
    const [news] = await db.insert(newsItems).values({
      url: `https://news.example/${stamp}`,
      sourceKind: 'MAINSTREAM',
      sourceLabel: '南方日报',
      title: '台风消息',
      summaryZh: '相关摘要',
      contentHash: `h-${stamp}`,
    }).returning()
    const { fn: mockInfer } = makeMockInfer()

    const out = await processRefreshJob(
      db,
      { predictionId: prediction.id, kind: 'INCR', newEvidenceNewsIds: [news!.id] },
      mockInfer,
    )
    expect(out.confidence).toBe(82)

    const snaps = await db.select().from(confidenceSnapshots)
      .where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.kind).toBe('INCR')

    const [updated] = await db.select().from(predictions).where(sql`id = ${prediction.id}::uuid`)
    expect(updated!.lastIncrAt).not.toBeNull()
  })

  test('INCR: forwards newEvidenceNewsIds so evidence is loaded into the agent prompt', async () => {
    const { db } = ctx
    const stamp = `wf-incr-fwd-${Date.now()}`
    const { prediction } = await setupPrediction(db, stamp)
    const [news] = await db.insert(newsItems).values({
      url: `https://news.example/${stamp}`,
      sourceKind: 'MAINSTREAM',
      sourceLabel: '南方日报',
      title: `T-${stamp}-唯一标记`,
      summaryZh: '摘要',
      contentHash: `h-${stamp}`,
    }).returning()

    const { fn: mockInfer, calls } = makeMockInfer()

    await processRefreshJob(
      db,
      { predictionId: prediction.id, kind: 'INCR', newEvidenceNewsIds: [news!.id] },
      mockInfer,
    )

    // The agent renders evidence into the user message. If forwarding works,
    // the unique title fragment must appear in the prompt the mock received.
    expect(calls.length).toBe(1)
    const userMsg = calls[0]!.messages.find((m) => m.role === 'user')!
    expect(userMsg.content).toContain(`T-${stamp}-唯一标记`)

    // And news_evidence link should have been created.
    const evCount = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM news_evidence
      WHERE prediction_id = ${prediction.id}::uuid
    `)
    expect((evCount[0] as { n: number }).n).toBe(1)
  })

  test('error path: agent failure propagates from processRefreshJob', async () => {
    const { db } = ctx
    const stamp = `wf-err-${Date.now()}`
    const { prediction } = await setupPrediction(db, stamp)
    const boom = async (): Promise<InferenceResponse> => {
      throw new Error('LLM down')
    }

    await expect(
      processRefreshJob(db, { predictionId: prediction.id, kind: 'FULL' }, boom),
    ).rejects.toThrow(/LLM down/)
  })
})

// Probe Redis at module load time so test.skipIf can use the boolean directly.
const REDIS_OK = await redisReachable()

describe('createRefreshWorker (Redis-gated)', () => {
  test.skipIf(!REDIS_OK)(
    'creates a Worker bound to the refresh queue and closes cleanly',
    async () => {
      const worker = createRefreshWorker()
      try {
        expect(worker.name).toBe('refresh')
      } finally {
        await worker.close()
      }
    },
  )
})
