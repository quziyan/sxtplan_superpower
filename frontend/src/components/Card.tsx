import type { ReactNode } from 'react'

export function Card({
  title,
  sub,
  action,
  children,
}: {
  title?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="card__header">
          <div>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className="card__body">{children}</div>
    </div>
  )
}
