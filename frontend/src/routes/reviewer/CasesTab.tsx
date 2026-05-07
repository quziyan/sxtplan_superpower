import { useCallback, useEffect, useMemo, useState } from 'react'
import { RetrospectiveCard } from '@/components'
import {
  getRetrospective,
  listRetrospectives,
  type RetrospectiveDetail,
  type RetrospectiveListItem,
} from '@/lib/retrospective-api'

// Plan-C T30 / ISC-38 — Cases tab.
// 案例库: 最近 N=20 条 retro, 按 vehicleClass / taskClass / regionName 三个维度过滤.
// Distinct filter values are extracted from the *full* fetched list (not the filtered
// view) so changing one filter doesn't shrink the others' option sets to a single value.
// Each item lazy-loads its full detail on expand and renders the existing T29 card.

const RECENT_LIMIT = 20

const ALL = '__all__'

function distinct(items: RetrospectiveListItem[], pick: (it: RetrospectiveListItem) => string | null): string[] {
  const set = new Set<string>()
  for (const it of items) {
    const v = pick(it)
    if (v != null && v !== '') set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function CasesTab() {
  const [items, setItems] = useState<RetrospectiveListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vehicleFilter, setVehicleFilter] = useState<string>(ALL)
  const [taskFilter,    setTaskFilter]    = useState<string>(ALL)
  const [regionFilter,  setRegionFilter]  = useState<string>(ALL)
  const [openId,        setOpenId]        = useState<string | null>(null)
  const [details,       setDetails]       = useState<Record<string, RetrospectiveDetail>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems(await listRetrospectives({ limit: RECENT_LIMIT })) }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const vehicleOptions = useMemo(() => distinct(items, it => it.prediction.vehicleClass), [items])
  const taskOptions    = useMemo(() => distinct(items, it => it.prediction.taskClass),    [items])
  const regionOptions  = useMemo(() => distinct(items, it => it.prediction.regionName),   [items])

  const filtered = useMemo(() => items.filter(it => {
    if (vehicleFilter !== ALL && it.prediction.vehicleClass !== vehicleFilter) return false
    if (taskFilter    !== ALL && it.prediction.taskClass    !== taskFilter)    return false
    if (regionFilter  !== ALL && (it.prediction.regionName ?? '') !== regionFilter) return false
    return true
  }), [items, vehicleFilter, taskFilter, regionFilter])

  const onToggle = async (id: string) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id); setDetailError(null)
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

  const onMutated = async (id: string) => {
    try {
      const [list, detail] = await Promise.all([
        listRetrospectives({ limit: RECENT_LIMIT }),
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--c-text-3)' }}>
          <span>车类</span>
          <select value={vehicleFilter} onChange={e => setVehicleFilter(e.target.value)}>
            <option value={ALL}>全部</option>
            {vehicleOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--c-text-3)' }}>
          <span>任务</span>
          <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}>
            <option value={ALL}>全部</option>
            {taskOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--c-text-3)' }}>
          <span>区域</span>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}>
            <option value={ALL}>全部</option>
            {regionOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-3)' }}>
          {filtered.length} / {items.length} 条
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="empty" style={{ padding: 'var(--sp-6)' }}>无匹配复盘案例</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {filtered.map(it => {
          const isOpen = openId === it.id
          const cached = details[it.id]
          return (
            <div key={it.id} style={{ border: '1px solid var(--c-line)', borderRadius: 'var(--rad-3)', background: 'var(--c-panel)' }}>
              <button
                onClick={() => onToggle(it.id)}
                style={{
                  width: '100%', padding: 'var(--sp-3) var(--sp-4)', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)',
                  textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`badge badge--${it.predictionOutcome.toLowerCase().replace('_', '-')}`}>
                    预测 · {it.predictionOutcome}
                  </span>
                  <span className={`badge badge--${it.captureOutcome.toLowerCase().replace('_', '-')}`}>
                    捕获 · {it.captureOutcome}
                  </span>
                  {it.outcomeOverridden && <span className="badge badge--overridden">已校正</span>}
                  <span style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                    {it.prediction.vehicleClass} · {it.prediction.taskClass}
                    {it.prediction.regionName && ` · ${it.prediction.regionName}`}
                    {' · '}{it.prediction.windowDate.slice(0, 10)}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                  综合 {it.composite} · {isOpen ? '收起' : '展开'}
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--c-line)' }}>
                  {detailLoading && !cached && <div className="empty">详情加载中…</div>}
                  {detailError && !cached && (
                    <div className="empty" style={{ color: 'var(--c-bad)' }}>加载失败:{detailError}</div>
                  )}
                  {cached && (
                    <RetrospectiveCard
                      retro={cached}
                      isReviewer={true}
                      onMutated={() => onMutated(it.id)}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
