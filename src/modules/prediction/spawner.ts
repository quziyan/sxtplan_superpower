import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { predictions } from '@/db/schema/prediction'
import { watchLists } from '@/db/schema/watchlist'

/**
 * 预测生产 — 把 active watchlist 在未来 N 天内的每个时段(AM/PM)都
 * 确保有一行 PROPOSED prediction。幂等。
 *
 * 触发路径:
 *   - 自动:scheduler/workers/prediction-spawn 每日 tick
 *   - 手动:POST /predictions/spawn-from-watchlist/:id 或 /spawn-from-all
 *           前端 AnalystView「📡 生成预测」按钮
 *
 * 幂等键:(source_id, source_kind='WATCHLIST', window_date, window_half)
 *        — 已经存在就 skip,不重建。
 */

export type SpawnOpts = {
  /** 覆盖未来多少天(含今天,默认 7,最大被 wl.kRangeMax 截断)*/
  coverageDays?: number
  /** 仅 AM 还是 AM+PM(默认 AM+PM)*/
  halves?: ReadonlyArray<'AM' | 'PM'>
}

export type SpawnResult = {
  watchlistId: string
  watchlistName: string
  spawned: number
  skipped: number
}

const DEFAULT_HALVES: ReadonlyArray<'AM' | 'PM'> = ['AM', 'PM']
const DEFAULT_COVERAGE_DAYS = 7

/**
 * 对单个 watchlist 确保覆盖 — INSERT 不存在的 (windowDate, half) 组合,
 * 跳过已有的。返回新增数 + 跳过数。
 */
export async function ensureCoverageForWatchlist(
  db: Db,
  watchlistId: string,
  opts: SpawnOpts = {},
): Promise<SpawnResult> {
  const [wl] = await db.select().from(watchLists).where(eq(watchLists.id, watchlistId))
  if (!wl) throw new Error(`watchlist ${watchlistId} not found`)
  if (!wl.isActive) {
    return { watchlistId: wl.id, watchlistName: wl.name, spawned: 0, skipped: 0 }
  }

  const coverageDays = Math.min(opts.coverageDays ?? DEFAULT_COVERAGE_DAYS, wl.kRangeMax)
  const halves = opts.halves ?? DEFAULT_HALVES

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  let spawned = 0
  let skipped = 0

  for (let dayOffset = 0; dayOffset < coverageDays; dayOffset++) {
    const wd = new Date(today.getTime() + dayOffset * 86_400_000)
    for (const half of halves) {
      // 幂等检查:同一 watchlist 同一 (windowDate, half) 不重建
      const existing = await db.select({ id: predictions.id }).from(predictions).where(
        and(
          eq(predictions.sourceKind, 'WATCHLIST'),
          eq(predictions.sourceId, wl.id),
          eq(predictions.windowDate, wd),
          eq(predictions.windowHalf, half),
        ),
      ).limit(1)
      if (existing.length > 0) {
        skipped++
        continue
      }
      // expiresAt = window_date + 10 天(给审批 + dispatch + 复盘留缓冲)
      const expires = new Date(wd.getTime() + 10 * 86_400_000)
      const kDays = Math.max(1, dayOffset)
      await db.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: wl.id,
        regionId: wl.regionId, regionVersion: wl.regionVersion,
        windowDate: wd, windowHalf: half,
        vehicleClassId: wl.vehicleClassId, taskClassId: wl.taskClassId,
        kDays,
        confidenceNow: 0,  // 真 LLM 由后续 cadence/triage 算
        cadenceMinutes: 1440,
        expiresAt: expires,
      })
      spawned++
    }
  }

  return { watchlistId: wl.id, watchlistName: wl.name, spawned, skipped }
}

/**
 * 扫所有 active watchlist,逐个确保覆盖。返回每个 watchlist 的结果。
 */
export async function ensureCoverageForAll(db: Db, opts: SpawnOpts = {}): Promise<SpawnResult[]> {
  const active = await db.select({ id: watchLists.id }).from(watchLists)
    .where(eq(watchLists.isActive, true))
  const results: SpawnResult[] = []
  for (const wl of active) {
    try {
      const r = await ensureCoverageForWatchlist(db, wl.id, opts)
      results.push(r)
    } catch (err) {
      console.error(`[spawner] watchlist ${wl.id} failed:`, err)
      results.push({ watchlistId: wl.id, watchlistName: '(error)', spawned: 0, skipped: 0 })
    }
  }
  return results
}

/**
 * 汇总所有 watchlist 结果为单个数字对(用于路由响应 + UI 弹窗)。
 */
export function totalize(results: SpawnResult[]): { totalSpawned: number; totalSkipped: number; watchlistsProcessed: number } {
  let s = 0, sk = 0
  for (const r of results) { s += r.spawned; sk += r.skipped }
  return { totalSpawned: s, totalSkipped: sk, watchlistsProcessed: results.length }
}
