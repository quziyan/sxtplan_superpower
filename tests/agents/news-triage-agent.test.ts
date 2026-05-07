import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { runNewsTriageAgent } from '@/agents/news-triage-agent'
import { newsItems, predictions } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import type { InferenceResponse } from '@/inference/types'
import { createTestDb } from '../helpers/test-db'

const RELEVANT_OUTPUT = {
  relevant: true, weight: 'HIGH',
  reasoning: '茂名应急局明确点名抢险救援车,且时间地区吻合,信号强',
  extracted_signals: ['II 级响应启动', '高喷消防车前置'],
}

const IRRELEVANT_OUTPUT = {
  relevant: false, weight: 'LOW',
  reasoning: '该新闻只与气象预警有关,未涉及任何车辆调度信号',
  extracted_signals: [],
}

let nextOutput: object = RELEVANT_OUTPUT

const mockInfer = async (): Promise<InferenceResponse> => ({
  text: JSON.stringify(nextOutput),
  promptTokens: 100,
  completionTokens: 30,
  totalTokens: 130,
  model: 'mock',
})

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function setup(db: typeof ctx.db, label: string) {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `应急车-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `抢险-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vc!.id,
    regionId: reg.id, regionVersion: reg.version,
    windowDate: new Date('2026-05-15'), windowHalf: 'AM',
    vehicleClassId: vc!.id, taskClassId: tc!.id,
    kDays: 9, expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()
  const [n] = await db.insert(newsItems).values({
    url: `https://news.example/${label}`,
    sourceKind: 'MAINSTREAM',
    sourceLabel: '南方日报',
    title: '台风消息',
    summaryZh: '相关摘要',
    contentHash: `h-${label}`,
  }).returning()
  return { prediction: p!, news: n! }
}

describe('runNewsTriageAgent', () => {
  test('relevant=true creates news_evidence with weight from output', async () => {
    const { db } = ctx
    nextOutput = RELEVANT_OUTPUT
    const stamp = `tri-rel-${Date.now()}`
    const { prediction, news } = await setup(db, stamp)
    const out = await runNewsTriageAgent(db, { newsId: news.id, predictionId: prediction.id }, mockInfer)
    expect(out.relevant).toBe(true)
    expect(out.weight).toBe('HIGH')

    const evCount = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM news_evidence
      WHERE prediction_id = ${prediction.id}::uuid AND news_id = ${news.id}::uuid
    `)
    expect((evCount[0] as { n: number }).n).toBe(1)

    // Verify weight stored
    const evRow = await db.execute<{ weight: string }>(sql`
      SELECT weight FROM news_evidence
      WHERE prediction_id = ${prediction.id}::uuid AND news_id = ${news.id}::uuid
    `)
    expect((evRow[0] as { weight: string }).weight).toBe('HIGH')
  })

  test('relevant=false does not insert news_evidence', async () => {
    const { db } = ctx
    nextOutput = IRRELEVANT_OUTPUT
    const stamp = `tri-irr-${Date.now()}`
    const { prediction, news } = await setup(db, stamp)
    const out = await runNewsTriageAgent(db, { newsId: news.id, predictionId: prediction.id }, mockInfer)
    expect(out.relevant).toBe(false)

    const evCount = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM news_evidence
      WHERE prediction_id = ${prediction.id}::uuid AND news_id = ${news.id}::uuid
    `)
    expect((evCount[0] as { n: number }).n).toBe(0)
  })
})
