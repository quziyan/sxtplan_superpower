import type { PredictionStatus } from './Status'

/**
 * 紧凑色块卡片,用于 WeekView 半天格子内显示 prediction。
 * 左边一道 4px 色条 + 浅色背景(color-mix),颜色一律走 stage token。
 */
export function StageChip({ status, label, sub, onClick }: {
  status: PredictionStatus
  label: string
  sub?: string
  onClick?: () => void
}) {
  const colorVar = `var(--c-stage-${status.toLowerCase()})`
  return (
    <button
      type="button"
      className="stage-chip"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '6px 8px',
        borderLeft: `4px solid ${colorVar}`,
        background: `color-mix(in srgb, ${colorVar} 12%, var(--c-panel))`,
        border: '1px solid var(--c-line, #2a3445)',
        borderLeftWidth: 4,
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        color: 'inherit',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--c-text-3)', lineHeight: 1.2, marginTop: 2 }}>{sub}</div>
      )}
    </button>
  )
}
