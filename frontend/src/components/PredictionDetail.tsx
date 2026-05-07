import { useEffect, useState } from 'react'
import { ConfidenceTimeline } from './ConfidenceTimeline'
import { DispatchPanel } from './DispatchPanel'
import { EvidenceList } from './EvidenceList'
import { Status } from './Status'
import { ConfBar } from './ConfBar'
import { Btn } from './Btn'
import {
  approvePrediction,
  getPredictionDetail,
  rejectPrediction,
  type PredictionDetailResponse,
} from '@/lib/prediction-api'

// Plan-C T28 / ISC-36 review fixes:
//   1. After approve / reject / cancel, the local `data` state must be
//      refetched so dispatchTasks (and prediction.status) reflect the
//      mutation. Previously we only bubbled onMutated up to the parent
//      list, leaving the detail pane visually stale.
//   2. DispatchPanel now receives `onMutated`, so the CancelButton inside
//      each dispatch row can trigger the same refetch when a cancel
//      succeeds.
// Both the local refetch AND the bubble-up are required: refetch keeps the
// detail pane consistent with the just-mutated server state, and onMutated
// bubble-up keeps the parent list (e.g. the inbox) in sync.

export function PredictionDetail({
  predictionId, onMutated,
}: { predictionId: string; onMutated?: () => void }) {
  const [data, setData] = useState<PredictionDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getPredictionDetail(predictionId).then(setData).catch(e => setError((e as Error).message))
  }, [predictionId])

  const refetch = async () => {
    try {
      const fresh = await getPredictionDetail(predictionId)
      setData(fresh)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Combined hook for child mutations: refetch local detail + bubble up so
  // any parent list view (inbox / table) also re-renders.
  const handleMutation = async () => {
    await refetch()
    onMutated?.()
  }

  if (error) return <div style={{ color: 'var(--c-bad)' }}>{error}</div>
  if (!data) return <div className="empty">加载中…</div>

  const p = data.prediction
  const onApprove = async () => {
    setBusy(true)
    try {
      await approvePrediction(p.id)
      await refetch()
      onMutated?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const onReject = async () => {
    setBusy(true)
    try {
      await rejectPrediction(p.id, '详情页驳回')
      await refetch()
      onMutated?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
      <section>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <span className="id-cell">{p.id}</span>
          <Status value={p.status} />
          <ConfBar value={p.confidenceNow} />
        </div>
        <div className="inbox-card__row">
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">车类 ID</span>
            <span className="inbox-card__field-val id-cell">{p.vehicleClassId.slice(0, 8)}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">任务 ID</span>
            <span className="inbox-card__field-val id-cell">{p.taskClassId.slice(0, 8)}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">区域</span>
            <span className="inbox-card__field-val id-cell">{p.regionId.slice(-8)} v{p.regionVersion}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">窗口</span>
            <span className="inbox-card__field-val">{p.windowDate.slice(0, 10)} {p.windowHalf}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">K</span>
            <span className="inbox-card__field-val num">{p.kDays}</span>
          </div>
        </div>
      </section>
      <section>
        <div className="section-h">
          <div className="section-h__title">置信度时间线</div>
          <div className="section-h__sub">{data.snapshots.length} 个快照</div>
        </div>
        <ConfidenceTimeline snapshots={data.snapshots} />
      </section>
      <section>
        <div className="section-h">
          <div className="section-h__title">推理与证据</div>
          <div className="section-h__sub">m2 简化:展示快照 reasoning;真证据列表 m3 接</div>
        </div>
        <EvidenceList snapshots={data.snapshots} />
      </section>
      <section>
        <div className="section-h">
          <div className="section-h__title">调度记录</div>
          <div className="section-h__sub">{data.dispatchTasks.length} 个调度任务</div>
        </div>
        <DispatchPanel dispatches={data.dispatchTasks} onMutated={handleMutation} />
      </section>
      {p.status === 'PROPOSED' && (
        <section style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Btn variant="ok" disabled={busy} onClick={onApprove}>批准</Btn>
          <Btn variant="danger" disabled={busy} onClick={onReject}>驳回</Btn>
        </section>
      )}
    </div>
  )
}
