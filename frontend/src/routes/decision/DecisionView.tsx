import { PageHeader } from '@/components/PageHeader'

export function DecisionView() {
  return (
    <main className="workspace">
      <PageHeader title="决策者工作台" sub="批 / 驳 / 撤单 — 一键审批" />
      <div className="workspace__body">
        <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>📥 待批预测 Inbox(m2 实现)</div>
          <div>每条预测带置信度 + 一句话理由 + 一键批/驳。</div>
        </div>
      </div>
    </main>
  )
}
