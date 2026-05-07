import type { CSSProperties } from 'react'

export function ConfBar({ value, ci, showCI = false }: {
  value: number
  ci?: [number, number]
  showCI?: boolean
}) {
  const cls = value >= 65 ? 'is-high' : value >= 45 ? 'is-mid' : 'is-low'
  return (
    <span className={`cbar ${cls}`}>
      <span className="cbar__rail">
        <span className="cbar__fill" style={{ width: `${value}%` }} />
        {showCI && ci && (
          <span style={{
            position: 'absolute', height: '100%', top: 0,
            left: `${ci[0]}%`, width: `${ci[1] - ci[0]}%`,
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
          } satisfies CSSProperties} />
        )}
      </span>
      <span className="cbar__num">{value}</span>
    </span>
  )
}
