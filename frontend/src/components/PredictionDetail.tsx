import { useEffect, useState } from 'react'
import { ConfidenceTimeline } from './ConfidenceTimeline'
import { DispatchPanel } from './DispatchPanel'
import { EvidenceList } from './EvidenceList'
import { Status } from './Status'
import { ConfBar } from './ConfBar'
import { Btn } from './Btn'
import {
  approvePrediction,
  validatePrediction,
  getPredictionDetail,
  recomputeNow,
  rejectPrediction,
  type PredictionDetailResponse,
} from '@/lib/prediction-api'
import { listVehicleClasses, listTaskClasses, type VehicleClass, type TaskClass } from '@/lib/taxonomy-api'
import { listRegions, type RegionListItem } from '@/lib/region-api'

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
  predictionId, onMutated, activeRole,
}: { predictionId: string; onMutated?: () => void; activeRole?: string | null }) {
  const [data, setData] = useState<PredictionDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // m5 G5 UI 接通:点"立即重算"后,后端 enqueue 到 fullRecalcQueue。worker
  // 消费 ~10s 后写新 snapshot;UI 自动 12s 后 refetch + 提示状态。
  const [recomputing, setRecomputing] = useState<null | 'pending' | 'done' | 'error'>(null)
  // m5 UI fix: V/T/region lookup maps,把 ID 显示成名字
  const [vMap, setVMap] = useState<Map<string, VehicleClass>>(new Map())
  const [tMap, setTMap] = useState<Map<string, TaskClass>>(new Map())
  const [regionMap, setRegionMap] = useState<Map<string, RegionListItem>>(new Map())

  useEffect(() => {
    getPredictionDetail(predictionId).then(setData).catch(e => setError((e as Error).message))
  }, [predictionId])

  useEffect(() => {
    Promise.all([listVehicleClasses(), listTaskClasses(), listRegions({ kind: 'ALL' })])
      .then(([vs, ts, rs]) => {
        setVMap(new Map(vs.map(v => [v.id, v])))
        setTMap(new Map(ts.map(t => [t.id, t])))
        setRegionMap(new Map(rs.map(r => [r.id, r])))
      })
      .catch(console.error)
  }, [])

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
  // (β) m5 UI:ANALYST 推送 PROPOSED → VALIDATED,DECIDER 工作台才会看见
  const onValidate = async () => {
    setBusy(true)
    try {
      await validatePrediction(p.id)
      await refetch()
      onMutated?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const onRecompute = async () => {
    setRecomputing('pending')
    try {
      await recomputeNow(p.id)
      // 后端 enqueue full-recalc + manualTrigger=true → P5 → refresh.FULL → LLM ~10s
      // 12s 后 refetch 一次,新 snapshot 应已写入
      setTimeout(async () => {
        try {
          await refetch()
          // ISC-14:重算后 bubble 给父级 list 视图,这样 AnalystView/DecisionView 列表能拿到新置信度
          onMutated?.()
          setRecomputing('done')
          setTimeout(() => setRecomputing(null), 4000)
        } catch (e) {
          setError((e as Error).message)
          setRecomputing('error')
        }
      }, 12000)
    } catch (e) {
      setError((e as Error).message)
      setRecomputing('error')
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
            <span className="inbox-card__field-label">车类</span>
            <span className="inbox-card__field-val">{vMap.get(p.vehicleClassId)?.name ?? p.vehicleClassId.slice(0, 8)}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">任务</span>
            <span className="inbox-card__field-val">{tMap.get(p.taskClassId)?.name ?? p.taskClassId.slice(0, 8)}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">区域</span>
            <span className="inbox-card__field-val">{regionMap.get(p.regionId)?.name ?? p.regionId.slice(-8)} v{p.regionVersion}</span>
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
        <EvidenceList
          snapshots={data.snapshots}
          evidence={data.evidence ?? []}
          newsById={data.newsById ?? {}}
        />
      </section>
      <section>
        <div className="section-h">
          <div className="section-h__title">调度记录</div>
          <div className="section-h__sub">{data.dispatchTasks.length} 个调度任务</div>
        </div>
        <DispatchPanel dispatches={data.dispatchTasks} onMutated={handleMutation} />
      </section>
      <section style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* (β) m5 UI:ANALYST 在 PROPOSED 上推送给决策者;DECIDER 在 VALIDATED 上批准/驳回 */}
        {p.status === 'PROPOSED' && activeRole === 'ANALYST' && (
          <Btn variant="primary" disabled={busy || recomputing === 'pending'} onClick={onValidate}>
            ✈︎ 推送给决策者
          </Btn>
        )}
        {(p.status === 'PROPOSED' || p.status === 'VALIDATED') && activeRole === 'DECIDER' && (
          <>
            <Btn variant="ok" disabled={busy || recomputing === 'pending'} onClick={onApprove}>批准</Btn>
            <Btn variant="danger" disabled={busy || recomputing === 'pending'} onClick={onReject}>驳回</Btn>
          </>
        )}
        {p.status === 'PROPOSED' && activeRole !== 'DECIDER' && activeRole !== 'ANALYST' && (
          <span style={{ color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>
            ⓘ 批准/驳回需切换到「决策者」角色
          </span>
        )}
        <Btn disabled={busy || recomputing === 'pending'} onClick={onRecompute}>
          {recomputing === 'pending' ? '重算中…(~12s)' : '立即重算'}
        </Btn>
        {recomputing === 'done' && (
          <span style={{ color: 'var(--c-good)', fontSize: 'var(--fs-2)' }}>
            ✓ 已刷新 — 时间线/置信度若有更新已显示
          </span>
        )}
        {recomputing === 'error' && (
          <span style={{ color: 'var(--c-bad)', fontSize: 'var(--fs-2)' }}>
            ✗ 重算失败,看 worker 终端 logs
          </span>
        )}
      </section>
    </div>
  )
}
