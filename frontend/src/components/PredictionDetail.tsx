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
  sendBackPrediction,
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
  // 倒计时 secondsLeft:重算时从 12 起数到 0;driving live progress UI
  const [recomputeSecondsLeft, setRecomputeSecondsLeft] = useState<number>(0)
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
  // F:DECIDER 打回 VALIDATED → PROPOSED,要 reason ≥ 4 字
  const onSendBack = async () => {
    const reason = window.prompt('打回重审原因(≥ 4 字):', '证据不足,请补充新闻或调整置信度后重新推送')
    if (!reason || reason.trim().length < 4) return
    setBusy(true)
    try {
      await sendBackPrediction(p.id, reason)
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
    setRecomputeSecondsLeft(12)
    // 倒计时:每秒减 1,跑到 0 时进入 refetch + 完成判定
    const tickStart = Date.now()
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - tickStart) / 1000)
      const left = Math.max(0, 12 - elapsed)
      setRecomputeSecondsLeft(left)
      if (left <= 0) clearInterval(tick)
    }, 1000)
    try {
      await recomputeNow(p.id)
      // 后端 enqueue full-recalc + manualTrigger=true → P5 → refresh.FULL → LLM ~10s
      // 12s 后 refetch 一次,新 snapshot 应已写入
      setTimeout(async () => {
        clearInterval(tick)
        try {
          // 记录 refetch 前的 snapshot 数(closure 锁了 setTimeout 触发时刻的 React 状态)
          const before = data?.snapshots.length ?? 0
          // 一次 fetch 同时更新 UI 和拿到 after count
          const fresh = await getPredictionDetail(p.id)
          setData(fresh)
          // ISC-14:重算后 bubble 给父级 list 视图,这样 AnalystView/DecisionView 列表能拿到新置信度
          onMutated?.()
          if (fresh.snapshots.length <= before) {
            // 12s 内 LLM 没写新快照 — 提示用户再等
            setRecomputing('error')
            setError('LLM 较慢,12s 内未写入新快照,请稍后再点"立即重算"或刷新页面查看')
            setTimeout(() => { setRecomputing(null); setError(null) }, 6000)
          } else {
            setRecomputing('done')
            setTimeout(() => setRecomputing(null), 4000)
          }
        } catch (e) {
          setError((e as Error).message)
          setRecomputing('error')
        }
      }, 12000)
    } catch (e) {
      clearInterval(tick)
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
            {p.status === 'VALIDATED' && (
              <Btn disabled={busy || recomputing === 'pending'} onClick={onSendBack}>↩ 打回重审</Btn>
            )}
          </>
        )}
        {p.status === 'PROPOSED' && activeRole !== 'DECIDER' && activeRole !== 'ANALYST' && (
          <span style={{ color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>
            ⓘ 批准/驳回需切换到「决策者」角色
          </span>
        )}
        <Btn disabled={busy || recomputing === 'pending'} onClick={onRecompute}>
          {recomputing === 'pending' ? `重算中… ${recomputeSecondsLeft}s` : '立即重算'}
        </Btn>
        {recomputing === 'pending' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--fs-2)', color: 'var(--c-muted)',
          }}>
            {recomputeSecondsLeft > 8 ? '① 抓取最新新闻'
              : recomputeSecondsLeft > 3 ? '② LLM 评估证据'
              : '③ 写入快照 + 刷新'}
            <span style={{ fontFamily: 'monospace', color: 'var(--c-accent, #4ea1ff)' }}>
              [{'█'.repeat(Math.max(0, 12 - recomputeSecondsLeft))}{'░'.repeat(recomputeSecondsLeft)}]
            </span>
          </span>
        )}
        {recomputing === 'done' && (
          <span style={{ color: 'var(--c-good)', fontSize: 'var(--fs-2)' }}>
            ✓ 已刷新 — 时间线/置信度若有更新已显示
          </span>
        )}
        {recomputing === 'error' && error && (
          <span style={{ color: 'var(--c-warn, #fbbf24)', fontSize: 'var(--fs-2)' }}>
            ⚠ {error}
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
