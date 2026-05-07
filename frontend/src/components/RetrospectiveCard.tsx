import { useState, type ReactNode } from 'react'
import {
  overrideRetrospective,
  type RetrospectiveDetail,
  type PredictionOutcome,
  type CaptureOutcome,
} from '@/lib/retrospective-api'

// Plan-C T29 / ISC-37: 复盘卡片 — 4 件套 (二轴 outcome badges + 四维分 + causalMd + summaryMd)
// + override action (D 角色). Mirrors CancelButton (T28) for the modal pattern.
//
// Markdown rendering: backend writes `causal_md` / `summary_md` as plain markdown,
// but the frontend deliberately avoids adding `react-markdown` as a runtime dep
// for this slice — Plan-C explicitly forbids new deps without approval. Instead we
// split on blank lines and render each chunk as a `<p>` with `whiteSpace: 'pre-wrap'`,
// which preserves intra-paragraph newlines and any markdown punctuation as-is.
// That is the documented fallback in the task brief.
//
// CAPTURED+non-HIT pre-validation: the backend rejects this combination with 400
// ("CAPTURED implies HIT; invalid outcome combination", retrospective/service.ts).
// We mirror that check client-side so a reviewer never burns a network round-trip
// on an obviously-invalid override; we still rely on the server as the authority.

const PREDICTION_OPTIONS: PredictionOutcome[] = ['HIT', 'MISS', 'NO_DATA']
const CAPTURE_OPTIONS: CaptureOutcome[] = ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN']

type OverrideForm = {
  newPredictionOutcome: '' | PredictionOutcome
  newCaptureOutcome: '' | CaptureOutcome
  reason: string
}

const EMPTY_FORM: OverrideForm = {
  newPredictionOutcome: '',
  newCaptureOutcome: '',
  reason: '',
}

// Map outcome → BEM modifier on the `.badge` base class. Keeping this in one
// place avoids stringly-typed class-name drift if outcomes ever change.
function predictionBadgeClass(o: PredictionOutcome): string {
  switch (o) {
    case 'HIT':     return 'badge badge--hit'
    case 'MISS':    return 'badge badge--miss'
    case 'NO_DATA': return 'badge badge--no-data'
  }
}

function captureBadgeClass(o: CaptureOutcome): string {
  switch (o) {
    case 'CAPTURED':       return 'badge badge--captured'
    case 'NOT_CAPTURED':   return 'badge badge--not-captured'
    case 'NOT_DISPATCHED': return 'badge badge--not-dispatched'
    case 'UNKNOWN':        return 'badge badge--unknown'
  }
}

// Paragraph-split markdown. Cheap, zero-dep, preserves whitespace inside a paragraph
// so things like indented evidence quotes still read correctly.
function renderMarkdown(md: string): ReactNode {
  const trimmed = md.trim()
  if (trimmed.length === 0) return <p className="text-muted">(空)</p>
  return trimmed.split(/\n\n+/).map((para, i) => (
    <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{para}</p>
  ))
}

// Single 0–100 score bar. The backend stores scores as 0–100 ints already, so no
// scaling here; we just clamp defensively in case a future score drifts.
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="retro-score">
      <div className="retro-score__head">
        <span className="retro-score__label">{label}</span>
        <span className="retro-score__num">{pct}</span>
      </div>
      <div className="retro-score__rail">
        <div className="retro-score__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function RetrospectiveCard({
  retro,
  isReviewer,
  onMutated,
}: {
  retro: RetrospectiveDetail
  isReviewer?: boolean
  onMutated?: () => void
}) {
  const [isOpen, setOpen] = useState(false)
  const [form, setForm] = useState<OverrideForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const overridden = retro.outcomeOverridden
  const showOverrideButton = isReviewer === true && !overridden

  const close = () => {
    if (submitting) return
    setOpen(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  // Effective outcomes after applying the form on top of the current retro state —
  // this is what the backend would persist if we submitted right now.
  const effectivePrediction: PredictionOutcome =
    form.newPredictionOutcome === '' ? retro.predictionOutcome : form.newPredictionOutcome
  const effectiveCapture: CaptureOutcome =
    form.newCaptureOutcome === '' ? retro.captureOutcome : form.newCaptureOutcome

  const atLeastOneOutcome = form.newPredictionOutcome !== '' || form.newCaptureOutcome !== ''
  const reasonOk = form.reason.trim().length > 0
  const capturedRequiresHit =
    effectiveCapture === 'CAPTURED' && effectivePrediction !== 'HIT'

  const submitDisabled =
    submitting || !atLeastOneOutcome || !reasonOk || capturedRequiresHit

  const submit = async () => {
    if (capturedRequiresHit) {
      setError('CAPTURED 必须配 HIT(预测命中);请同时把 prediction 改为 HIT 或选择其他 capture 值。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await overrideRetrospective(retro.id, {
        ...(form.newPredictionOutcome !== '' && { newPredictionOutcome: form.newPredictionOutcome }),
        ...(form.newCaptureOutcome !== '' && { newCaptureOutcome: form.newCaptureOutcome }),
        reason: form.reason.trim(),
      })
      setOpen(false)
      setForm(EMPTY_FORM)
      onMutated?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="retrospective-card">
      {/* Top: 二轴 outcome badges + identity */}
      <div className="retrospective-card__head">
        <div className="retrospective-card__badges">
          <span className={predictionBadgeClass(retro.predictionOutcome)}>
            预测 · {retro.predictionOutcome}
          </span>
          <span className={captureBadgeClass(retro.captureOutcome)}>
            捕获 · {retro.captureOutcome}
          </span>
          {overridden && <span className="badge badge--overridden">已校正</span>}
        </div>
        <div className="retrospective-card__meta text-muted">
          <span>{retro.prediction.vehicleClass} · {retro.prediction.taskClass}</span>
          {retro.prediction.regionName && <span> · {retro.prediction.regionName}</span>}
          <span> · {retro.prediction.windowDate}</span>
        </div>
      </div>

      {/* Middle: 四维分 (left) + summary (right) */}
      <div className="retrospective-card__middle">
        <div className="retrospective-card__scores">
          <ScoreBar label="V (验证)"   value={retro.scoreV} />
          <ScoreBar label="R (区域)"   value={retro.scoreR} />
          <ScoreBar label="W (窗口)"   value={retro.scoreW} />
          <ScoreBar label="T (任务)"   value={retro.scoreT} />
          <div className="retro-score retro-score--composite">
            <div className="retro-score__head">
              <span className="retro-score__label">综合</span>
              <span className="retro-score__num">{retro.composite}</span>
            </div>
            <div className="retro-score__rail">
              <div
                className="retro-score__fill retro-score__fill--accent"
                style={{ width: `${Math.max(0, Math.min(100, retro.composite))}%` }}
              />
            </div>
          </div>
        </div>
        <div className="retrospective-card__summary">
          <div className="section-h">
            <span className="section-h__title">摘要</span>
          </div>
          {renderMarkdown(retro.summaryMd)}
        </div>
      </div>

      {/* Bottom: causal markdown body */}
      <div className="retrospective-card__causal">
        <div className="section-h">
          <span className="section-h__title">因果分析</span>
        </div>
        {renderMarkdown(retro.causalMd)}
      </div>

      {/* Override-already-applied notes */}
      {overridden && (retro.reviewerNotes || retro.overriddenReason) && (
        <div className="retrospective-card__override-notes">
          {retro.overriddenReason && (
            <div>
              <span className="text-muted">校正原因:</span> {retro.overriddenReason}
            </div>
          )}
          {retro.reviewerNotes && (
            <div>
              <span className="text-muted">审核备注:</span> {retro.reviewerNotes}
            </div>
          )}
        </div>
      )}

      {/* Footer: override action for D role */}
      {showOverrideButton && (
        <div className="retrospective-card__actions">
          <button className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
            校正 outcome
          </button>
        </div>
      )}

      {isOpen && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal__title">校正 outcome</h3>
            <p className="text-muted">
              至少修改一个 outcome,并填写原因。CAPTURED 必须配合 HIT。
            </p>

            <label className="retro-field">
              <span className="retro-field__label">新预测 outcome</span>
              <select
                className="retro-field__input"
                value={form.newPredictionOutcome}
                onChange={e =>
                  setForm(f => ({ ...f, newPredictionOutcome: e.target.value as OverrideForm['newPredictionOutcome'] }))
                }
                disabled={submitting}
              >
                <option value="">— 不修改({retro.predictionOutcome})—</option>
                {PREDICTION_OPTIONS.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <label className="retro-field">
              <span className="retro-field__label">新捕获 outcome</span>
              <select
                className="retro-field__input"
                value={form.newCaptureOutcome}
                onChange={e =>
                  setForm(f => ({ ...f, newCaptureOutcome: e.target.value as OverrideForm['newCaptureOutcome'] }))
                }
                disabled={submitting}
              >
                <option value="">— 不修改({retro.captureOutcome})—</option>
                {CAPTURE_OPTIONS.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <textarea
              className="textarea"
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="校正原因(必填)"
              rows={3}
              disabled={submitting}
            />

            {capturedRequiresHit && (
              <div className="alert alert--error">
                CAPTURED 必须配 HIT(预测命中);请同时把 prediction 改为 HIT 或选择其他 capture 值。
              </div>
            )}
            {error && !capturedRequiresHit && <div className="alert alert--error">{error}</div>}

            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={close} disabled={submitting}>
                取消
              </button>
              <button
                className="btn btn--primary"
                onClick={submit}
                disabled={submitDisabled}
              >
                {submitting ? '提交中…' : '确认校正'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
