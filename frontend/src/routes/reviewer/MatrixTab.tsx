import { useEffect, useMemo, useState } from 'react'
import { KpiRow, OutcomeMatrix, type KpiTile } from '@/components'
import type { CellKey, OutcomeCounts } from '@/components/OutcomeMatrix'
import { aggregateRetrospectives, type RetroAggregateResult } from '@/lib/retrospective-api'

// Plan-C T30 / ISC-38 — Matrix tab.
// Plan-D Task 5 / ISC-C5: switched from client-side aggregation
// (listRetrospectives + JS group-by, capped at 500 rows) to a single
// server aggregate call. The backend executes one SQL GROUP BY and
// returns the 3×4 outcome matrix + KPI rates already rolled up.

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

export function MatrixTab() {
  const [agg, setAgg] = useState<RetroAggregateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    aggregateRetrospectives()
      .then(result => { if (!cancelled) setAgg(result) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts: OutcomeCounts = useMemo(() => {
    const acc: OutcomeCounts = {}
    if (!agg) return acc
    for (const row of agg.byOutcome) {
      const k: CellKey = `${row.predictionOutcome}+${row.captureOutcome}`
      acc[k] = row.count
    }
    return acc
  }, [agg])

  const stats = useMemo(() => {
    if (!agg) return { total: 0, hit: 0, miss: 0, captured: 0, overridden: 0 }
    const total = agg.total
    const hit = Math.round(agg.hitRate * total)
    const miss = Math.round(agg.missRate * total)
    const captured = Math.round(agg.capturedRate * total)
    const overridden = Math.round(agg.overriddenRate * total)
    return { total, hit, miss, captured, overridden }
  }, [agg])

  const kpis: KpiTile[] = [
    { label: '复盘总数',   value: stats.total },
    { label: '命中率 HIT', value: pct(stats.hit, stats.total),      sub: `${stats.hit} / ${stats.total}` },
    { label: '未命中 MISS', value: pct(stats.miss, stats.total),     sub: `${stats.miss} / ${stats.total}` },
    { label: '已捕获率',   value: pct(stats.captured, stats.total), sub: `${stats.captured} / ${stats.total}` },
    { label: '已校正',     value: pct(stats.overridden, stats.total), sub: `${stats.overridden} / ${stats.total}` },
  ]

  if (loading) return <div className="empty">加载中…</div>
  if (error)   return <div className="empty" style={{ color: 'var(--c-bad)' }}>加载失败:{error}</div>
  if (!agg || agg.total === 0) return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无复盘数据</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <KpiRow items={kpis} />
      <OutcomeMatrix counts={counts} />
    </div>
  )
}
