import { IconBtn } from '../IconBtn'
import { Brand } from './Brand'
import { ViewTabs, type RoleKey, type TabKey } from './RoleTabs'
import { UserPill } from './UserPill'

/**
 * Topbar 现在有 4 个 tab:Analyst / Decider / Reviewer / Schedule。
 * Schedule 全局可见 = 任何登录用户都看得到;点击不切 role,仅切视图。
 */
export function Topbar({ user, activeTab, availableRoles, onTabChange, onLogout, activeRole }: {
  user: { displayName: string | null; email: string }
  activeTab: TabKey | null
  availableRoles: RoleKey[]
  onTabChange: (k: TabKey) => void
  onLogout: () => void
  /** 用户真实角色态(独立于 activeTab) — 给 UserPill 显示用 */
  activeRole: RoleKey | null
}) {
  return (
    <header className="topbar">
      <Brand />
      <ViewTabs active={activeTab} available={availableRoles} onChange={onTabChange} />
      <div className="topbar__actions">
        <IconBtn icon="search" title="搜索 ⌘K" />
        <IconBtn icon="bell" title="通知" dot />
        <IconBtn icon="info" title="模式信息" />
        <UserPill displayName={user.displayName} email={user.email} activeRole={activeRole} />
        <IconBtn icon="x" title="登出" onClick={onLogout} />
      </div>
    </header>
  )
}
