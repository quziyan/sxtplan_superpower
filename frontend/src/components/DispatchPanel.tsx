import type { DispatchTaskWithMedia } from '@/lib/prediction-api'
import type { DispatchState } from '@/lib/dispatch-api'
import { MediaGallery } from './MediaGallery'

// Plan-C T27 / ISC-35: dispatch records list, embedded in PredictionDetail.
// Each row shows the dispatch's adapter + external id + state, then nests
// the per-dispatch MediaGallery underneath.
//
// onCancel is wired up by T28 (CancelButton). Until then it's optional and
// callers may omit it.

const STATE_LABELS: Record<DispatchState, string> = {
  QUEUED: '排队中',
  SENT: '已派发',
  IN_PROGRESS: '执行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  REJECTED_BY_ADAPTER: '渠道拒绝',
  CANCEL_PENDING: '取消中',
  CANCELLED: '已取消',
  TIMED_OUT: '超时',
}

function StateBadge({ state }: { state: DispatchState }) {
  return (
    <span className={`dispatch-state dispatch-state--${state.toLowerCase().replace(/_/g, '-')}`}>
      {STATE_LABELS[state]}
    </span>
  )
}

function formatTs(iso: string): string {
  // YYYY-MM-DD HH:mm — local-time, terse for table-like rows.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DispatchPanel({
  dispatches,
}: {
  dispatches: DispatchTaskWithMedia[]
  // T28 will wire CancelButton through this; keeping the prop in the public
  // shape now means T28 won't have to renegotiate the interface.
  onCancel?: (predictionId: string) => void
}) {
  if (dispatches.length === 0) {
    return (
      <div className="dispatch-panel">
        <p className="text-muted">尚未调度</p>
      </div>
    )
  }

  return (
    <div className="dispatch-panel">
      {dispatches.map((d) => (
        <div key={d.id} className="dispatch-row">
          <div className="dispatch-row__head">
            <StateBadge state={d.state} />
            <code className="id-cell">{d.adapterKey}</code>
            <span className="id-cell">{d.externalId ?? '(待派发)'}</span>
            <span className="text-muted">{formatTs(d.createdAt)}</span>
          </div>
          <MediaGallery mediaAssets={d.mediaAssets} />
        </div>
      ))}
    </div>
  )
}
