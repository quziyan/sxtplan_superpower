import type { ConfidenceSnapshot } from '@/lib/prediction-api'

export function ConfidenceTimeline({
  snapshots, threshold = 70,
}: { snapshots: ConfidenceSnapshot[]; threshold?: number }) {
  if (snapshots.length === 0) {
    return <div className="ctl"><div className="empty">无置信度历史</div></div>
  }
  const W = 600
  const H = 180
  const PAD_L = 36, PAD_R = 8, PAD_B = 24, PAD_T = 8
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const xs = snapshots.map((_, i) =>
    snapshots.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (snapshots.length - 1)) * innerW)
  const ys = snapshots.map(s => PAD_T + (1 - s.confidence / 100) * innerH)

  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ')
  const thresholdY = PAD_T + (1 - threshold / 100) * innerH

  const colorFor = (kind: ConfidenceSnapshot['kind']) =>
    kind === 'FULL' ? 'var(--c-accent)'
      : kind === 'MANUAL' ? 'var(--c-warn)'
      : 'var(--c-text-2)'

  return (
    <div className="ctl">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
        {/* Y-axis labels */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = PAD_T + (1 - v / 100) * innerH
          return (
            <g key={v}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--c-line)" strokeDasharray="2,2" />
              <text x={PAD_L - 4} y={y + 3} fontSize={10} fill="var(--c-text-3)" textAnchor="end">{v}</text>
            </g>
          )
        })}
        {/* Threshold line */}
        <line x1={PAD_L} y1={thresholdY} x2={W - PAD_R} y2={thresholdY}
              stroke="var(--c-warn)" strokeDasharray="3,3" opacity={0.55} />
        <text x={W - PAD_R - 2} y={thresholdY - 4} fontSize={10} fill="var(--c-warn)" textAnchor="end">阈值 {threshold}</text>
        {/* Path */}
        <path d={path} fill="none" stroke="var(--c-accent)" strokeWidth={1.8} />
        {/* Points */}
        {xs.map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={ys[i]} r={4} fill={colorFor(snapshots[i]!.kind)}>
              <title>{`${snapshots[i]!.kind} · ${snapshots[i]!.confidence} · ${snapshots[i]!.occurredAt.slice(0, 16)}`}</title>
            </circle>
          </g>
        ))}
        {/* X-axis dates: first + last */}
        {snapshots.length >= 1 && (
          <text x={xs[0]} y={H - PAD_B + 14} fontSize={10} fill="var(--c-text-3)" textAnchor="start">
            {snapshots[0]!.occurredAt.slice(5, 10)}
          </text>
        )}
        {snapshots.length >= 2 && (
          <text x={xs[xs.length - 1]} y={H - PAD_B + 14} fontSize={10} fill="var(--c-text-3)" textAnchor="end">
            {snapshots[snapshots.length - 1]!.occurredAt.slice(5, 10)}
          </text>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 11, color: 'var(--c-text-3)', padding: '0 var(--sp-5) var(--sp-3)' }}>
        <span>● <span style={{ color: 'var(--c-accent)' }}>FULL</span> 全量重算锚点</span>
        <span>● <span style={{ color: 'var(--c-text-2)' }}>INCR</span> 增量更新</span>
        <span>● <span style={{ color: 'var(--c-warn)' }}>MANUAL</span> 人工微调</span>
      </div>
    </div>
  )
}
