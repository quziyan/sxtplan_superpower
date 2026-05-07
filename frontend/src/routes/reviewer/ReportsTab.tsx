import { Fragment, useCallback, useEffect, useState } from 'react'
import { RetrospectiveCard } from '@/components'
import {
  getRetrospective,
  listRetrospectives,
  type RetrospectiveDetail,
  type RetrospectiveListItem,
} from '@/lib/retrospective-api'

// Plan-C T30 / ISC-38 — Reports tab.
// Table-style layout mirrors PredictionTable (m2): a single `.table` with click-to-expand
// rows. We render inline detail directly under the active row instead of opening a side
// pane because App.tsx's <DetailPane> is wired to predictions, not retrospectives. Lazy
// fetch the full RetrospectiveDetail via getRetrospective(id) so the list endpoint stays
// cheap. Cache details per-id so reopening a row doesn't refetch.

function predictionBadgeClass(o: RetrospectiveListItem['predictionOutcome']): string {
  switch (o) {
    case 'HIT':     return 'badge badge--hit'
    case 'MISS':    return 'badge badge--miss'
    case 'NO_DATA': return 'badge badge--no-data'
  }
}

function captureBadgeClass(o: RetrospectiveListItem['captureOutcome']): string {
  switch (o) {
    case 'CAPTURED':       return 'badge badge--captured'
    case 'NOT_CAPTURED':   return 'badge badge--not-captured'
    case 'NOT_DISPATCHED': return 'badge badge--not-dispatched'
    case 'UNKNOWN':        return 'badge badge--unknown'
  }
}

export function ReportsTab() {
  const [items, setItems] = useState<RetrospectiveListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, RetrospectiveDetail>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems(await listRetrospectives({ limit: 100 })) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const onRowClick = async (id: string) => {
    if (activeId === id) { setActiveId(null); return }
    setActiveId(id); setDetailError(null)
    if (details[id]) return
    setDetailLoading(true)
    try {
      const d = await getRetrospective(id)
      setDetails(prev => ({ ...prev, [id]: d }))
    } catch (e) {
      setDetailError((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  const onDetailMutated = async (id: string) => {
    // After an override, refresh both the list and the cached detail so badges/flags update.
    try {
      const [list, detail] = await Promise.all([
        listRetrospectives({ limit: 100 }),
        getRetrospective(id),
      ])
      setItems(list)
      setDetails(prev => ({ ...prev, [id]: detail }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <div className="empty">加载中…</div>
  if (error)   return <div className="empty" style={{ color: 'var(--c-bad)' }}>加载失败:{error}</div>
  if (items.length === 0) return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无复盘报告</div>

  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            <th>生成时间</th>
            <th>车类 / 任务</th>
            <th>区域</th>
            <th>窗口日期</th>
            <th>预测 outcome</th>
            <th>捕获 outcome</th>
            <th>综合分</th>
            <th>已校正</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => {
            const isActive = activeId === it.id
            const generated = it.generatedAt.slice(0, 16).replace('T', ' ')
            const cached = details[it.id]
            return (
              <Fragment key={it.id}>
                <tr className={isActive ? 'active' : ''} onClick={() => onRowClick(it.id)}>
                  <td className="num">{generated}</td>
                  <td>{it.prediction.vehicleClass} · {it.prediction.taskClass}</td>
                  <td className="id-cell">{it.prediction.regionName ?? '—'}</td>
                  <td className="num">{it.prediction.windowDate.slice(0, 10)}</td>
                  <td><span className={predictionBadgeClass(it.predictionOutcome)}>{it.predictionOutcome}</span></td>
                  <td><span className={captureBadgeClass(it.captureOutcome)}>{it.captureOutcome}</span></td>
                  <td className="num">{it.composite}</td>
                  <td>{it.outcomeOverridden ? <span className="badge badge--overridden">已校正</span> : '—'}</td>
                </tr>
                {isActive && (
                  <tr onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
                    <td colSpan={8} style={{ padding: 'var(--sp-4)', background: 'var(--c-panel-2)' }}>
                      {detailLoading && !cached && <div className="empty">详情加载中…</div>}
                      {detailError && !cached && (
                        <div className="empty" style={{ color: 'var(--c-bad)' }}>加载失败:{detailError}</div>
                      )}
                      {cached && (
                        <RetrospectiveCard
                          retro={cached}
                          isReviewer={true}
                          onMutated={() => onDetailMutated(it.id)}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
