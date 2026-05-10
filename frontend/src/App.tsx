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
      <div className="app__body">
        {/* 修:不再用 key={refreshKey} 强制重挂载;改成把 mutationVersion 作为
            prop 传给每个角色视图,它们用 useEffect deps 触发自己的 refetch。
            DOM 节点稳定 → 详情页 + 滚动位置 + 输入焦点都不丢。*/}
        {role === 'ANALYST'  && <AnalystView  onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
        {role === 'DECIDER'  && <DecisionView onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
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
            activeRole={role}
            onMutated={() => {
              // 修(#3):不再关闭详情页,只 bump 信号让父级 list 知道刷
              // PredictionDetail 自己 setData 已经在原地更新展示
              setRefreshKey(k => k + 1)
            }}
          />
        )}
      </DetailPane>
    </div>
  )
}
