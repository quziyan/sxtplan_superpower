import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { computeDriftSinceLastFull } from './drift-detector'

export type FullTriggerThresholds = {
  /** P1: 自上次 FULL 以来的 INCR 次数 */
  incrCountSinceFull: number
  /** P2: 自上次 FULL 以来的天数 */
  daysSinceFull: number
  /** P3: 自上次 FULL 以来累计新增证据条数 */
  newEvidenceSinceFull: number
  /** P4: 漂移阈值 (percentage points) */
  driftPp: number
}

export const DEFAULT_THRESHOLDS: FullTriggerThresholds = {
  incrCountSinceFull: 5,
  daysSinceFull: 7,
  newEvidenceSinceFull: 10,
  driftPp: 25,
}

export type TriggerReason = {
  triggered: boolean
  priority?: 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
  reason: string
}

/**
 * Evaluate whether agent_full should be triggered for this prediction.
 * P1 highest priority; P5 (manual) handled outside this function.
 */
export async function shouldTriggerFull(
  db: Db,
  predictionId: string,
  opts: { thresholds?: Partial<FullTriggerThresholds>; manualTrigger?: boolean } = {},
): Promise<TriggerReason> {
  if (opts.manualTrigger) {
    return { triggered: true, priority: 'P5', reason: '分析师手动触发立即重算' }
  }

  const t: FullTriggerThresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds }

  // Stats since last FULL
  const statsRows = await db.execute<{
    incr_count: number
    last_full_at: Date | null
    days_since_full: number | null
    new_evidence_count: number
  }>(sql`
    WITH last_full AS (
      SELECT MAX(occurred_at) AS ts
      FROM confidence_snapshots
      WHERE prediction_id = ${predictionId}::uuid AND kind = 'FULL'
    )
    SELECT
      (SELECT COUNT(*)::int FROM confidence_snapshots cs
        WHERE cs.prediction_id = ${predictionId}::uuid
          AND cs.kind = 'INCR'
          AND cs.occurred_at > COALESCE((SELECT ts FROM last_full), 'epoch')) AS incr_count,
      (SELECT ts FROM last_full) AS last_full_at,
      (SELECT EXTRACT(DAY FROM NOW() - ts)::int FROM last_full WHERE ts IS NOT NULL) AS days_since_full,
      (SELECT COUNT(*)::int FROM news_evidence ne
        WHERE ne.prediction_id = ${predictionId}::uuid
          AND ne.added_at > COALESCE((SELECT ts FROM last_full), 'epoch')) AS new_evidence_count
  `)
  const s = (statsRows[0] as {
    incr_count: number; last_full_at: Date | null;
    days_since_full: number | null; new_evidence_count: number
  })

  // P1: incr count
  if (s.incr_count >= t.incrCountSinceFull) {
    return { triggered: true, priority: 'P1', reason: `已累计 ${s.incr_count} 次 INCR(阈值 ${t.incrCountSinceFull})` }
  }
  // P2: days since
  if (s.days_since_full !== null && s.days_since_full >= t.daysSinceFull) {
    return { triggered: true, priority: 'P2', reason: `距上次 FULL 已 ${s.days_since_full} 天(阈值 ${t.daysSinceFull})` }
  }
  // P3: new evidence
  if (s.new_evidence_count >= t.newEvidenceSinceFull) {
    return { triggered: true, priority: 'P3', reason: `累计新增证据 ${s.new_evidence_count} 条(阈值 ${t.newEvidenceSinceFull})` }
  }
  // P4: drift
  const drift = await computeDriftSinceLastFull(db, predictionId)
  if (Math.abs(drift) > t.driftPp) {
    return { triggered: true, priority: 'P4', reason: `漂移 |Δ|=${Math.abs(drift)}pp(阈值 ${t.driftPp})` }
  }
  return { triggered: false, reason: '所有触发条件未达阈值' }
}
