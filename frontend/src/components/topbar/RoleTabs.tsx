import { Icon, type IconName } from '../Icon'

export type RoleKey = 'ANALYST' | 'DECIDER' | 'REVIEWER'
// Schedule / Admin 不是 role,是全局视图 tab。TabKey 覆盖 role + 'SCHEDULE' + 'ADMIN'。
export type TabKey = RoleKey | 'SCHEDULE' | 'ADMIN'

export type TabDef = {
  key: TabKey
  label: string
  sub: string
  icon: IconName
  /** alwaysVisible = true 时不受 availableRoles 过滤(Schedule 全局可见)。 */
  alwaysVisible?: boolean
}

export const DEFAULT_TABS: TabDef[] = [
  { key: 'ANALYST',  label: '分析师', sub: '监视 + 推送',  icon: 'eye' },
  { key: 'DECIDER',  label: '决策者', sub: '审批调度',      icon: 'check' },
  { key: 'REVIEWER', label: '复盘师', sub: '校准 + 沉淀',    icon: 'book' },
  { key: 'SCHEDULE', label: '日程',   sub: '全局视图',      icon: 'calendar', alwaysVisible: true },
  { key: 'ADMIN',    label: '后台',   sub: '数据维护',      icon: 'settings', alwaysVisible: true },
]

// 兼容旧名:DEFAULT_ROLES 仍可被既有引用使用,但新代码用 DEFAULT_TABS。
export const DEFAULT_ROLES = DEFAULT_TABS.filter((t) => t.key !== 'SCHEDULE') as Array<
  TabDef & { key: RoleKey }
>

export function ViewTabs({ active, available, onChange }: {
  active: TabKey | null
  available: RoleKey[]
  onChange: (k: TabKey) => void
}) {
  return (
    <div className="topbar__roles">
      {DEFAULT_TABS
        .filter((t) => t.alwaysVisible || available.includes(t.key as RoleKey))
        .map((t) => (
          <button key={t.key}
            className={`role-tab${active === t.key ? ' active' : ''}`}
            onClick={() => onChange(t.key)}>
            <Icon name={t.icon} size={13} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{t.label}</div>
              <div style={{ fontSize: 10, color: 'var(--c-text-3)', lineHeight: 1.2 }}>{t.sub}</div>
            </div>
          </button>
        ))}
    </div>
  )
}

// 兼容旧调用点:RoleTabs 名仍可用,内部委托给 ViewTabs。
export const RoleTabs = ViewTabs
