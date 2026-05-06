import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'

type Tab = 'reports' | 'matrix' | 'cases' | 'patterns'

export function ReviewerView() {
  const [tab, setTab] = useState<Tab>('reports')
  return (
    <main className="workspace">
      <PageHeader title="复盘师工作台" sub="单条复盘 → 二轴矩阵 → 规律 → 案例库" />
      <div className="workspace__body">
        <Tabs<Tab> active={tab} onChange={setTab} items={[
          { key: 'reports', label: '复盘报告' },
          { key: 'matrix', label: '二轴矩阵' },
          { key: 'patterns', label: '规律' },
          { key: 'cases', label: '案例库' },
        ]} />
        <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
          (m3 Plan-C 实装具体内容)
        </div>
      </div>
    </main>
  )
}
