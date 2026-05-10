import { useEffect, useState } from 'react'
import { Btn, Icon, KpiRow, PageHeader, PredictionTable } from '@/components'
import { listPredictions, type Prediction } from '@/lib/prediction-api'
import { listWatchLists, type WatchList } from '@/lib/watchlist-api'
import { listTaskCards, type TaskCard } from '@/lib/taskcard-api'
import { listVehicleClasses, listTaskClasses, type VehicleClass, type TaskClass } from '@/lib/taxonomy-api'
import { listRegions, type RegionListItem } from '@/lib/region-api'
import { getNewsFreshnessDays, setNewsFreshnessDays } from '@/lib/settings-api'
import { recomputeNow, spawnFromNewsForWatchlist, deletePrediction, updatePrediction } from '@/lib/prediction-api'
import { EditPredictionModal } from './EditPredictionModal'
import type { PredictionTableRow } from '@/components/PredictionTable'
import { NewWatchListModal } from './NewWatchListModal'
import { NewTaskCardModal } from './NewTaskCardModal'

export function AnalystView({ onOpenPrediction, mutationVersion = 0 }: {
  onOpenPrediction?: (id: string) => void
  // 父级 App 在某 prediction 被修改后 bump 这个数字,触发 list refetch
  // 但不会 unmount 视图(详情页保持开着)。
  mutationVersion?: number
}) {
  const [watchlists, setWatchlists] = useState<WatchList[]>([])
  const [taskcards, setTaskcards] = useState<TaskCard[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [vMap, setVMap] = useState<Map<string, VehicleClass>>(new Map())
  const [tMap, setTMap] = useState<Map<string, TaskClass>>(new Map())
  const [regionMap, setRegionMap] = useState<Map<string, RegionListItem>>(new Map())
  const [loading, setLoading] = useState(true)
  const [activeWatchlist, setActiveWatchlist] = useState<string>('all')
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [taskCardModalOpen, setTaskCardModalOpen] = useState(false)
  // 证据新闻时效窗口(天)。从后端 GET /settings/news-freshness-days 读;PUT 更新。
  const [freshnessDays, setFreshnessDays] = useState<number | null>(null)
  const [freshnessDraft, setFreshnessDraft] = useState<string>('')
  const [freshnessSaving, setFreshnessSaving] = useState(false)
  // 批量重算进度。null = 空闲;{ done, total, currentId, failed } = 重算中。
  const [batchProgress, setBatchProgress] = useState<
    { done: number; total: number; currentId: string | null; failed: number; finished?: boolean }
    | null
  >(null)
  // 预测生产状态 — 类似批量重算的 progress 模式:
  //  null = 空闲;{ done, total, currentName, ... } = 串行处理中
  const [spawnProgress, setSpawnProgress] = useState<{
    done: number
    total: number
    currentName: string | null
    totalsCreated: number
    totalsMerged: number
    totalsNewsFetched: number
    totalsNewsInserted: number
    finished?: boolean
    failed?: number
  } | null>(null)
  const [spawnFlash, setSpawnFlash] = useState<string | null>(null)
  // 编辑 modal + 删除处理
  const [editingRow, setEditingRow] = useState<PredictionTableRow | null>(null)
  const [actionFlash, setActionFlash] = useState<string | null>(null)

  // Refetch watchlists after a new one is created via the modal. Predictions
  // don't change when a watchlist is created (no signals attached yet) so we
  // skip refetching them here.
  const refreshWatchlists = () => {
    listWatchLists().then(setWatchlists).catch(console.error)
  }

  // Same for task cards — newly-created cards have no predictions yet, so
  // only the sidebar list needs to refresh on creation.
  const refreshTaskCards = () => {
    listTaskCards().then(setTaskcards).catch(console.error)
  }

  useEffect(() => {
    // (β) m5 UI 对齐:分析师工作台只看 PROPOSED — 待我审完后推送给决策者(VALIDATED)。
    // 拿 latestSnapshot 让 KPI/表格能区分已运行 LLM 和零置信度待评估的提案。
    // mutationVersion 变化时 → 父级提示「某 prediction 被改了」,这里只重拉 list,
    // 不 unmount 任何 child(详情页保持开)。
    Promise.all([listWatchLists(), listTaskCards(),
      listPredictions({ status: 'PROPOSED', limit: 100, includeLatestSnapshot: true, hasEvidence: true })])
      .then(([wls, tcs, ps]) => { setWatchlists(wls); setTaskcards(tcs); setPredictions(ps) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [mutationVersion])

  useEffect(() => {
    Promise.all([listVehicleClasses(), listTaskClasses(), listRegions({ kind: 'ALL' })])
      .then(([vs, ts, rs]) => {
        setVMap(new Map(vs.map(v => [v.id, v])))
        setTMap(new Map(ts.map(t => [t.id, t])))
        setRegionMap(new Map(rs.map(r => [r.id, r])))
      })
      .catch(console.error)
    getNewsFreshnessDays()
      .then(d => { setFreshnessDays(d); setFreshnessDraft(String(d)) })
      .catch(console.error)
  }, [])

  // 批量重算:对当前 filter 后的 prediction 列表,逐条调 recomputeNow API,
  // 串行不并发(避免 LLM 速率打爆),实时更新进度。失败的条数累计但继续推进。
  // 全部完成后等 12s 让最后一条 LLM 算完,再 refetch 列表。
  const onBatchRecompute = async () => {
    if (filtered.length === 0 || batchProgress) return
    if (filtered.length > 30) {
      const ok = confirm(`将串行重算 ${filtered.length} 条 prediction,大约 ${Math.ceil(filtered.length * 0.5)} 分钟。继续?`)
      if (!ok) return
    }
    const total = filtered.length
    setBatchProgress({ done: 0, total, currentId: null, failed: 0 })
    let failed = 0
    for (let i = 0; i < filtered.length; i++) {
      const p = filtered[i]!
      setBatchProgress({ done: i, total, currentId: p.id, failed })
      try {
        await recomputeNow(p.id)
      } catch (err) {
        console.error(`[batch-recompute] ${p.id} failed:`, err)
        failed++
      }
    }
    setBatchProgress({ done: total, total, currentId: null, failed, finished: true })
    // 给最后一条 LLM 12s 算完(P5 默认 ~10s),然后刷新列表
    setTimeout(async () => {
      try {
        const fresh = await listPredictions({ status: 'PROPOSED', limit: 100, includeLatestSnapshot: true, hasEvidence: true })
        setPredictions(fresh)
      } catch (e) { console.error(e) }
      setTimeout(() => setBatchProgress(null), 4000)
    }, 12_000)
  }

  // (β) 「📡 生成预测」 — 前端按 active watchlist 串行调 per-wl 路由,
  // 每个 wl 后端做 ① scoped tickNewsIngest ② 并发 3 drain extract。
  // UI 显示进度条:处理中 N/M · 当前 [天河区...] · 累计抓 X 条新闻 / 新建 Y 预测
  const onSpawnAll = async () => {
    if (spawnProgress && !spawnProgress.finished) return
    setSpawnFlash(null)
    const activeWls = watchlists.filter(w => w.isActive)
    if (activeWls.length === 0) {
      setSpawnFlash('✗ 没有 active watchlist,请先创建/激活')
      setTimeout(() => setSpawnFlash(null), 8000)
      return
    }
    let totalsCreated = 0, totalsMerged = 0, totalsNewsFetched = 0, totalsNewsInserted = 0, failed = 0
    setSpawnProgress({
      done: 0, total: activeWls.length, currentName: null,
      totalsCreated, totalsMerged, totalsNewsFetched, totalsNewsInserted, failed: 0,
    })
    for (let i = 0; i < activeWls.length; i++) {
      const wl = activeWls[i]!
      setSpawnProgress({
        done: i, total: activeWls.length, currentName: wl.name,
        totalsCreated, totalsMerged, totalsNewsFetched, totalsNewsInserted, failed,
      })
      try {
        const r = await spawnFromNewsForWatchlist(wl.id)
        totalsCreated += r.predictionsCreated
        totalsMerged += r.predictionsMerged
        totalsNewsFetched += r.newsFetched
        totalsNewsInserted += r.newsInserted
      } catch (err) {
        console.error(`[spawn] watchlist ${wl.id} failed:`, err)
        failed++
      }
    }
    setSpawnProgress({
      done: activeWls.length, total: activeWls.length, currentName: null,
      totalsCreated, totalsMerged, totalsNewsFetched, totalsNewsInserted, failed, finished: true,
    })
    // 末尾闪存
    const parts = [
      `✓ 处理 ${activeWls.length - failed}/${activeWls.length} 个监视清单`,
      `抓 ${totalsNewsFetched} 条新闻(${totalsNewsInserted} 新)`,
      `新建 ${totalsCreated} 条预测`,
      `合并 ${totalsMerged} 条`,
    ]
    if (failed > 0) parts.push(`⚠ 失败 ${failed}`)
    setSpawnFlash(parts.join(' · '))
    // 刷新列表
    try {
      const fresh = await listPredictions({ status: 'PROPOSED', limit: 100, includeLatestSnapshot: true, hasEvidence: true })
      setPredictions(fresh)
    } catch (e) { console.error(e) }
    setTimeout(() => { setSpawnProgress(null); setSpawnFlash(null) }, 8000)
  }

  const onSaveFreshness = async () => {
    const n = parseInt(freshnessDraft, 10)
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      alert('时效窗口必须是 1-365 之间的整数(天)')
      return
    }
    setFreshnessSaving(true)
    try {
      const r = await setNewsFreshnessDays(n)
      setFreshnessDays(r.value)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setFreshnessSaving(false)
    }
  }

  // (β) m5 UI 对齐:list 已是 PROPOSED;前端只做 watchlist 侧栏过滤,不再二次过滤 confidence
  const filtered = activeWatchlist === 'all'
    ? predictions
    : predictions.filter(p => p.sourceKind === 'WATCHLIST' && p.sourceId === activeWatchlist)

  // KPI 围绕"待我推送"的工作流:总待审 / 已评 / 建议优先 / 0 置信
  const kpiItems = [
    { label: '待审', value: predictions.length, sub: 'PROPOSED — 待我推送' },
    { label: 'LLM 已评', value: predictions.filter(p => p.confidenceNow > 0).length, sub: '已跑过 triage' },
    { label: '高置信', value: predictions.filter(p => p.confidenceNow >= 70).length, sub: '建议优先推送' },
    { label: '0 置信', value: predictions.filter(p => p.confidenceNow === 0).length, sub: '尚未运行 LLM' },
  ]

  const tableRows = filtered.map(p => ({
    id: p.id,
    vehicleClassName: vMap.get(p.vehicleClassId)?.name ?? p.vehicleClassId.slice(0, 6),
    taskClassName: tMap.get(p.taskClassId)?.name ?? p.taskClassId.slice(0, 6),
    regionShortId: regionMap.get(p.regionId)?.name ?? p.regionId.slice(-6),
    windowDate: p.windowDate.slice(0, 10),
    windowHalf: p.windowHalf,
    kDays: p.kDays,
    confidence: p.confidenceNow,
    status: p.status,
  }))

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>监视清单</span>
            <button
              title="新建监视清单"
              onClick={() => setNewModalOpen(true)}
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          <div
            className={`sidebar__item ${activeWatchlist === 'all' ? 'active' : ''}`}
            onClick={() => setActiveWatchlist('all')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="layers" size={13} />全部
            </span>
            <span className="sidebar__item-meta">{predictions.length}</span>
          </div>
          {watchlists.length === 0 && !loading && (
            <div className="empty" style={{ padding: 'var(--sp-3) 0', fontSize: 11 }}>
              (无监视清单 — 点击 + 新建)
            </div>
          )}
          {watchlists.filter(w => w.isActive).map(w => (
            <div
              key={w.id}
              className={`sidebar__item ${activeWatchlist === w.id ? 'active' : ''}`}
              onClick={() => setActiveWatchlist(w.id)}
              title={w.name}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="pin" size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
              </span>
              <span className="sidebar__item-meta">
                {predictions.filter(p => p.sourceKind === 'WATCHLIST' && p.sourceId === w.id).length}
              </span>
            </div>
          ))}
        </div>
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>任务卡</span>
            <button
              title="新建任务卡"
              onClick={() => setTaskCardModalOpen(true)}
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          {taskcards.length === 0 && !loading && (
            <div className="empty" style={{ padding: 'var(--sp-3) 0', fontSize: 11 }}>
              (无任务卡 — 点击 + 新建)
            </div>
          )}
          {taskcards.map(tc => (
            <div
              key={tc.id}
              className="sidebar__item"
              title={`${tc.name} · ${tc.targetWindowDate.slice(0, 10)} ${tc.targetWindowHalf}`}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="pin" size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.name}</span>
              </span>
              <span className="sidebar__item-meta">
                {tc.targetWindowDate.slice(5, 10)} {tc.targetWindowHalf}
              </span>
            </div>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <PageHeader
          title="分析师工作台"
          sub="监视新闻信号 → 审证据 → 调置信度 → 推送给决策者"
          actions={<>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 6,
              background: 'var(--c-panel-2)', fontSize: 'var(--fs-2)', color: 'var(--c-muted)',
            }}>
              新闻时效:
              <input
                type="number" min={1} max={365}
                value={freshnessDraft}
                onChange={e => setFreshnessDraft(e.target.value)}
                disabled={freshnessSaving || freshnessDays === null}
                style={{
                  width: 50, padding: '2px 6px', textAlign: 'right',
                  background: 'transparent', border: '1px solid var(--c-border, #2a2f3a)',
                  borderRadius: 4, color: 'inherit',
                }}
              />
              天
              <Btn
                disabled={freshnessSaving || freshnessDays === null || freshnessDraft === String(freshnessDays)}
                onClick={onSaveFreshness}
              >
                {freshnessSaving ? '保存中…' : '保存'}
              </Btn>
            </span>
            <Btn
              disabled={spawnProgress !== null && !spawnProgress.finished}
              onClick={onSpawnAll}
            >
              📡 {spawnProgress && !spawnProgress.finished ? `生产中 ${spawnProgress.done}/${spawnProgress.total}` : '生成预测'}
            </Btn>
            <Btn
              disabled={batchProgress !== null && !batchProgress.finished || filtered.length === 0}
              onClick={onBatchRecompute}
            >
              <Icon name="refresh" size={12} />立即重算{filtered.length > 0 ? ` (${filtered.length})` : ''}
            </Btn>
            <Btn variant="primary" onClick={() => setTaskCardModalOpen(true)}>
              <Icon name="plus" size={12} />新建任务卡
            </Btn>
          </>}
        />
        <div className="workspace__body">
          {/* 📡 生成预测进度面板(spawn-from-news 串行处理 active watchlist)*/}
          {spawnProgress && !spawnProgress.finished && (
            <div style={{
              marginBottom: 'var(--sp-4)', padding: 'var(--sp-3) var(--sp-4)',
              background: 'var(--c-panel-2)', borderRadius: 6,
              border: '1px solid var(--c-accent, #4ea1ff)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>
                  📡 生成预测中 {spawnProgress.done}/{spawnProgress.total}
                </span>
                <div style={{
                  flex: 1, height: 6, background: 'var(--c-border, #2a2f3a)', borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(spawnProgress.done / Math.max(1, spawnProgress.total)) * 100}%`,
                    height: '100%',
                    background: 'var(--c-accent, #4ea1ff)',
                    transition: 'width 200ms ease',
                  }} />
                </div>
                {spawnProgress.currentName && (
                  <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
                    当前 [{spawnProgress.currentName}]
                  </span>
                )}
              </div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
                累计:抓 {spawnProgress.totalsNewsFetched} 条新闻({spawnProgress.totalsNewsInserted} 新)
                · 新建 {spawnProgress.totalsCreated} · 合并 {spawnProgress.totalsMerged}
                {spawnProgress.failed && spawnProgress.failed > 0 ? ` · ⚠ 失败 ${spawnProgress.failed}` : ''}
              </div>
            </div>
          )}
          {spawnFlash && (
            <div style={{
              marginBottom: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
              background: spawnFlash.startsWith('✓') ? 'var(--c-ok-soft, rgba(34,197,94,0.12))' : 'var(--c-bad-soft, rgba(239,68,68,0.12))',
              color: spawnFlash.startsWith('✓') ? 'var(--c-ok)' : 'var(--c-bad)',
              borderRadius: 6, fontSize: 'var(--fs-2)',
            }}>
              {spawnFlash}
            </div>
          )}
          {batchProgress && (
            <div style={{
              marginBottom: 'var(--sp-4)', padding: 'var(--sp-3) var(--sp-4)',
              background: 'var(--c-panel-2)', borderRadius: 6,
              border: '1px solid var(--c-border, #2a2f3a)',
              display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
            }}>
              <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>
                {batchProgress.finished
                  ? '⌛ 已批量提交,等待 LLM 完成…'
                  : `🔄 批量重算中 ${batchProgress.done}/${batchProgress.total}`}
              </span>
              <div style={{
                flex: 1, height: 6, background: 'var(--c-border, #2a2f3a)', borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(batchProgress.done / Math.max(1, batchProgress.total)) * 100}%`,
                  height: '100%',
                  background: batchProgress.failed > 0 ? 'var(--c-warn, #fbbf24)' : 'var(--c-accent, #4ea1ff)',
                  transition: 'width 200ms ease',
                }} />
              </div>
              {batchProgress.currentId && (
                <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', fontFamily: 'monospace' }}>
                  当前 [{batchProgress.currentId.slice(0, 8)}]
                </span>
              )}
              {batchProgress.failed > 0 && (
                <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-warn, #fbbf24)' }}>
                  ⚠ 失败 {batchProgress.failed}
                </span>
              )}
            </div>
          )}
          <div style={{ marginBottom: 'var(--sp-5)' }}>
            <KpiRow items={kpiItems} />
          </div>
          {actionFlash && (
            <div style={{
              marginBottom: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
              background: actionFlash.startsWith('✓') ? 'var(--c-ok-soft, rgba(34,197,94,0.12))' : 'var(--c-bad-soft, rgba(239,68,68,0.12))',
              color: actionFlash.startsWith('✓') ? 'var(--c-ok)' : 'var(--c-bad)',
              borderRadius: 6, fontSize: 'var(--fs-2)',
            }}>{actionFlash}</div>
          )}
          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <PredictionTable
              rows={tableRows}
              onOpen={onOpenPrediction}
              onEdit={(r) => setEditingRow(r)}
              onDelete={async (r) => {
                if (!window.confirm(`删除预测 [${r.id.slice(0,8)}] ${r.vehicleClassName}/${r.taskClassName}/${r.windowDate} ${r.windowHalf}?\n硬删 — 不可恢复(级联删除关联快照/证据)。`)) return
                try {
                  await deletePrediction(r.id)
                  setActionFlash(`✓ 已删除 [${r.id.slice(0,8)}]`)
                  // 重 fetch 列表
                  const fresh = await listPredictions({ status: 'PROPOSED', limit: 100, includeLatestSnapshot: true, hasEvidence: true })
                  setPredictions(fresh)
                  setTimeout(() => setActionFlash(null), 5000)
                } catch (e) {
                  setActionFlash('✗ ' + (e as Error).message)
                  setTimeout(() => setActionFlash(null), 8000)
                }
              }}
            />
          )}
        </div>
      </main>

      <NewWatchListModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={refreshWatchlists}
      />

      <NewTaskCardModal
        open={taskCardModalOpen}
        onClose={() => setTaskCardModalOpen(false)}
        onCreated={refreshTaskCards}
      />

      <EditPredictionModal
        open={!!editingRow}
        row={editingRow}
        onClose={() => setEditingRow(null)}
        onSubmit={async (patch) => {
          if (!editingRow) return
          await updatePrediction(editingRow.id, patch)
          setActionFlash(`✓ 已更新预测 [${editingRow.id.slice(0,8)}] 窗口为 ${patch.windowDate ?? editingRow.windowDate.slice(0,10)} ${patch.windowHalf ?? editingRow.windowHalf}`)
          // 重 fetch
          try {
            const fresh = await listPredictions({ status: 'PROPOSED', limit: 100, includeLatestSnapshot: true, hasEvidence: true })
            setPredictions(fresh)
          } catch (e) { console.error(e) }
          setTimeout(() => setActionFlash(null), 5000)
        }}
      />
    </div>
  )
}
