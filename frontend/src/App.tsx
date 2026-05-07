import { useState } from 'react'
import { DetailPane, PredictionDetail } from '@/components'
import { Topbar } from '@/components/topbar/Topbar'
import type { RoleKey } from '@/components/topbar/RoleTabs'
import { useAuth } from '@/lib/useAuth'
import { Login } from '@/routes/Login'
import { AnalystView } from '@/routes/analyst/AnalystView'
import { DecisionView } from '@/routes/decision/DecisionView'
import { ReviewerView } from '@/routes/reviewer/ReviewerView'

export default function App() {
  const { state, refresh, switchRole, logout } = useAuth()
  const [openPrediction, setOpenPrediction] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  if (state.status === 'loading') {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--c-text-3)' }}>加载中…</div>
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
      <div className="app__body" key={refreshKey}>
        {role === 'ANALYST'  && <AnalystView onOpenPrediction={setOpenPrediction} />}
        {role === 'DECIDER'  && <DecisionView onOpenPrediction={setOpenPrediction} />}
        {role === 'REVIEWER' && <ReviewerView />}
        {!role && (
          <div className="empty" style={{ marginTop: 'var(--sp-8)' }}>
            请在顶部选择一个角色态。可用角色:{me.availableRoles.join(', ') || '无'}。
          </div>
        )}
      </div>

      <DetailPane
        open={!!openPrediction}
        onClose={() => setOpenPrediction(null)}
        title="预测详情"
        sub={openPrediction}
      >
        {openPrediction && (
          <PredictionDetail
            predictionId={openPrediction}
            onMutated={() => {
              setOpenPrediction(null)
              setRefreshKey(k => k + 1)  // 强制重渲染当前角色视图
            }}
          />
        )}
      </DetailPane>
    </div>
  )
}
