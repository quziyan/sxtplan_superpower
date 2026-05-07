import { sql } from 'drizzle-orm'
import type { Db } from '@/db/client'

export type CaseSummary = {
  predictionId: string
  outcome: 'HIT' | 'MISS' | 'NO_DATA'
  confidence: number
  summary: string
}

export type RetrieveCasesQuery = {
  vehicleClassId: string
  taskClassId: string
  kDays: number
  topK?: number
}

/**
 * m2 simplified case retriever:
 * 找过去 V/T 同类、K_days ±3 范围内、状态为 COMPLETED 或 EXPIRED 的预测,
 * 按 window_date 降序返回 top-K (default 5)。
 *
 * 占位逻辑(m3 替换):
 *   - status='COMPLETED' → outcome='HIT' (真实 outcome 从 retrospective 拉)
 *   - status='EXPIRED'   → outcome='MISS'
 *   - 其他状态:m2 不返回
 */
export async function retrieveCases(db: Db, q: RetrieveCasesQuery): Promise<CaseSummary[]> {
  const kMin = Math.max(1, q.kDays - 3)
  const kMax = q.kDays + 3
  const limit = q.topK ?? 5

  const rows = await db.execute<{
    id: string
    status: 'COMPLETED' | 'EXPIRED'
    confidence_now: number
    window_date: string
    window_half: 'AM' | 'PM'
  }>(sql`
    SELECT id, status, confidence_now, window_date::text, window_half
    FROM predictions
    WHERE vehicle_class_id = ${q.vehicleClassId}::uuid
      AND task_class_id = ${q.taskClassId}::uuid
      AND k_days BETWEEN ${kMin} AND ${kMax}
      AND status IN ('COMPLETED', 'EXPIRED')
    ORDER BY window_date DESC
    LIMIT ${limit}
  `)

  return (rows as Array<{
    id: string
    status: 'COMPLETED' | 'EXPIRED'
    confidence_now: number
    window_date: string
    window_half: 'AM' | 'PM'
  }>).map((r) => {
    const outcome: CaseSummary['outcome'] = r.status === 'COMPLETED' ? 'HIT' : 'MISS'
    const dateStr = r.window_date.slice(0, 10)
    const halfLabel = r.window_half === 'AM' ? '上午' : '下午'
    return {
      predictionId: r.id,
      outcome,
      confidence: r.confidence_now,
      summary: `${dateStr} ${halfLabel} 预测(${r.status === 'COMPLETED' ? '完成' : '过期'},置信度 ${r.confidence_now})`,
    }
  })
}
