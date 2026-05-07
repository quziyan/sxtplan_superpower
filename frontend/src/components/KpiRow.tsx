import type { ReactNode } from 'react'

export type KpiTile = {
  label: string
  value: ReactNode
  delta?: { kind: 'up' | 'down'; text: string }
  sub?: ReactNode
}

export function KpiRow({ items }: { items: KpiTile[] }) {
  return (
    <div className="kpi-row">
      {items.map((it, i) => (
        <div key={i} className="kpi">
          <div className="kpi__label">{it.label}</div>
          <div className="kpi__value">
            {it.value}
            {it.delta && (
              <span className={`kpi__delta kpi__delta--${it.delta.kind}`}>
                {it.delta.kind === 'up' ? '↑' : '↓'}{it.delta.text}
              </span>
            )}
          </div>
          {it.sub && <div className="kpi__sub">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
