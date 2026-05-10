import { useCallback, useEffect, useState } from 'react'
import { Btn, InboxCard, PageHeader, type InboxItem } from '@/components'
import {
  approvePrediction, listPredictions, rejectPrediction, sendBackPrediction,
  type PredictionListItem,
} from '@/lib/prediction-api'
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

export function DecisionView({ onOpenPrediction, mutationVersion = 0 }: {
  onOpenPrediction?: (id: string) => void
  mutationVersion?: number
}) {
  const [items, setItems] = useState<PredictionListItem[]>([])
  const [vMap, setVMap] = useState<Map<string, VehicleClass>>(new Map())
  const [tMap, setTMap] = useState<Map<string, TaskClass>>(new Map())
  const [regionMap, setRegionMap] = useState<Map<string, RegionListItem>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // F:多选 + 批量动作。selectedIds 是当前勾选的 prediction id 集合;
  //    batchProgress 是批量执行中的进度。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchProgress, setBatchProgress] = useState<
    | { action: 'approve' | 'reject' | 'send-back'; done: number; total: number; failed: number; finished?: boolean }
    | null
  >(null)

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
      // (β) m5 UI 对齐:决策者只看 VALIDATED
      setItems(await listPredictions({ status: 'VALIDATED', limit: 50, includeLatestSnapshot: true }))
      setSelectedIds(new Set())  // refetch 后清选择
    }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  // mutationVersion 变化时也重拉 list(父级 App 在 detail 触发 onMutated 后 bump)
  useEffect(() => { refresh() }, [refresh, mutationVersion])

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
  const onSendBack = async (id: string) => {
    const reason = window.prompt('打回重审原因(≥ 4 字):', '证据不足,请补充新闻或调整置信度后重新推送')
    if (!reason || reason.trim().length < 4) return
    setBusy(id); setError(null)
    try { await sendBackPrediction(id, reason); await refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(null) }
  }

  // 批量动作。串行调用避免 LLM 速率打爆,失败累计但继续。
  const onBatch = async (action: 'approve' | 'reject' | 'send-back') => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    let reason: string | null = null
    if (action === 'reject') {
      reason = window.prompt(`批量驳回 ${ids.length} 条 — 原因(可选):`, '决策者批量驳回') ?? ''
    } else if (action === 'send-back') {
      reason = window.prompt(`批量打回 ${ids.length} 条 — 原因(≥ 4 字):`, '证据不足,请重新审')
      if (!reason || reason.trim().length < 4) return
    }
    setBatchProgress({ action, done: 0, total: ids.length, failed: 0 })
    let failed = 0
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      setBatchProgress({ action, done: i, total: ids.length, failed })
      try {
        if (action === 'approve') await approvePrediction(id)
        else if (action === 'reject') await rejectPrediction(id, reason ?? '')
        else await sendBackPrediction(id, reason!)
      } catch (err) {
        console.error(`[batch-${action}] ${id} failed:`, err)
        failed++
      }
    }
    setBatchProgress({ action, done: ids.length, total: ids.length, failed, finished: true })
    await refresh()
    setTimeout(() => setBatchProgress(null), 4000)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(items.map(p => p.id)))
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

  const selCount = selectedIds.size
  const allSelected = items.length > 0 && selCount === items.length

  return (
    <main className="workspace">
      <PageHeader
        title="决策者工作台"
        sub={`分析师已推送 ${items.length} 条 · 一键批/驳/打回`}
      />
      <div className="workspace__body">
        {error && <div style={{ color: 'var(--c-bad)', marginBottom: 'var(--sp-3)' }}>{error}</div>}

        {/* F:批量动作栏 — 只在有选中项时显示 */}
        {selCount > 0 && !batchProgress && (
          <div style={{
            marginBottom: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-4)',
            background: 'var(--c-panel-2)', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
            border: '1px solid var(--c-accent, #4ea1ff)',
          }}>
            <span style={{ fontWeight: 600 }}>已选 {selCount} 条</span>
            <Btn variant="ok"     onClick={() => onBatch('approve')}>批量批准</Btn>
            <Btn variant="danger" onClick={() => onBatch('reject')}>批量驳回</Btn>
            <Btn                   onClick={() => onBatch('send-back')}>批量打回重审</Btn>
            <Btn                   onClick={() => setSelectedIds(new Set())}>清除选择</Btn>
          </div>
        )}

        {/* 批量进度面板 */}
        {batchProgress && (
          <div style={{
            marginBottom: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-4)',
            background: 'var(--c-panel-2)', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
          }}>
            <span style={{ fontWeight: 600 }}>
              {batchProgress.finished ? '✓' : '🔄'} 批量
              {batchProgress.action === 'approve' ? '批准' : batchProgress.action === 'reject' ? '驳回' : '打回'}
              {' '}{batchProgress.done}/{batchProgress.total}
              {batchProgress.failed > 0 && <span style={{ color: 'var(--c-warn, #fbbf24)', marginLeft: 8 }}>⚠ 失败 {batchProgress.failed}</span>}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--c-border, #2a2f3a)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${(batchProgress.done / Math.max(1, batchProgress.total)) * 100}%`,
                height: '100%', background: 'var(--c-accent, #4ea1ff)', transition: 'width 200ms ease',
              }} />
            </div>
          </div>
        )}

        {/* 全选行 */}
        {items.length > 0 && (
          <div style={{
            marginBottom: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-3)',
            display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
            color: 'var(--c-muted)', fontSize: 'var(--fs-2)',
          }}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span>{allSelected ? '取消全选' : '全选'}({items.length})</span>
          </div>
        )}

        {loading && <div className="empty">加载中…</div>}
        {!loading && inboxItems.length === 0 && (
          <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>📥 当前无待批预测</div>
            <div>分析师在工作台审完后会点「推送给决策者」,这里会出现卡片。</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          {inboxItems.map(it => (
            <div key={it.id} style={{
              opacity: busy === it.id ? 0.5 : 1,
              pointerEvents: busy === it.id ? 'none' : 'auto',
              display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
            }}>
              <input
                type="checkbox"
                checked={selectedIds.has(it.id)}
                onChange={() => toggleSelect(it.id)}
                style={{ marginTop: 16 }}
              />
              <div style={{ flex: 1 }}>
                <InboxCard
                  item={it}
                  onApprove={onApprove}
                  onReject={onReject}
                  onSendBack={onSendBack}
                  onDetail={onOpenPrediction}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
