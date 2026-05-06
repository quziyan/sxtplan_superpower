import { Icon, type IconName } from '../Icon'

export type RoleKey = 'ANALYST' | 'DECIDER' | 'REVIEWER'

export type RoleDef = { key: RoleKey; label: string; sub: string; icon: IconName }

export const DEFAULT_ROLES: RoleDef[] = [
  { key: 'ANALYST',  label: '分析师', sub: '监视 + 推送',     icon: 'eye' },
  { key: 'DECIDER',  label: '决策者', sub: '审批调度',         icon: 'check' },
  { key: 'REVIEWER', label: '复盘师', sub: '校准 + 沉淀',       icon: 'book' },
]

export function RoleTabs({ active, available, onChange }: {
  active: RoleKey | null
  available: RoleKey[]
  onChange: (k: RoleKey) => void
}) {
  return (
    <div className="topbar__roles">
      {DEFAULT_ROLES.filter((r) => available.includes(r.key)).map((r) => (
        <button key={r.key}
          className={`role-tab${active === r.key ? ' active' : ''}`}
          onClick={() => onChange(r.key)}>
          <Icon name={r.icon} size={13} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', lineHeight: 1.2 }}>{r.sub}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
