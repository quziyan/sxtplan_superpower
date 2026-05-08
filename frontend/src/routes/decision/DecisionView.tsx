import { useCallback, useEffect, useState } from 'react'
import { InboxCard, PageHeader, type InboxItem } from '@/components'
import { approvePrediction, listPredictions, rejectPrediction, type PredictionListItem } from '@/lib/prediction-api'
import { listVehicleClasses, listTaskClasses, type VehicleClass, type TaskClass } from '@/lib/taxonomy-api'
import { listRegions, type RegionListItem } from '@/lib/region-api'

// Plan-C T33 / ISC-41: trim a snapshot reasoning string for the InboxCard
// preview. We want first paragraph or ~100 chars, whichever is shorter,
// so each card stays single-line-ish on the inbox list.
function previewReasoning(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const firstPara = raw.split(/\n{2,}|\r\n\r\n/)[0]?.trim() ?? ''
  if (!firstPara) return undefined
  const collapsed = firstPara.replace(/\s+/g, ' ')
  return collapsed.length > 100 ? collapsed.slice(0, 100).trimEnd() + '…' : collapsed
}

export function DecisionView({ onOpenPrediction }: { onOpenPrediction?: (id: string) => void }) {
  const [items, setItems] = useState<PredictionListItem[]>([])
  const [vMap, setVMap] = useState<Map<string, VehicleClass>>(new Map())
  const [tMap, setTMap] = useState<Map<string, TaskClass>>(new Map())
  const [regionMap, setRegionMap] = useState<Map<string, RegionListItem>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listVehicleClasses(), listTaskClasses(), listRegions({ kind: 'ALL' })])
      .then(([vs, ts, rs]) => {
        setVMap(new Map(vs.map(v => [v.id, v])))
        setTMap(new Map(ts.map(t => [t.id, t])))
        setRegionMap(new Map(rs.map(r => [r.id, r])))
      })
      .catch(console.error)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Plan-C T33: opt into inline latest snapshot so InboxCard can render
      // the reasoning snippet without a per-row /predictions/:id fetch.
      setItems(await listPredictions({ status: 'PROPOSED', limit: 50, includeLatestSnapshot: true }))
    }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const onApprove = async (id: string) => {
    setBusy(id); setError(null)
    try { await approvePrediction(id); await refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(null) }
  }
  const onReject = async (id: string) => {
    setBusy(id); setError(null)
    try { await rejectPrediction(id, '决策者驳回'); await refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(null) }
  }

  const inboxItems: InboxItem[] = items.map(p => ({
    id: p.id,
    shortId: p.id.split('-').slice(-1)[0]?.slice(0, 6) ?? p.id.slice(0, 8),
    vehicleLabel: vMap.get(p.vehicleClassId)?.name ?? p.vehicleClassId.slice(0, 6),
    taskLabel: tMap.get(p.taskClassId)?.name ?? p.taskClassId.slice(0, 6),
    regionLabel: regionMap.get(p.regionId)?.name ?? p.regionId.slice(-6),
    windowDate: p.windowDate.slice(0, 10),
    windowHalf: p.windowHalf,
    confidence: p.confidenceNow,
    status: p.status,
    reasoning: previewReasoning(p.latestSnapshot?.reasoning),
  }))

  return (
    <main className="workspace">
      <PageHeader
        title="决策者工作台"
        sub={`待批预测 ${items.length} 条 · 一键批/驳`}
      />
      <div className="workspace__body">
        {error && <div style={{ color: 'var(--c-bad)', marginBottom: 'var(--sp-3)' }}>{error}</div>}
        {loading && <div className="empty">加载中…</div>}
        {!loading && inboxItems.length === 0 && (
          <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>📥 当前无待批预测</div>
            <div>分析师推送预测后,这里会显示卡片列表。</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {inboxItems.map(it => (
            <div key={it.id} style={{ opacity: busy === it.id ? 0.5 : 1, pointerEvents: busy === it.id ? 'none' : 'auto' }}>
              <InboxCard item={it} onApprove={onApprove} onReject={onReject} onDetail={onOpenPrediction} />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
