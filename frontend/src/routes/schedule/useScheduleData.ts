import { useEffect, useState } from 'react'
import { listPredictions, type PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, monthGridRange } from './dateUtils'

export type ScheduleData = {
  predictions: PredictionListItem[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * 三视图共用一次拉取 — anchor 决定取数窗口(月视图 grid 6×7 一定覆盖周/日所需)。
 * 子视图切换只是切渲染,不再 fetch。月切换触发新一轮拉取。
 *
 * mutationVersion 用作外部信号:当详情页 mutate 后,App.tsx bump 这个值,
 * useEffect 依赖触发 refresh,新 snapshot 立刻反映到日历。
 */
export function useScheduleData(anchor: Date, mutationVersion: number): ScheduleData {
  const [predictions, setPredictions] = useState<PredictionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // 锚月份变化时重新拉取;子 tab(月/周/日)切换不变 anchor → 不触发 fetch。
  const anchorMonthKey = `${anchor.getFullYear()}-${anchor.getMonth()}`

  useEffect(() => {
    const { start, end } = monthGridRange(anchor)
    let cancelled = false
    setLoading(true); setError(null)
    listPredictions({
      from: formatYmd(start),
      to: formatYmd(end),
      limit: 500,
      includeLatestSnapshot: true,
    })
      .then((rows) => { if (!cancelled) setPredictions(rows) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [anchorMonthKey, mutationVersion, reloadKey])

  return {
    predictions,
    loading,
    error,
    refresh: () => setReloadKey((k) => k + 1),
  }
}
