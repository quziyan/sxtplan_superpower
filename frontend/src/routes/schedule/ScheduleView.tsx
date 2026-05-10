import { useEffect, useState } from 'react'
import { StageLegend } from '@/components/StageLegend'
import { Btn } from '@/components/Btn'
import { useScheduleData } from './useScheduleData'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { DayView } from './DayView'
import { bigDateLabel } from './dateUtils'

type SubTab = 'month' | 'week' | 'day'

const SUBTABS: Array<{ key: SubTab; label: string }> = [
  { key: 'month', label: '月视图' },
  { key: 'week',  label: '周视图' },
  { key: 'day',   label: '日视图' },
]

/**
 * Schedule tab 容器 — 跨角色全局视图。
 * - 三子视图共享一次 fetch(useScheduleData,按月范围)。
 * - subtab + anchor 持久化到 sessionStorage,刷新不丢上下文。
 * - 点击任一 prediction → 上抛 onOpenPrediction → App 顶层 DetailPane 打开。
 */
export function ScheduleView({ onOpenPrediction, mutationVersion }: {
  onOpenPrediction: (id: string) => void
  mutationVersion: number
}) {
  const [subtab, setSubtab] = useState<SubTab>(() => {
    const saved = (typeof window !== 'undefined' && sessionStorage.getItem('schedule:subtab')) as SubTab | null
    return saved && SUBTABS.some((s) => s.key === saved) ? saved : 'month'
  })
  const [anchor, setAnchor] = useState<Date>(() => {
    const saved = typeof window !== 'undefined' ? sessionStorage.getItem('schedule:anchor') : null
    const d = saved ? new Date(saved) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
  })

  useEffect(() => { sessionStorage.setItem('schedule:subtab', subtab) }, [subtab])
  useEffect(() => { sessionStorage.setItem('schedule:anchor', anchor.toISOString()) }, [anchor])

  const data = useScheduleData(anchor, mutationVersion)

  return (
    <div className="workspace" style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
    }}>
      <div style={{
        padding: 'var(--sp-5) var(--sp-4) var(--sp-3)',
        display: 'flex', alignItems: 'baseline', gap: 'var(--sp-4)', flexWrap: 'wrap',
      }}>
        <div style={{
          fontSize: 36,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.5,
          color: 'var(--c-text)',
        }}>
          {bigDateLabel(new Date())}
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
          日程 · 全局视图 · 跨角色 prediction 时间分布
        </div>
      </div>
      <div style={{
        display: 'flex', gap: 'var(--sp-3)', alignItems: 'center',
        padding: '0 var(--sp-4) var(--sp-3)',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {SUBTABS.map((t) => (
            <Btn key={t.key}
              variant={subtab === t.key ? 'primary' : 'ghost'}
              onClick={() => setSubtab(t.key)}>
              {t.label}
            </Btn>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <StageLegend />
      </div>
      <div style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        padding: '0 var(--sp-4) var(--sp-4)',
      }} data-active-subtab={subtab}>
        {data.loading && <div className="empty" style={{ padding: 'var(--sp-6)' }}>加载中…</div>}
        {data.error && <div className="empty" style={{ padding: 'var(--sp-6)', color: 'var(--c-bad)' }}>加载失败:{data.error}</div>}
        {!data.loading && !data.error && (
          <>
            {subtab === 'month' && <MonthView data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
            {subtab === 'week'  && <WeekView  data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
            {subtab === 'day'   && <DayView   data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
          </>
        )}
      </div>
    </div>
  )
}
