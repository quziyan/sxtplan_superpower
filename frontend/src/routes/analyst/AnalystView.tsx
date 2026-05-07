import { useEffect, useState } from 'react'
import { Btn, Icon, KpiRow, PageHeader, PredictionTable } from '@/components'
import { listPredictions, type Prediction } from '@/lib/prediction-api'
import { listWatchLists, type WatchList } from '@/lib/watchlist-api'
import { listTaskCards, type TaskCard } from '@/lib/taskcard-api'
import { NewWatchListModal } from './NewWatchListModal'
import { NewTaskCardModal } from './NewTaskCardModal'

export function AnalystView({ onOpenPrediction }: { onOpenPrediction?: (id: string) => void }) {
  const [watchlists, setWatchlists] = useState<WatchList[]>([])
  const [taskcards, setTaskcards] = useState<TaskCard[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)
  const [activeWatchlist, setActiveWatchlist] = useState<string>('all')
  const [newModalOpen, setNewModalOpen] = useState(false)
  const [taskCardModalOpen, setTaskCardModalOpen] = useState(false)

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
    Promise.all([listWatchLists(), listTaskCards(), listPredictions({ limit: 100 })])
      .then(([wls, tcs, ps]) => { setWatchlists(wls); setTaskcards(tcs); setPredictions(ps) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = activeWatchlist === 'all'
    ? predictions
    : predictions.filter(p => p.sourceKind === 'WATCHLIST' && p.sourceId === activeWatchlist)

  const kpiItems = [
    { label: '待批预测', value: predictions.filter(p => p.status === 'PROPOSED').length, sub: '待 A 决策者审' },
    { label: '已批准', value: predictions.filter(p => p.status === 'APPROVED').length, sub: '等待调度' },
    { label: '已调度', value: predictions.filter(p => p.status === 'DISPATCHED').length, sub: '执行中' },
    { label: '已完成', value: predictions.filter(p => p.status === 'COMPLETED').length, sub: '历史复盘' },
  ]

  const tableRows = filtered.map(p => ({
    id: p.id,
    vehicleClassName: p.vehicleClassId.slice(0, 6),
    taskClassName: p.taskClassId.slice(0, 6),
    regionShortId: p.regionId.slice(-6),
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
            <Btn disabled><Icon name="refresh" size={12} />立即重算</Btn>
            <Btn variant="primary" onClick={() => setTaskCardModalOpen(true)}>
              <Icon name="plus" size={12} />新建任务卡
            </Btn>
          </>}
        />
        <div className="workspace__body">
          <div style={{ marginBottom: 'var(--sp-5)' }}>
            <KpiRow items={kpiItems} />
          </div>
          {loading ? (
            <div className="empty">加载中…</div>
          ) : (
            <PredictionTable rows={tableRows} onOpen={onOpenPrediction} />
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
    </div>
  )
}
