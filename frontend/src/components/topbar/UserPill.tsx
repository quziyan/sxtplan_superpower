import { DEFAULT_ROLES, type RoleKey } from './RoleTabs'

export function UserPill({ displayName, email, activeRole }: {
  displayName: string | null; email: string; activeRole: RoleKey | null
}) {
  const roleDef = DEFAULT_ROLES.find((r) => r.key === activeRole)
  const accent = activeRole === 'DECIDER' ? 'var(--c-warn)'
              : activeRole === 'REVIEWER' ? 'var(--c-info)'
              : 'var(--c-accent)'
  const initial = (displayName ?? email)[0]?.toUpperCase() ?? '?'
  return (
    <div className="user-pill">
      <span className="user-pill__avatar" style={{ background: accent }}>{initial}</span>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 500 }}>{displayName ?? email}</div>
        <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{roleDef ? `${roleDef.label}态` : '未选角色'}</div>
      </div>
    </div>
  )
}
