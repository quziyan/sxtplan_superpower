import { IconBtn } from '../IconBtn'
import { Brand } from './Brand'
import { RoleTabs, type RoleKey } from './RoleTabs'
import { UserPill } from './UserPill'

export function Topbar({ user, activeRole, availableRoles, onRoleChange, onLogout }: {
  user: { displayName: string | null; email: string }
  activeRole: RoleKey | null
  availableRoles: RoleKey[]
  onRoleChange: (k: RoleKey) => void
  onLogout: () => void
}) {
  return (
    <header className="topbar">
      <Brand />
      <RoleTabs active={activeRole} available={availableRoles} onChange={onRoleChange} />
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
