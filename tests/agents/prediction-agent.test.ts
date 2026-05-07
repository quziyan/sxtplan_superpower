import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { runPredictionAgent } from '@/agents/prediction-agent'
import { confidenceSnapshots, newsItems, predictions } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

// Import the real infer so we can restore it after tests.
// Bun mock.module is global per worker; we restore to avoid bleeding into
// other files (e.g. tests/inference/client.test.ts) when bun test runs all.
import * as clientModule from '@/inference/client'

const FAKE_OUTPUT = {
  confidence: 75,
  ci_low: 70,
  ci_high: 80,
  reasoning: '基于茂名应急局公告 + 主流报道,综合判断 II 级响应启动后调度概率较高,符合历史模式',
  evidence_ids: [],
  key_signals: ['II 级响应启动'],
}

const realInfer = clientModule.infer

// Replace infer via spyOn so we can restore it per-test cleanly.
// We install the mock before each test and restore after.
// This avoids the global mock.module bleed that affects client.test.ts.
const inferSpy = mock(async (): ReturnType<typeof clientModule.infer> => ({
  text: JSON.stringify(FAKE_OUTPUT),
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  model: 'mock',
}))

// Patch the module export in place (works because ESM live bindings are mutable
// from the importer side in Bun's CommonJS-compatible module system).
// Alternatively we use mock.module which is the canonical Bun approach.
mock.module('@/inference/client', () => ({
  infer: inferSpy,
}))

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.cleanup()
  // Restore the real implementation so client.test.ts isn't affected
  // when bun runs all files in the same worker process.
  mock.module('@/inference/client', () => ({
    infer: realInfer,
  }))
})

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

describe('runPredictionAgent', () => {
  test('FULL kind writes snapshot + updates confidenceNow', async () => {
    const { db } = ctx
    const stamp = `pa-full-${Date.now()}`
    const { prediction } = await setup(db, stamp)

    const out = await runPredictionAgent(db, { predictionId: prediction.id, kind: 'FULL' })
    expect(out.confidence).toBe(75)

    // Verify snapshot was written
    const snaps = await db.select().from(confidenceSnapshots)
      .where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.kind).toBe('FULL')
    expect(snaps[0]!.confidence).toBe(75)
    expect(snaps[0]!.operator).toBe('PredictionAgent')

    // Verify prediction was updated
    const [updated] = await db.select().from(predictions).where(sql`id = ${prediction.id}::uuid`)
    expect(updated!.confidenceNow).toBe(75)
    expect(updated!.lastFullAt).not.toBeNull()
    expect(updated!.lastIncrAt).toBeNull()
  })

  test('INCR kind requires newEvidenceNewsIds', async () => {
    const { db } = ctx
    const stamp = `pa-incr-bad-${Date.now()}`
    const { prediction } = await setup(db, stamp)
    await expect(
      runPredictionAgent(db, { predictionId: prediction.id, kind: 'INCR' }),
    ).rejects.toThrow(/newEvidenceNewsIds/)
  })

  test('INCR creates news_evidence link + writes INCR snapshot', async () => {
    const { db } = ctx
    const stamp = `pa-incr-${Date.now()}`
    const { prediction } = await setup(db, stamp)
    const [news] = await db.insert(newsItems).values({
      url: `https://news.example/${stamp}`,
      sourceKind: 'MAINSTREAM',
      sourceLabel: '南方日报',
      title: '台风消息',
      summaryZh: '相关摘要',
      contentHash: `h-${stamp}`,
    }).returning()

    const out = await runPredictionAgent(db, {
      predictionId: prediction.id,
      kind: 'INCR',
      newEvidenceNewsIds: [news!.id],
    })
    expect(out.confidence).toBe(75)

    // Verify INCR snapshot
    const snaps = await db.select().from(confidenceSnapshots)
      .where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.kind).toBe('INCR')

    // Verify news_evidence link was created
    const evCount = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM news_evidence
      WHERE prediction_id = ${prediction.id}::uuid
    `)
    expect((evCount[0] as { n: number }).n).toBe(1)
  })
})
