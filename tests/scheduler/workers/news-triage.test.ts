import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import {
  processNewsTriageJob,
  type RefreshQueueLike,
} from '@/scheduler/workers/news-triage'

/**
 * Plan-E Task 8 — REAL LLM tests for newsTriageWorker (G3, ISC-G3.1..G3.5).
 *
 * These tests intentionally call the real dashscope deepseek-v4-flash via
 * `runNewsTriageAgent`. Cost per run ~¥0.05; latency ~10-30s for 2 calls.
 *
 * Test 1 (high-relevance): the news directly names the V/T/region — LLM
 * should return weight HIGH or MED. We accept either: HIGH triggers evidence
 * + refresh-INCR; MED triggers evidence only. LOW would fail (LLM
 * miscalibration), and we surface that loudly via `expect(['MED','HIGH'])`.
 *
 * Test 2 (low-relevance): off-topic stock-market news. LLM should return
 * relevant=false OR weight=LOW; either path is the no-op branch.
 *
 * Test 3 (LLM error): inject `inferFn` that throws — handler must propagate
 * so BullMQ's retry policy can pick it up (no swallowing of agent errors).
 */

type SeedFixture = { predictionId: string; newsId: string }

async function seedTriageFixture(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  opts: {
    newsTitle: string
    newsSummary: string
    vName: string
    tName: string
    regionName: string
  },
): Promise<SeedFixture> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const regionId = crypto.randomUUID()
  const predId = crypto.randomUUID()
  const newsId = crypto.randomUUID()

  await db.execute(sql`
    INSERT INTO regions(id, version, kind, name, geom, effective_from)
    VALUES(
      ${regionId}::uuid, 1, 'AD_HOC',
      ${opts.regionName + '_' + stamp},
      ST_GeomFromGeoJSON(${'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'}),
      NOW()
    )
  `)

  const { vehicleClasses, taskClasses } = await import('@/db/schema/taxonomy')
  const [vc] = await db
    .insert(vehicleClasses)
    .values({ name: `${opts.vName} ${stamp}`, level: 1 })
    .returning()
  const [tc] = await db
    .insert(taskClasses)
    .values({ name: `${opts.tName} ${stamp}`, level: 1 })
    .returning()

  await db.execute(sql`
    INSERT INTO predictions(
      id, status, source_kind, source_id, vehicle_class_id, task_class_id,
      region_id, region_version, window_date, window_half, k_days,
      cadence_minutes, confidence_now, expires_at
    )
    VALUES(
      ${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${crypto.randomUUID()}::uuid,
      ${vc!.id}::uuid, ${tc!.id}::uuid, ${regionId}::uuid, 1,
      '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day'
    )
  `)

  // news_items: source_kind is the uppercase enum (newsSourceKindEnum);
  // matched_regions is jsonb (Task 7 教训); content_hash is NOT NULL.
  await db.execute(sql`
    INSERT INTO news_items(
      id, url, title, summary_zh, raw_snippet, source_label, source_kind,
      content_hash, fetched_at, matched_regions
    )
    VALUES(
      ${newsId}::uuid,
      ${`https://triage.test/${stamp}/${crypto.randomUUID()}`},
      ${opts.newsTitle},
      ${opts.newsSummary},
      ${opts.newsSummary},
      'triage.test',
      'MAINSTREAM',
      ${`hash-${stamp}`},
      NOW(),
      to_jsonb(ARRAY[${regionId}]::uuid[])
    )
  `)

  return { predictionId: predId, newsId }
}

describe('processNewsTriageJob (REAL LLM dashscope deepseek-v4-flash)', () => {
  test(
    'high-relevance news → MED+ evidence; HIGH also enqueues refresh-INCR',
    async () => {
      const ctx = await createTestDb()
      try {
        const seeded = await seedTriageFixture(ctx.db, {
          newsTitle: '广州市公安局组织大规模专项整治治安巡逻行动',
          newsSummary:
            '广州市越秀区公安局昨日启动为期一周的专项整治行动,组织治安巡逻警车 50 辆、警员 200 名,加强夜间巡逻力度。',
          vName: '治安巡逻警车',
          tName: '治安巡逻',
          regionName: '越秀区',
        })

        const refreshCalls: Array<{
          name: string
          data: { predictionId: string; kind: 'INCR'; newEvidenceNewsIds: string[] }
        }> = []
        const refreshQ: RefreshQueueLike = {
          add: async (name, data) => {
            refreshCalls.push({ name, data })
            return undefined
          },
        }

        const result = await processNewsTriageJob(ctx.db, seeded, refreshQ)

        // LLM may legitimately call this HIGH or MED (both are "MED+"
        // information-bearing); we reject LOW as miscalibration on a news
        // that explicitly names the V/T/region.
        expect(['MED', 'HIGH']).toContain(result.weight)
        expect(result.relevant).toBe(true)
        expect(result.evidenceWritten).toBe(true)

        const ev = (await ctx.db.execute(sql`
          SELECT weight, cited FROM news_evidence
          WHERE prediction_id = ${seeded.predictionId}::uuid
            AND news_id = ${seeded.newsId}::uuid
        `)) as unknown as Array<{ weight: string; cited: boolean }>
        expect(ev.length).toBe(1)
        expect(ev[0]!.weight).toBe(result.weight)
        expect(ev[0]!.cited).toBe(true)

        if (result.weight === 'HIGH') {
          expect(result.refreshEnqueued).toBe(true)
          expect(refreshCalls.length).toBe(1)
          expect(refreshCalls[0]!.data.kind).toBe('INCR')
          expect(refreshCalls[0]!.data.predictionId).toBe(seeded.predictionId)
          expect(refreshCalls[0]!.data.newEvidenceNewsIds).toEqual([seeded.newsId])
        } else {
          expect(result.refreshEnqueued).toBe(false)
          expect(refreshCalls.length).toBe(0)
        }
      } finally {
        await ctx.cleanup()
      }
    },
    30000,
  )

  test(
    'low-relevance news → no MED+ evidence, no refresh',
    async () => {
      const ctx = await createTestDb()
      try {
        const seeded = await seedTriageFixture(ctx.db, {
          newsTitle: '今日股市收盘:沪深 300 上涨 0.5%',
          newsSummary: '今日 A 股市场表现平稳,沪深 300 指数小幅收涨,成交量较前日略有放大。',
          vName: '巡逻警车',
          tName: '治安巡逻',
          regionName: '广州',
        })

        const refreshCalls: unknown[] = []
        const refreshQ: RefreshQueueLike = {
          add: async (name, data) => {
            refreshCalls.push({ name, data })
            return undefined
          },
        }

        const result = await processNewsTriageJob(ctx.db, seeded, refreshQ)

        // Off-topic stock news must NOT be relevant-HIGH or relevant-MED.
        expect(result.relevant === false || result.weight === 'LOW').toBe(true)
        expect(result.evidenceWritten).toBe(false)
        expect(result.refreshEnqueued).toBe(false)
        expect(refreshCalls.length).toBe(0)
      } finally {
        await ctx.cleanup()
      }
    },
    30000,
  )

  test('LLM error propagates so BullMQ can retry', async () => {
    const ctx = await createTestDb()
    try {
      const seeded = await seedTriageFixture(ctx.db, {
        newsTitle: 'x',
        newsSummary: 'x',
        vName: 'x',
        tName: 'x',
        regionName: 'x',
      })

      const refreshQ: RefreshQueueLike = { add: async () => undefined }
      const failingInfer = (async () => {
        throw new Error('synthetic LLM failure')
      }) as unknown as Parameters<typeof processNewsTriageJob>[3]

      await expect(
        processNewsTriageJob(ctx.db, seeded, refreshQ, failingInfer),
      ).rejects.toThrow(/synthetic LLM/)
    } finally {
      await ctx.cleanup()
    }
  })
})
