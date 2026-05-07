import { sql } from 'drizzle-orm'
import { logAudit } from '@/audit/log'
import { createDb, type Db } from '@/db/client'
import { requestCancel } from '@/dispatch/service'
import { loadEnv } from '@/env'
import { pushAutoCancelToInbox } from '@/inbox/auto-cancel-notification'

/**
 * Auto-cancel tick (Plan-D B1, ISC-B1.1 + ISC-B1.2).
 *
 * Scans active dispatch_tasks whose backing prediction:
 *   1. has dipped under the configured confidence threshold,
 *   2. has stayed under for at least AUTO_CANCEL_LAG_MINUTES (suppresses
 *      single-snapshot noise — `auto_cancel_below_since` is the first
 *      timestamp the row dropped below threshold; cleared when it climbs
 *      back), and
 *   3. has not been opt-out'd via `auto_cancel_disabled`.
 *
 * Each match is funnelled through `requestCancel` (m3 cancel flow), which
 * means we inherit the same state-machine validation, optimistic lock, and
 * adapter cancel side-effects as a manual cancel. We also write a structured
 * audit row (`AUTO_CANCEL_DISPATCH`) and — when notify is on — push a
 * DECIDER inbox event.
 *
 * Failures per row are caught and counted; a single bad cancel does not abort
 * the whole tick. The cadence here is 5 minutes — long enough that a transient
 * adapter blip will retry on the next tick.
 *
 * Confidence scale note: `predictions.confidence_now` is an integer 0–100,
 * but `threshold` is a 0..1 decimal (env contract). The SQL compares
 * `confidence_now < threshold * 100`.
 */

export type AutoCancelDeps = {
  db: Db
  threshold?: number
  lagMinutes?: number
  notify?: boolean
}

export type AutoCancelTickResult = {
  scanned: number
  cancelled: number
  errors: number
}

type DueRow = {
  dispatch_id: string
  prediction_id: string
  confidence: number
}

export async function tickAutoCancel(deps: AutoCancelDeps): Promise<AutoCancelTickResult> {
  const env = loadEnv()
  const threshold = deps.threshold ?? env.AUTO_CANCEL_THRESHOLD
  const lagMinutes = deps.lagMinutes ?? env.AUTO_CANCEL_LAG_MINUTES
  const notify = deps.notify ?? env.AUTO_CANCEL_NOTIFY === 'true'

  // confidence_now is an integer 0..100; threshold is a 0..1 decimal — scale up.
  const thresholdScaled = Math.round(threshold * 100)

  const due = await deps.db.execute<DueRow>(sql`
    SELECT dt.id AS dispatch_id,
           p.id AS prediction_id,
           p.confidence_now AS confidence
    FROM dispatch_tasks dt
    JOIN predictions p ON p.id = dt.prediction_id
    WHERE dt.state IN ('QUEUED', 'SENT', 'IN_PROGRESS')
      AND p.confidence_now < ${thresholdScaled}
      AND p.auto_cancel_disabled = FALSE
      AND p.auto_cancel_below_since IS NOT NULL
      AND p.auto_cancel_below_since < NOW() - (${lagMinutes}::text || ' minutes')::interval
  `)

  const rows = due as unknown as DueRow[]
  let cancelled = 0
  let errors = 0

  for (const row of rows) {
    try {
      // Confidence in the audit log is reported on the same 0..1 scale as the
      // threshold, so analysts comparing the two don't have to mentally rescale.
      const confidence01 = Number(row.confidence) / 100
      const reason = `[AUTO] confidence dropped to ${confidence01.toFixed(3)} at ${new Date().toISOString()}`
      await requestCancel(deps.db, row.dispatch_id, reason)

      // AuditEntry has no `metadataJson` slot — stash structured detail in `after`.
      // actorUserId is a uuid column; identify the system actor via actorRoleKey instead.
      await logAudit(deps.db, {
        actorRoleKey: 'SYSTEM',
        action: 'AUTO_CANCEL_DISPATCH',
        targetKind: 'dispatch',
        targetId: row.dispatch_id,
        reason,
        after: {
          predictionId: row.prediction_id,
          confidence: confidence01,
          threshold,
          lagMinutes,
        },
      })
      cancelled++

      if (notify) {
        await pushAutoCancelToInbox(deps.db, row.prediction_id, row.dispatch_id, confidence01)
      }
    } catch (e) {
      errors++
      console.error(`[auto-cancel] failed dispatch=${row.dispatch_id}: ${(e as Error).message}`)
    }
  }
  return { scanned: rows.length, cancelled, errors }
}

export function defaultAutoCancelDeps(): AutoCancelDeps {
  const { db } = createDb('admin')
  return { db }
}

/**
 * Schedule the auto-cancel tick on a recurring interval. Default cadence is
 * 5 minutes — small enough that a freshly-aged-out prediction is cancelled
 * promptly, large enough that adapter cancel storms don't pile up.
 */
export function scheduleAutoCancelTick(
  deps: AutoCancelDeps = defaultAutoCancelDeps(),
  intervalMs = 5 * 60_000,
): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    tickAutoCancel(deps).catch((err) => {
      console.error('[auto-cancel-tick] failed:', err)
    })
  }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
