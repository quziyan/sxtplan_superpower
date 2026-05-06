import type { RoleKey } from '@/components/topbar/RoleTabs'
import { Topbar } from '@/components/topbar/Topbar'
import { useAuth } from '@/lib/useAuth'
import { Login } from '@/routes/Login'
import { AnalystView } from '@/routes/analyst/AnalystView'
import { DecisionView } from '@/routes/decision/DecisionView'
import { ReviewerView } from '@/routes/reviewer/ReviewerView'

export default function App() {
  const { state, refresh, switchRole, logout } = useAuth()

  if (state.status === 'loading') {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--c-text-3)' }}>
        加载中…
      </div>
    )
  }
  if (state.status === 'anonymous') return <Login onLoggedIn={refresh} />

  const { me } = state
  const role = me.activeRoleKey as RoleKey | null

  return (
    <div className="app">
      <Topbar
        user={me.user}
        activeRole={role}
        availableRoles={me.availableRoles as RoleKey[]}
        onRoleChange={switchRole}
        onLogout={logout}
      />
      <div className="app__body">
        {role === 'ANALYST'  && <AnalystView />}
        {role === 'DECIDER'  && <DecisionView />}
        {role === 'REVIEWER' && <ReviewerView />}
        {!role && (
          <div className="empty" style={{ marginTop: 'var(--sp-8)' }}>
            请在顶部选择一个角色态。可用角色:{me.availableRoles.join(', ') || '无'}。
          </div>
        )}
      </div>
    </div>
  )
}
