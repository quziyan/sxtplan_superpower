import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { writeConfidenceSnapshot } from '@/modules/prediction/confidence'
import { processRetrospectiveJob } from '@/scheduler/workers/retrospective'
import { BadRequest, NotFound } from '@/lib/errors'

/**
 * Plan-C T37 / Slice 0 customer demo helpers.
 *
 * These routes are gated by `NODE_ENV !== 'production'` at the
 * `server.ts` mount site — they exist so the customer-facing demo
 * runbook (`docs/demo/slice-0-runbook.md`) can drive the full closed
 * loop in ~30 minutes without waiting on cadence ticks (60s) or the
 * retrospective retention window (7 days).
 *
 * Two helpers:
 *
 * 1. `POST /__demo/seed-prediction`
 *    Body: `{ watchListId }`. Creates a fully-formed PROPOSED prediction
 *    bound to that watchlist's (V, T, R) tuple, with confidence 78 and a
 *    written confidence_snapshot — so the InboxCard renders meaningful
 *    reasoning text the moment the demo person switches to the Decision
 *    role. Without this, predictions can only be created by the m4
 *    PredictionAgent + cadence pipeline (still partly stubbed) or by
 *    direct SQL — neither acceptable for a customer demo.
 *    Returns: `{ predictionId }`.
 *
 * 2. `POST /__demo/run-retro`
 *    Body: `{ predictionId }`. Bypasses the retrospective tick's
 *    `window_date + 7 days` retention gate and synchronously runs the
 *    real `processRetrospectiveJob` (same code path the BullMQ
 *    retrospective worker would run). Requires the prediction to be
 *    settled (status COMPLETED / EXPIRED — the agent throws otherwise).
 *    Returns the retrospective summary the worker would have produced.
 *
 * Auth: both routes require login (so no anonymous DB writes via these
 * paths). Production deployments never mount the module.
 */

const seedPredictionSchema = z.object({
  watchListId: z.string().uuid(),
})

const runRetroSchema = z.object({
  predictionId: z.string().uuid(),
})

type Vars = { auth: AuthContext }

/**
 * Build the demo helpers sub-app. Mounted by `server.ts` only when
 * `NODE_ENV !== 'production'`.
 */
export function demoRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  // Seed a PROPOSED prediction off an existing watchlist + write a
  // confidence snapshot so the Decision view's InboxCard has reasoning.
  app.post(
    '/seed-prediction',
    authRequired(db),
    zValidator('json', seedPredictionSchema),
    async (c) => {
      const { watchListId } = c.req.valid('json')

      // Pull the watchlist's V/T/R tuple. Single round trip; fail fast
      // with 404 if the caller passed a stale id.
      const wlRows = await db.execute<{
        id: string
        vehicle_class_id: string
        task_class_id: string
        region_id: string
        region_version: number
        k_range_min: number
        k_range_max: number
      }>(sql`
        SELECT id, vehicle_class_id, task_class_id,
               region_id, region_version,
               k_range_min, k_range_max
        FROM watch_lists
        WHERE id = ${watchListId}::uuid
        LIMIT 1
      `)
      const wl = wlRows[0]
      if (!wl) throw NotFound(`watchlist ${watchListId} not found`)

      // Pick a window 3 days out, AM half. k_days set to the watchlist's
      // kRangeMin so retrospective retention math (window_date + 7) lines
      // up with the customer-facing demo expectation that retro must be
      // triggered manually via /__demo/run-retro.
      const kDays = Math.max(1, wl.k_range_min)

      const predRows = await db.execute<{ id: string }>(sql`
        INSERT INTO predictions
          (source_kind, source_id,
           region_id, region_version,
           window_date, window_half,
           vehicle_class_id, task_class_id,
           k_days, expires_at)
        VALUES
          ('WATCHLIST', ${watchListId}::uuid,
           ${wl.region_id}::uuid, ${wl.region_version},
           (CURRENT_DATE + INTERVAL '3 days')::date, 'AM',
           ${wl.vehicle_class_id}::uuid, ${wl.task_class_id}::uuid,
           ${kDays}, NOW() + INTERVAL '10 days')
        RETURNING id
      `)
      const predictionId = predRows[0]?.id
      if (!predictionId) throw new Error('failed to insert demo prediction')

      // Write a FULL snapshot — sets confidence_now=78 + reasoning so the
      // Decision-role InboxCard immediately shows something other than 0.
      await writeConfidenceSnapshot(db, {
        predictionId,
        kind: 'FULL',
        confidence: 78,
        ciLow: 71,
        ciHigh: 84,
        reasoning:
          '[demo seed] 基于该 (V, T, R) 在 K=' +
          String(kDays) +
          ' 天窗口的历史命中分布与当前案例库样本,综合判断该窗口下调度概率较高(置信区间 71-84)。',
        operator: 'DemoSeed',
      })

      return c.json({ ok: true, predictionId }, 201)
    },
  )

  // Bypass the retrospective tick's 7-day retention and run the
  // retrospective synchronously. Surfaces the same shape the BullMQ
  // worker writes back via job.return.
  app.post(
    '/run-retro',
    authRequired(db),
    zValidator('json', runRetroSchema),
    async (c) => {
      const { predictionId } = c.req.valid('json')

      // Validate prediction state BEFORE invoking the agent. The agent
      // calls the LLM unconditionally — running it on a PROPOSED row would
      // either burn an inference round trip on nonsense data or, in tests
      // without a reachable LLM, hang past the bun test timeout. Cheap
      // single-row lookup here keeps the demo helper deterministic.
      //   - Not found            → 400 (matches existing test contract:
      //                            "run-retro on unknown prediction returns
      //                            400" — the agent's own throw was
      //                            previously the source of this 400, this
      //                            fast-path preserves the same surface).
      //   - Status not settled   → 400 with "prediction not in settled status"
      //                            (clean DevTools error for the demo person
      //                            instead of waiting on the LLM round trip).
      const rows = await db.execute<{ status: string }>(sql`
        SELECT status FROM predictions
        WHERE id = ${predictionId}::uuid
        LIMIT 1
      `)
      const pred = rows[0]
      if (!pred) throw BadRequest(`prediction ${predictionId} not found`)
      if (pred.status !== 'COMPLETED' && pred.status !== 'EXPIRED') {
        throw BadRequest('prediction not in settled status')
      }

      try {
        const out = await processRetrospectiveJob(db, { predictionId })
        return c.json({ ok: true, ...out })
      } catch (e) {
        // Predictable downstream failures (region/V/T missing, agent parse
        // error) → 400 so the demo person sees a clean error in DevTools
        // rather than a 500.
        throw BadRequest((e as Error).message)
      }
    },
  )

  return app
}
