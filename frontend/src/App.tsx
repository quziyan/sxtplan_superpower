import { useEffect, useState } from 'react'
import { DetailPane, PredictionDetail } from '@/components'
import { Topbar } from '@/components/topbar/Topbar'
import type { RoleKey, TabKey } from '@/components/topbar/RoleTabs'
import { useAuth } from '@/lib/useAuth'
import { Login } from '@/routes/Login'
import { AnalystView } from '@/routes/analyst/AnalystView'
import { DecisionView } from '@/routes/decision/DecisionView'
import { ReviewerView } from '@/routes/reviewer/ReviewerView'
import { ScheduleView } from '@/routes/schedule/ScheduleView'
import { AdminView } from '@/routes/admin/AdminView'

export default function App() {
  const { state, refresh, switchRole, logout } = useAuth()
  const [openPrediction, setOpenPrediction] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // activeTab 与 me.activeRoleKey 分离 — Schedule 是 view 不是 role。
  // Schedule 不调 switchRole,用户角色不变。切回 role tab 才同步 server side。
  const [activeTab, setActiveTab] = useState<TabKey | null>(null)

  // 首次认证完成时,activeTab 默认跟随用户的 activeRoleKey;
  // 没角色的用户(罕见)默认进 SCHEDULE,因为它不依赖 role。
  useEffect(() => {
    if (state.status !== 'authed' || activeTab !== null) return
    const role = state.me.activeRoleKey as RoleKey | null
    setActiveTab(role ?? 'SCHEDULE')
  }, [state.status])

  if (state.status === 'loading') {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--c-text-3)' }}>加载中…</div>
  }
  if (state.status === 'anonymous') return <Login onLoggedIn={refresh} />

  const { me } = state
  const activeRole = me.activeRoleKey as RoleKey | null

  const onTabChange = (k: TabKey) => {
    setActiveTab(k)
    if (k !== 'SCHEDULE' && k !== 'ADMIN') {
      // 切到一个真实 role tab → 同步切角色态(走原 switchRole 流程)
      switchRole(k)
    }
    // SCHEDULE / ADMIN: 不动 me.activeRoleKey,纯前端视图切换
  }

  return (
    <div className="app">
      <Topbar
        user={me.user}
        activeTab={activeTab}
        availableRoles={me.availableRoles as RoleKey[]}
        onTabChange={onTabChange}
        onLogout={logout}
        activeRole={activeRole}
      />
      <div className="app__body">
        {activeTab === 'ANALYST'  && <AnalystView  onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
        {activeTab === 'DECIDER'  && <DecisionView onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
        {activeTab === 'REVIEWER' && <ReviewerView />}
        {activeTab === 'SCHEDULE' && <ScheduleView onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
        {activeTab === 'ADMIN' && <AdminView />}
        {!activeTab && (
          <div className="empty" style={{ marginTop: 'var(--sp-8)' }}>
            请在顶部选择一个视图。可用角色:{me.availableRoles.join(', ') || '无'}。
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
            // role-gated 操作按钮按用户真实 role 渲染,与 Schedule view 无关
            activeRole={activeRole}
            onMutated={() => {
              setRefreshKey((k) => k + 1)
            }}
          />
        )}
      </DetailPane>
    </div>
  )
}
