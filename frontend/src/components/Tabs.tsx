import type { ReactNode } from 'react'

export function Tabs<K extends string>({
  active,
  onChange,
  items,
}: {
  active: K
  onChange: (k: K) => void
  items: { key: K; label: ReactNode }[]
}) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button
          key={it.key}
          className={`tabs__btn${active === it.key ? ' active' : ''}`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
