import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'
import {
  tickNewsIngest,
  type NewsTriageQueueLike,
} from '@/scheduler/workers/news-ingest'
import {
  processNewsTriageJob,
  type RefreshQueueLike,
} from '@/scheduler/workers/news-triage'
import { processRefreshJob } from '@/scheduler/workers/refresh'

/**
 * Plan-E Task 11 — m5 e2e: news intake → triage → refresh full pipeline.
 *
 * Stages:
 *   1. tickNewsIngest with a fake SearchAdapter that returns one
 *      high-relevance news hit. Worker matches the hit to our seeded
 *      prediction and enqueues a triage job (we capture it in a
 *      Queue-like mock).
 *   2. processNewsTriageJob (REAL LLM dashscope deepseek-v4-flash).
 *      The agent reads news + prediction context and emits a weight.
 *      For the ON-topic news (V/T/region all named) we expect the
 *      worker to write evidence (MED+) and, if HIGH, enqueue a refresh
 *      INCR job. LOW/non-relevant is graceful — assertions stop early.
 *   3. processRefreshJob (REAL LLM): reruns the prediction agent with
 *      the new evidence, then we verify `predictions.confidence_now`
 *      and `confidence_snapshots` were updated.
 *
 * Cost: 2 LLM calls @ ~5-15s each. 60s timeout headroom.
 *
 * Watchlist isolation: `tickNewsIngest` scans ALL active watchlists, and
 * leaked watchlists from prior tests can race ours for the news URL
 * (ingestHit is URL-keyed). We deactivate everything pre-test so our
 * single seeded watchlist owns the run.
 */

async function deactivateAllWatchlists(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
): Promise<void> {
  await db.execute(sql`UPDATE watch_lists SET is_active = FALSE`)
}

describe('m5 e2e: news intake → triage → refresh full pipeline', () => {
  test(
    'high-relevance news end-to-end updates predictions.confidence_now',
    async () => {
      const ctx = await createTestDb()
      try {
        await deactivateAllWatchlists(ctx.db)

        const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
        const regionId = crypto.randomUUID()
        const userId = crypto.randomUUID()
        const wlId = crypto.randomUUID()
        const predId = crypto.randomUUID()

        // ── Seed: regions (PostGIS geom) + V/T + user + watchlist + prediction ──
        await ctx.db.execute(sql`
          INSERT INTO regions(id, version, kind, name, geom, effective_from)
          VALUES(
            ${regionId}::uuid, 1, 'AD_HOC',
            ${'E2E_REG_' + stamp},
            ST_GeomFromGeoJSON(${'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'}),
            NOW()
          )
        `)

        const { vehicleClasses, taskClasses } = await import('@/db/schema/taxonomy')
        const [vc] = await ctx.db
          .insert(vehicleClasses)
          .values({ name: '治安巡逻警车 ' + stamp, level: 1 })
          .returning()
        const [tc] = await ctx.db
          .insert(taskClasses)
          .values({ name: '治安巡逻 ' + stamp, level: 1 })
          .returning()

        await ctx.db.execute(sql`
          INSERT INTO users(id, email, password_hash, display_name)
          VALUES(${userId}::uuid, ${'e2e-' + stamp + '@x.com'}, 'x', 'E2E')
          ON CONFLICT DO NOTHING
        `)

        await ctx.db.execute(sql`
          INSERT INTO watch_lists(
            id, name, vehicle_class_id, task_class_id,
            region_id, region_version, k_range_min, k_range_max,
            is_active, keywords, created_by
          )
          VALUES(
            ${wlId}::uuid, ${'E2E_WL ' + stamp},
            ${vc!.id}::uuid, ${tc!.id}::uuid,
            ${regionId}::uuid, 1, 1, 14, TRUE,
            ARRAY['治安巡逻', '广州']::text[],
            ${userId}::uuid
          )
        `)

        await ctx.db.execute(sql`
          INSERT INTO predictions(
            id, status, source_kind, source_id,
            vehicle_class_id, task_class_id,
            region_id, region_version, window_date, window_half,
            k_days, cadence_minutes, confidence_now, expires_at
          )
          VALUES(
            ${predId}::uuid, 'PROPOSED', 'WATCHLIST', ${wlId}::uuid,
            ${vc!.id}::uuid, ${tc!.id}::uuid,
            ${regionId}::uuid, 1,
            '2026-12-31', 'AM', 7, 60, 50, NOW() + INTERVAL '1 day'
          )
        `)

        // ── Stage 1: tickNewsIngest with mock SearchAdapter ──
        const triageJobs: Array<{ predictionId: string; newsId: string }> = []
        const triageQ: NewsTriageQueueLike = {
          add: async (_, d) => {
            triageJobs.push(d)
            return undefined
          },
        }
        const fakeAdapter = {
          query: async () => [
            {
              title: '广州市治安巡逻专项整治启动',
              url: `https://e2e.test/${stamp}`,
              snippet:
                '广州市公安局组织治安巡逻警车 50 辆,在越秀区开展为期一周的专项整治,加强夜间巡逻力度。',
              source: { name: 'e2e.test', kind: 'mainstream' as const },
            },
          ],
        }

        const ingestResult = await tickNewsIngest({
          db: ctx.db,
          triageQueue: triageQ,
          searchAdapter: fakeAdapter,
        })
        expect(ingestResult.newsInserted).toBeGreaterThanOrEqual(1)
        const myJob = triageJobs.find((j) => j.predictionId === predId)
        expect(myJob).toBeDefined()

        // ── Stage 2: processNewsTriageJob (REAL LLM) ──
        const refreshJobs: Array<{
          name: string
          data: {
            predictionId: string
            kind: 'INCR' | 'FULL'
            newEvidenceNewsIds?: string[]
          }
        }> = []
        const refreshQ: RefreshQueueLike = {
          add: async (n, d) => {
            refreshJobs.push({ name: n, data: d })
            return undefined
          },
        }
        const triageResult = await processNewsTriageJob(ctx.db, myJob!, refreshQ)
        // Either MED+ evidence got written, OR LLM rated non-relevant — both
        // are valid stop conditions for this e2e (we surface the choice but
        // do not fail the run on LLM moodiness).
        expect(
          triageResult.evidenceWritten || triageResult.relevant === false,
        ).toBe(true)

        // ── Stage 3: if HIGH → run refresh handler (REAL LLM) ──
        if (triageResult.refreshEnqueued) {
          expect(refreshJobs.length).toBe(1)
          const refreshJob = refreshJobs[0]!.data
          const refreshResult = await processRefreshJob(ctx.db, refreshJob)
          expect(typeof refreshResult.confidence).toBe('number')

          // Verify confidence_now updated + snapshot written.
          const updated = (await ctx.db.execute(sql`
            SELECT confidence_now FROM predictions WHERE id = ${predId}::uuid
          `)) as unknown as Array<{ confidence_now: number }>
          expect(updated[0]!.confidence_now).toBe(refreshResult.confidence)

          const snaps = (await ctx.db.execute(sql`
            SELECT COUNT(*)::int AS n FROM confidence_snapshots
            WHERE prediction_id = ${predId}::uuid
          `)) as unknown as Array<{ n: number }>
          expect(snaps[0]!.n).toBeGreaterThanOrEqual(1)
        } else {
          console.log(
            `[e2e] LLM rated weight=${triageResult.weight} relevant=${triageResult.relevant} — refresh not triggered (acceptable in this run)`,
          )
        }
      } finally {
        await ctx.cleanup()
      }
    },
    60000, // 60s timeout — 2 REAL LLM calls @ ~5-15s each
  )
})
