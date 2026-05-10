import type { PredictionStatus } from './Status'

/**
 * 8px 圆点 + 阶段色,用于 MonthView 日历格子内的密度可视化。
 * 颜色一律走 --c-stage-* token,跨视图保持一致。
 */
export function StageDot({ status, size = 8, title }: {
  status: PredictionStatus
  size?: number
  title?: string
}) {
  return (
    <span
      className="stage-dot"
      title={title}
      style={{
        display: 'inline-block',
        width: size, height: size, borderRadius: '50%',
        backgroundColor: `var(--c-stage-${status.toLowerCase()})`,
      }}
    />
  )
}
