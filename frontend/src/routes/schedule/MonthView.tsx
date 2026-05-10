import { useMemo } from 'react'
import { Btn } from '@/components/Btn'
import { StageDot } from '@/components/StageDot'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, monthGridRange, sameDay, weekdayLabel } from './dateUtils'

/**
 * 6 行 × 7 列日历,周一为周首。每格右上数字 = 当日 prediction 数,
 * 内部 StageDot 簇按状态色密度反映堆积。点击单 dot 弹详情 modal。
 * 非本月日灰显但仍 clickable,保持网格完整性。
 */
export function MonthView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const { cells } = monthGridRange(anchor)
  const byDay = useMemo(() => {
    const m = new Map<string, PredictionListItem[]>()
    for (const p of data) {
      const ymd = p.windowDate.slice(0, 10)
      const arr = m.get(ymd) ?? []
      arr.push(p)
      m.set(ymd, arr)
    }
    return m
  }, [data])

  const monthLabel = `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn size="sm" onClick={() => onAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>← 上月</Btn>
        <Btn size="sm" onClick={() => onAnchor(new Date())}>今日</Btn>
        <Btn size="sm" onClick={() => onAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>下月 →</Btn>
        <div style={{ fontSize: 16, fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{monthLabel}</div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 1,
        background: 'var(--c-line)',
        border: '1px solid var(--c-line)',
        borderRadius: 4,
      }}>
        {(['一','二','三','四','五','六','日']).map((d) => (
          <div key={d} style={{
            background: 'var(--c-panel-2)',
            padding: '6px 8px',
            fontSize: 11,
            color: 'var(--c-text-3)',
            textAlign: 'center',
            fontWeight: 500,
          }}>
            周{d}
          </div>
        ))}
        {cells.map((day) => {
          const ymd = formatYmd(day)
          const items = byDay.get(ymd) ?? []
          const inMonth = day.getMonth() === anchor.getMonth()
          const isToday = sameDay(day, new Date())
          return (
            <div key={ymd}
              style={{
                background: 'var(--c-panel)',
                padding: 6,
                minHeight: 84,
                opacity: inMonth ? 1 : 0.4,
                outline: isToday ? '2px solid var(--c-accent)' : 'none',
                outlineOffset: -2,
              }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 11, marginBottom: 4,
              }}>
                <span style={{ fontWeight: isToday ? 600 : 400 }}>{day.getDate()}</span>
                {items.length > 0 && (
                  <span style={{
                    color: 'var(--c-text-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{items.length}</span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {items.map((p) => (
                  <button key={p.id}
                    onClick={() => onOpen(p.id)}
                    title={`${p.windowHalf} · ${p.status} · 置信 ${p.confidenceNow}`}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    aria-label={`${weekdayLabel(day)} ${p.status}`}>
                    <StageDot status={p.status} />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
