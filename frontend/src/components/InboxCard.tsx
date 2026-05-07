import { Btn } from './Btn'
import { ConfBar } from './ConfBar'
import { Status, type PredictionStatus } from './Status'

export type InboxItem = {
  id: string
  shortId: string
  vehicleLabel: string
  taskLabel: string
  regionLabel: string
  windowDate: string
  windowHalf: 'AM' | 'PM'
  confidence: number
  status: PredictionStatus
  reasoning?: string  // 1 句简评(m3 接 latest snapshot.reasoning)
}

export function InboxCard({ item, onApprove, onReject, onDetail }: {
  item: InboxItem
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onDetail?: (id: string) => void
}) {
  return (
    <div className="inbox-card">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
          <span className="id-cell">{item.shortId}</span>
          <Status value={item.status} />
        </div>
        <div className="inbox-card__title">
          {item.vehicleLabel} · {item.taskLabel}
        </div>
        <div className="inbox-card__row">
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">区域</span>
            <span className="inbox-card__field-val">{item.regionLabel}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">窗口</span>
            <span className="inbox-card__field-val">{item.windowDate} {item.windowHalf}</span>
          </div>
          <div className="inbox-card__field">
            <span className="inbox-card__field-label">置信度</span>
            <span className="inbox-card__field-val"><ConfBar value={item.confidence} /></span>
          </div>
        </div>
        {item.reasoning && (
          // Plan-C T33 / ISC-41: latest snapshot reasoning surfaced inline.
          // Prefixed "推理:" so the role is immediately legible; italic small
          // text keeps the card visually quiet next to the V·T·R + 置信度 row.
          <div
            className="inbox-card__quote"
            style={{ fontStyle: 'italic', fontSize: 12 }}
            title={item.reasoning}
          >
            <span style={{ fontStyle: 'normal', fontWeight: 600, marginRight: 4 }}>推理:</span>
            {item.reasoning}
          </div>
        )}
      </div>
      <div className="inbox-card__actions">
        <Btn variant="ok" onClick={() => onApprove?.(item.id)}>批准</Btn>
        <Btn variant="danger" onClick={() => onReject?.(item.id)}>驳回</Btn>
        <Btn variant="ghost" size="sm" onClick={() => onDetail?.(item.id)}>详情</Btn>
      </div>
    </div>
  )
}
