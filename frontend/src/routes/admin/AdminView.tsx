import { useState } from 'react'
import { PageHeader } from '@/components'
import { NewsItemsManager } from './NewsItemsManager'
import { VehicleClassManager } from './VehicleClassManager'

/**
 * Plan-PP follow-up:后台 tab — 数据维护中心。
 */
type SubTab = 'news_items' | 'vehicle_classes'

const SUB_TABS: Array<{ key: SubTab; label: string; sub: string }> = [
  { key: 'news_items', label: '🗞️ 入库去重库', sub: '管理 news_items + 关联证据' },
  { key: 'vehicle_classes', label: '🚗 车辆类型库', sub: '管理 + 关注 V 集合' },
]

export function AdminView() {
  const [tab, setTab] = useState<SubTab>('news_items')

  return (
    <div className="page" style={{ gridTemplateColumns: '1fr' }}>
      <main className="workspace">
        <PageHeader
          title="后台 · 数据维护"
          sub="管理员对底层数据(入库去重库等)的直接维护通道"
        />
        <div className="workspace__body">
          <div style={{
            display: 'flex', gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-4)',
            borderBottom: '1px solid var(--c-border, #2a2f3a)',
            paddingBottom: 'var(--sp-2)',
          }}>
            {SUB_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 14px',
                  background: tab === t.key ? 'var(--c-panel-2)' : 'transparent',
                  border: '1px solid',
                  borderColor: tab === t.key ? 'var(--c-accent, #4ea1ff)' : 'var(--c-border, #2a2f3a)',
                  borderRadius: 6,
                  color: tab === t.key ? 'var(--c-accent, #4ea1ff)' : 'inherit',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 'var(--fs-2)', fontWeight: 500 }}>{t.label}</div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>{t.sub}</div>
              </button>
            ))}
          </div>

          {tab === 'news_items' && <NewsItemsManager />}
          {tab === 'vehicle_classes' && <VehicleClassManager />}
        </div>
      </main>
    </div>
  )
}
