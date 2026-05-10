/**
 * 预测生产 tick — 每日扫一次所有 active watchlist,确保覆盖未来 N 天的
 * (windowDate, AM/PM) 组合。详见 src/modules/prediction/spawner.ts。
 *
 * 不进 BullMQ 队列(无需重试 / 跨进程),纯 setInterval 起单例。
 */
import { createDb } from '@/db/client'
import { ensureCoverageForAll, totalize } from '@/modules/prediction/spawner'

const DEFAULT_TICK_HOURS = 24
const DEFAULT_COVERAGE_DAYS = 7

export type SpawnTickDeps = {
  db?: ReturnType<typeof createDb>['db']
  /** 覆盖未来多少天(默认 7)*/
  coverageDays?: number
}

export async function tickPredictionSpawn(deps: SpawnTickDeps = {}): Promise<void> {
  const { db } = deps.db ? { db: deps.db } : createDb('app')
  const coverageDays = deps.coverageDays ?? DEFAULT_COVERAGE_DAYS
  try {
    const results = await ensureCoverageForAll(db, { coverageDays })
    const t = totalize(results)
    console.log(
      `[prediction-spawn] tick done — watchlists=${t.watchlistsProcessed} ` +
      `spawned=${t.totalSpawned} skipped=${t.totalSkipped}`,
    )
  } catch (err) {
    console.error('[prediction-spawn] tick failed:', err)
  }
}

/**
 * 启动 spawn tick — 默认每 24h 跑一次。在 startWorkers() 里 push 到 intervals。
 */
export function schedulePredictionSpawnTick(intervalHours = DEFAULT_TICK_HOURS): ReturnType<typeof setInterval> {
  // 启动时立刻跑一次,然后按 intervalHours 周期性跑
  void tickPredictionSpawn()
  return setInterval(() => { void tickPredictionSpawn() }, intervalHours * 3600_000)
}
