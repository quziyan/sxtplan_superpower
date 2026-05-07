import { useState } from 'react'
import { cancelPrediction, type DispatchState } from '@/lib/dispatch-api'

// Plan-C T28 / ISC-36: 撤单按钮 + 确认对话框 + reason 文本框 → POST /predictions/:id/cancel.
// Renders a small danger button per cancellable dispatch row. On click,
// opens a modal with a required reason textarea. Submits to the cancel
// route, then calls onCancelled so the parent (PredictionDetail) refetches
// the detail payload — that's how the row's state badge transitions from
// e.g. SENT -> CANCEL_PENDING -> CANCELLED.
//
// The set of cancellable states matches the backend guard in T24:
// QUEUED | SENT | IN_PROGRESS. Terminal/in-flight-cancel states (COMPLETED,
// FAILED, CANCEL_PENDING, CANCELLED, etc.) hide the button entirely.

const CANCELLABLE_STATES: ReadonlyArray<DispatchState> = ['QUEUED', 'SENT', 'IN_PROGRESS']

export function CancelButton({
  predictionId,
  dispatchState,
  onCancelled,
}: {
  predictionId: string
  dispatchState: DispatchState
  onCancelled?: () => void
}) {
  const [isOpen, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancellable = CANCELLABLE_STATES.includes(dispatchState)
  if (!cancellable) return null

  const close = () => {
    if (submitting) return
    setOpen(false)
    setReason('')
    setError(null)
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await cancelPrediction(predictionId, { reason: reason.trim() })
      setOpen(false)
      setReason('')
      onCancelled?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button className="btn btn--danger btn--sm" onClick={() => setOpen(true)}>
        撤单
      </button>
      {isOpen && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal__title">撤销调度</h3>
            <p className="text-muted">该操作不可撤销;请填写撤单原因。</p>
            <textarea
              className="textarea"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="撤单原因(必填)"
              rows={3}
              disabled={submitting}
            />
            {error && <div className="alert alert--error">{error}</div>}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={close} disabled={submitting}>
                取消
              </button>
              <button
                className="btn btn--danger"
                onClick={submit}
                disabled={submitting || reason.trim().length === 0}
              >
                {submitting ? '提交中…' : '确认撤销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
