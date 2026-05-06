import { Btn } from '@/components/Btn'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/PageHeader'

export function AnalystView() {
  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>监视清单</span>
            <button title="新建监视清单"><Icon name="plus" size={12} /></button>
          </div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(m2 实现:监视清单 CRUD)</div>
        </div>
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>任务卡(即时查询)</span>
            <button title="新建任务卡" disabled><Icon name="plus" size={12} /></button>
          </div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(m2 实现)</div>
        </div>
        <div className="sidebar__group">
          <div className="sidebar__heading">区域</div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(已具备 API,UI 列表 m2 实现)</div>
        </div>
      </aside>

      <main className="workspace">
        <PageHeader
          title="分析师工作台"
          sub="监视新闻信号 → 审证据 → 调置信度 → 推送给决策者"
          actions={<>
            <Btn disabled><Icon name="refresh" size={12} />立即重算</Btn>
            <Btn variant="primary" disabled><Icon name="plus" size={12} />新建任务卡</Btn>
          </>}
        />
        <div className="workspace__body">
          <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>m1 视觉外壳就绪</div>
            <div>预测列表 / KPI / 监视清单交互在 m2(Plan-B)实装。</div>
          </div>
        </div>
      </main>
    </div>
  )
}
