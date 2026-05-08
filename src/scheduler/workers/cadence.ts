import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import type { Db } from '@/db/client'
import { fullRecalcQueue } from '../queue'

/**
 * Cadence tick worker — m5 重定义(Plan-E G1).
 *
 * **m5 行为变更:** cadence 不再直接 enqueue INCR refresh 任务(那要 newEvidenceNewsIds),
 * 改为 enqueue 到 `fullRecalcQueue` 让 `shouldTriggerFull` 的 P1-P5 trigger 决定:
 *  - 如果 P1(INCR 累积)/ P2(days)/ P3(new evidence)/ P4(drift)任一触发 → 走 FULL
 *  - 否则 skip(廉价)
 *
 * INCR 是事件驱动的(news triage HIGH score 触发,m5 G3),不再节奏驱动。
 */

export type CadenceQueueLike = {
  add: (name: string, data: { predictionId: string }) => Promise<unknown>
}

export type CadenceDeps = {
  db: Db
  queue: CadenceQueueLike
  limit?: number
}

export async function tickCadence(deps: CadenceDeps): Promise<number> {
  const limit = deps.limit ?? 100
  const due = await deps.db.execute<{ id: string }>(sql`
    SELECT id FROM predictions
    WHERE status = 'PROPOSED'
      AND expires_at > NOW()
      AND (last_incr_at IS NULL
           OR last_incr_at + (cadence_minutes * INTERVAL '1 minute') < NOW())
    LIMIT ${limit}
  `)
  const rows = due as Array<{ id: string }>
  let n = 0
  for (const row of rows) {
    await deps.queue.add('full-recalc', { predictionId: row.id })
    n++
  }
  return n
}

export function defaultCadenceDeps(): CadenceDeps {
  const { db } = createDb('admin')
  return { db, queue: fullRecalcQueue }
}

export function scheduleCadenceTick(
  deps: CadenceDeps = defaultCadenceDeps(),
  intervalMs = 60_000,
): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    tickCadence(deps).catch((err) => { console.error('[cadence-tick] failed:', err) })
  }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
