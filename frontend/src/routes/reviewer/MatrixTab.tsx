import { useEffect, useMemo, useState } from 'react'
import { KpiRow, OutcomeMatrix, type KpiTile } from '@/components'
import type { CellKey, OutcomeCounts } from '@/components/OutcomeMatrix'
import { listRetrospectives, type RetrospectiveListItem } from '@/lib/retrospective-api'

// Plan-C T30 / ISC-38 — Matrix tab.
// Aggregation is client-side per Plan-C scope: no dedicated /retrospectives/aggregate
// endpoint exists yet (T23 only ships list/get/override). We pull up to 500 items, group
// by `${predictionOutcome}+${captureOutcome}`, then surface KPI rates above the matrix.
//
// Note: 500-row hard cap is a Plan-C-stated limit; if/when the dataset outgrows that,
// the right move is a backend aggregation endpoint, not paginating client-side.

const AGG_LIMIT = 500

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

export function MatrixTab() {
  const [items, setItems] = useState<RetrospectiveListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    listRetrospectives({ limit: AGG_LIMIT })
      .then(rows => { if (!cancelled) setItems(rows) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const counts: OutcomeCounts = useMemo(() => {
    const acc: OutcomeCounts = {}
    for (const it of items) {
      const k: CellKey = `${it.predictionOutcome}+${it.captureOutcome}`
      acc[k] = (acc[k] ?? 0) + 1
    }
    return acc
  }, [items])

  const stats = useMemo(() => {
    const total = items.length
    let hit = 0, miss = 0, captured = 0, overridden = 0
    for (const it of items) {
      if (it.predictionOutcome === 'HIT')   hit++
      if (it.predictionOutcome === 'MISS')  miss++
      if (it.captureOutcome    === 'CAPTURED') captured++
      if (it.outcomeOverridden)             overridden++
    }
    return { total, hit, miss, captured, overridden }
  }, [items])

  const kpis: KpiTile[] = [
    { label: '复盘总数',   value: stats.total },
    { label: '命中率 HIT', value: pct(stats.hit, stats.total),      sub: `${stats.hit} / ${stats.total}` },
    { label: '未命中 MISS', value: pct(stats.miss, stats.total),     sub: `${stats.miss} / ${stats.total}` },
    { label: '已捕获率',   value: pct(stats.captured, stats.total), sub: `${stats.captured} / ${stats.total}` },
    { label: '已校正',     value: pct(stats.overridden, stats.total), sub: `${stats.overridden} / ${stats.total}` },
  ]

  if (loading) return <div className="empty">加载中…</div>
  if (error)   return <div className="empty" style={{ color: 'var(--c-bad)' }}>加载失败:{error}</div>
  if (items.length === 0) return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无复盘数据</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <KpiRow items={kpis} />
      <OutcomeMatrix counts={counts} />
    </div>
  )
}
