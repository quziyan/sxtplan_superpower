import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'

/**
 * Compute |Σ Δ_incr| since last FULL snapshot.
 * 累加每个 INCR 与前一个 snapshot 的差,取绝对值之和。
 *
 * 例:FULL=50, INCR=55 (+5), INCR=58 (+3), INCR=60 (+2) →
 *   |+5| + |+3| + |+2| = 10
 *
 * Returns 0 if no FULL exists or no INCR after FULL.
 */
export async function computeDriftSinceLastFull(db: Db, predictionId: string): Promise<number> {
  const rows = await db.execute<{ kind: 'INCR' | 'FULL' | 'MANUAL'; confidence: number; occurred_at: Date }>(sql`
    WITH last_full AS (
      SELECT MAX(occurred_at) AS ts
      FROM confidence_snapshots
      WHERE prediction_id = ${predictionId}::uuid AND kind = 'FULL'
    )
    SELECT kind, confidence, occurred_at
    FROM confidence_snapshots
    WHERE prediction_id = ${predictionId}::uuid
      AND occurred_at >= COALESCE((SELECT ts FROM last_full), 'epoch'::timestamptz)
    ORDER BY occurred_at ASC
  `)
  const arr = rows as Array<{ kind: 'INCR' | 'FULL' | 'MANUAL'; confidence: number; occurred_at: Date }>
  if (arr.length < 2) return 0
  let sum = 0
  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1]!
    const cur = arr[i]!
    if (cur.kind === 'INCR') {
      sum += Math.abs(cur.confidence - prev.confidence)
    }
    // MANUAL 不计入漂移(人工干预);FULL 重置不算
  }
  return sum
}
