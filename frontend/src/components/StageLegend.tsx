import type { PredictionStatus } from './Status'

const LEGEND: Array<{ status: PredictionStatus; label: string }> = [
  { status: 'PROPOSED',   label: '待审' },
  { status: 'VALIDATED',  label: '已推送' },
  { status: 'APPROVED',   label: '已批准' },
  { status: 'REJECTED',   label: '已驳回' },
  { status: 'DISPATCHED', label: '已调度' },
  { status: 'COMPLETED',  label: '已完成' },
  { status: 'EXPIRED',    label: '已过期' },
]

/**
 * 横向阶段色卡 — 在 Schedule 各子视图顶端展示统一图例,
 * 让用户一眼对齐颜色和阶段语义。
 */
export function StageLegend() {
  return (
    <div className="stage-legend" style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
    }}>
      {LEGEND.map(({ status, label }) => (
        <div key={status} className="stage-legend__item" style={{
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            backgroundColor: `var(--c-stage-${status.toLowerCase()})`,
          }} />
          <span style={{ fontSize: 11, color: 'var(--c-text-2)' }}>{label}</span>
        </div>
      ))}
    </div>
  )
}
