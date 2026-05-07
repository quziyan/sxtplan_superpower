import { Fragment, type KeyboardEvent } from 'react'
import type { PredictionOutcome, CaptureOutcome } from '@/lib/retrospective-api'

// Plan-C T26 / ISC-34: 3×4 outcome matrix grid for the retrospective reviewer view.
// Layout reference: prototype view-decision-reviewer.jsx; CSS lives in styles/components.css
// (.matrix, .matrix__cell, .matrix__cell--head, .matrix__cell--impossible).
//
// 12 cells; 2 are physically impossible:
//   - MISS+CAPTURED:    a missed prediction can't be the one that captured the event
//   - NO_DATA+CAPTURED: with no prediction data, "captured by prediction" is undefined

const PREDICTION_OUTCOMES = ['HIT', 'MISS', 'NO_DATA'] as const
const CAPTURE_OUTCOMES = ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN'] as const

export type CellKey = `${PredictionOutcome}+${CaptureOutcome}`
export type OutcomeCounts = Partial<Record<CellKey, number>>

const IMPOSSIBLE: ReadonlySet<CellKey> = new Set<CellKey>([
  'MISS+CAPTURED',
  'NO_DATA+CAPTURED',
])

export function OutcomeMatrix({
  counts,
  onCellClick,
}: {
  counts: OutcomeCounts
  onCellClick?: (key: CellKey) => void
}) {
  const handleKey = (k: CellKey) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCellClick?.(k)
    }
  }

  return (
    <div className="matrix" style={{ gridTemplateColumns: '120px repeat(4, 1fr)' }}>
      <div className="matrix__cell matrix__cell--head">P\C</div>
      {CAPTURE_OUTCOMES.map(co => (
        <div key={co} className="matrix__cell matrix__cell--head">{co}</div>
      ))}
      {PREDICTION_OUTCOMES.map(po => (
        <Fragment key={po}>
          <div className="matrix__cell matrix__cell--head">{po}</div>
          {CAPTURE_OUTCOMES.map(co => {
            const k: CellKey = `${po}+${co}`
            const isImpossible = IMPOSSIBLE.has(k)
            const count = counts[k] ?? 0
            if (isImpossible) {
              return (
                <div
                  key={k}
                  className="matrix__cell matrix__cell--impossible"
                  aria-disabled="true"
                  style={{ cursor: 'default' }}
                >
                  不可能
                </div>
              )
            }
            return (
              <div
                key={k}
                className="matrix__cell"
                role="button"
                tabIndex={0}
                onClick={() => onCellClick?.(k)}
                onKeyDown={handleKey(k)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ fontSize: 22, fontWeight: 600 }}>{count}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{po} / {co}</div>
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
