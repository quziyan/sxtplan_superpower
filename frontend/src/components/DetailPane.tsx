import { useEffect, type ReactNode } from 'react'
import { IconBtn } from './IconBtn'

export function DetailPane({ open, onClose, title, sub, children }: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  sub?: ReactNode
  children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="detail-pane" onClick={onClose}>
      <div className="detail-pane__panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 'var(--sp-5) var(--sp-6) var(--sp-3)', borderBottom: '1px solid var(--c-line)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {title && <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>}
            {sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-3)', marginTop: 4 }}>{sub}</div>}
          </div>
          <IconBtn icon="x" onClick={onClose} />
        </div>
        <div style={{ padding: 'var(--sp-5) var(--sp-6)', overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
