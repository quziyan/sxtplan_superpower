import { useState } from 'react'
import { PageHeader, Tabs } from '@/components'
import { ReportsTab } from './ReportsTab'
import { MatrixTab } from './MatrixTab'
import { CasesTab } from './CasesTab'

// Plan-C T30 / ISC-38 — Reviewer workspace.
// Three tabs per Plan-C §11 spec: Reports / Matrix / Cases. Each tab owns its own data
// fetching and lifecycle (mounted only when active) so we don't pre-fetch list+detail
// for tabs the reviewer never opens. Reviewer-role gating is handled at App.tsx; this
// component assumes the user is REVIEWER and passes `isReviewer={true}` through to the
// override-capable RetrospectiveCard.

type Tab = 'reports' | 'matrix' | 'cases'

export function ReviewerView() {
  const [tab, setTab] = useState<Tab>('reports')
  return (
    <main className="workspace">
      <PageHeader title="复盘师工作台" sub="单条复盘 → 二轴矩阵 → 案例库" />
      <div className="workspace__body">
        <Tabs<Tab>
          active={tab}
          onChange={setTab}
          items={[
            { key: 'reports', label: '复盘报告' },
            { key: 'matrix',  label: '二轴矩阵' },
            { key: 'cases',   label: '案例库'   },
          ]}
        />
        <div style={{ marginTop: 'var(--sp-5)' }}>
          {tab === 'reports' && <ReportsTab />}
          {tab === 'matrix'  && <MatrixTab />}
          {tab === 'cases'   && <CasesTab />}
        </div>
      </div>
    </main>
  )
}
