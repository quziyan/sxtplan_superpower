import type { DispatchTaskWithMedia } from '@/lib/prediction-api'
import type { DispatchState } from '@/lib/dispatch-api'
import { CancelButton } from './CancelButton'
import { MediaGallery } from './MediaGallery'

// Plan-C T27 / ISC-35 + T28 / ISC-36: dispatch records list, embedded in
// PredictionDetail. Each row shows the dispatch's adapter + external id +
// state, then nests the per-dispatch MediaGallery and (when the row is
// cancellable) a CancelButton.
//
// `onMutated` is the post-mutation hook: callers should refetch the
// PredictionDetail payload when it fires, since cancel transitions the
// dispatch state and therefore the row UI. Named `onMutated` (not `onCancel`)
// because it covers any state change a child triggers — we anticipate
// future child mutations (retry, resend) using the same callback.

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
  onMutated,
}: {
  dispatches: DispatchTaskWithMedia[]
  onMutated?: () => void
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
            <CancelButton
              predictionId={d.predictionId}
              dispatchState={d.state}
              onCancelled={onMutated}
            />
          </div>
          <MediaGallery mediaAssets={d.mediaAssets} />
        </div>
      ))}
    </div>
  )
}
