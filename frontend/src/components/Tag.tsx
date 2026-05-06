import type { ReactNode } from 'react'

type TagKind = 'default' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'ghost'

export function Tag({ children, kind = 'default' }: { children: ReactNode; kind?: TagKind }) {
  return <span className={`tag${kind !== 'default' ? ` tag--${kind}` : ''}`}>{children}</span>
}
