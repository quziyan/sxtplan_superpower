import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { createDb } from '@/db/client'

/**
 * Prediction lifecycle tick — 闭合 view-data-contract 的 X2 不变量(7 status 全闭环)。
 *
 * 一次 tick 跑两个独立 UPDATE:
 *
 * 1. **settle**:DISPATCHED 且对应 dispatch_task.state 已是终态(COMPLETED 或失败族),
 *    把 prediction.status 翻为 COMPLETED(若 dispatch COMPLETED)或 EXPIRED(其他终态)。
 *
 * 2. **expire**:任何 {PROPOSED, VALIDATED, APPROVED, DISPATCHED} 且 expires_at < NOW(),
 *    翻为 EXPIRED。给"过期未审 / 派单丢失"兜底。
 *
 * 设计:幂等 + 批量 SQL,无 race 风险(每条 prediction 只能匹配一个 WHEN 分支);
 *      worker 失败可重试,因 UPDATE 谓词在第二次 tick 时已不命中。
 */

export type LifecycleTickResult = {
  settledCompleted: number
  settledExpired: number
  expired: number
}

export async function tickLifecycle(db: Db): Promise<LifecycleTickResult> {
  // 1. DISPATCHED → COMPLETED:dispatch_task 任意一条进 COMPLETED 即结案。
  const settledCompletedRows = await db.execute<{ id: string }>(sql`
    UPDATE predictions p SET status = 'COMPLETED', updated_at = NOW()
    WHERE p.status = 'DISPATCHED'
      AND EXISTS (
        SELECT 1 FROM dispatch_tasks dt
        WHERE dt.prediction_id = p.id AND dt.state = 'COMPLETED'
      )
    RETURNING p.id
  `)
  const settledCompleted = (settledCompletedRows as Array<{ id: string }>).length

  // 2. DISPATCHED → EXPIRED:所有 dispatch_task 都进失败终态(FAILED/CANCELLED/
  //    REJECTED_BY_ADAPTER/TIMED_OUT),且没有 COMPLETED 的。
  const settledExpiredRows = await db.execute<{ id: string }>(sql`
    UPDATE predictions p SET status = 'EXPIRED', updated_at = NOW()
    WHERE p.status = 'DISPATCHED'
      AND EXISTS (SELECT 1 FROM dispatch_tasks dt WHERE dt.prediction_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM dispatch_tasks dt
        WHERE dt.prediction_id = p.id
          AND dt.state NOT IN ('FAILED', 'CANCELLED', 'REJECTED_BY_ADAPTER', 'TIMED_OUT')
      )
    RETURNING p.id
  `)
  const settledExpired = (settledExpiredRows as Array<{ id: string }>).length

  // 3. {PROPOSED,VALIDATED,APPROVED,DISPATCHED} + expires_at < NOW() → EXPIRED。
  //    DISPATCHED 兜底:派单丢失(无 dispatch_task 或 worker 卡住)的也算过期。
  const expiredRows = await db.execute<{ id: string }>(sql`
    UPDATE predictions SET status = 'EXPIRED', updated_at = NOW()
    WHERE status IN ('PROPOSED', 'VALIDATED', 'APPROVED', 'DISPATCHED')
      AND expires_at < NOW()
    RETURNING id
  `)
  const expired = (expiredRows as Array<{ id: string }>).length

  return { settledCompleted, settledExpired, expired }
}

/**
 * Cron-style 调度。每 N ms 跑一次 tick。返回 timer handle 供 graceful shutdown。
 * Default 间隔 5 分钟 — 与 retrospective tick 一致,这样 settle → retrospective 链路
 * 顺序触发。
 */
export function scheduleLifecycleTick(
  db?: Db,
  intervalMs = 5 * 60_000,
): ReturnType<typeof setInterval> {
  const handle = db ?? createDb('admin').db
  const t = setInterval(() => {
    tickLifecycle(handle).catch((err) => {
      console.error('[lifecycle-tick] failed:', err)
    })
  }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
