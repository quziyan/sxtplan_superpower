import type { ReactNode } from 'react'

export function PageHeader({
  title,
  sub,
  actions,
  breadcrumbs,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  breadcrumbs?: ReactNode[]
}) {
  return (
    <div className="workspace__header">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>
            {breadcrumbs.map((b, i) => (
              <span key={i}>
                {i > 0 && <span style={{ margin: '0 6px' }}>/</span>}
                {b}
              </span>
            ))}
          </div>
        )}
        <div className="workspace__title">{title}</div>
        {sub && <div className="workspace__sub">{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  )
}
