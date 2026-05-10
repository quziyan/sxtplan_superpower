import { useMemo, Fragment } from 'react'
import { Btn } from '@/components/Btn'
import { StageChip } from '@/components/StageChip'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, predictionDisplayName, sameDay, weekRange } from './dateUtils'

/**
 * 7 列(周一-周日) × 2 行(AM / PM)半天网格。每格内是 StageChip 列表,
 * 点击 chip 弹详情。今日列高亮 outline。
 */
export function WeekView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const { days } = weekRange(anchor)
  const byHalf = useMemo(() => {
    const m = new Map<string, PredictionListItem[]>()
    for (const p of data) {
      const key = `${p.windowDate.slice(0, 10)}_${p.windowHalf}`
      const arr = m.get(key) ?? []
      arr.push(p)
      m.set(key, arr)
    }
    return m
  }, [data])

  const weekLabel = `${formatYmd(days[0]!)} ~ ${formatYmd(days[6]!)}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn size="sm" onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() - 7); onAnchor(d) }}>← 上周</Btn>
        <Btn size="sm" onClick={() => onAnchor(new Date())}>本周</Btn>
        <Btn size="sm" onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() + 7); onAnchor(d) }}>下周 →</Btn>
        <div style={{ fontSize: 16, fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{weekLabel}</div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '60px repeat(7, 1fr)',
        gap: 1,
        background: 'var(--c-line)',
        border: '1px solid var(--c-line)',
        borderRadius: 4,
      }}>
        <div style={{ background: 'var(--c-panel-2)' }} />
        {days.map((d) => (
          <div key={`head-${formatYmd(d)}`} style={{
            background: 'var(--c-panel-2)',
            padding: '6px 4px',
            fontSize: 11,
            color: 'var(--c-text-3)',
            textAlign: 'center',
            outline: sameDay(d, new Date()) ? '2px solid var(--c-accent)' : 'none',
            outlineOffset: -2,
          }}>
            <div style={{ fontWeight: 500 }}>周{['一','二','三','四','五','六','日'][((d.getDay()+6)%7)]}</div>
            <div style={{ fontSize: 10, marginTop: 2 }}>{d.getMonth() + 1}/{d.getDate()}</div>
          </div>
        ))}
        {(['AM', 'PM'] as const).map((half) => (
          <Fragment key={`row-${half}`}>
            <div style={{
              background: 'var(--c-panel-2)',
              padding: 8,
              fontSize: 11,
              color: 'var(--c-text-3)',
              textAlign: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {half === 'AM' ? '上午' : '下午'}
            </div>
            {days.map((d) => {
              const items = byHalf.get(`${formatYmd(d)}_${half}`) ?? []
              return (
                <div key={`cell-${formatYmd(d)}-${half}`} style={{
                  background: 'var(--c-panel)',
                  padding: 4,
                  minHeight: 110,
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {items.map((p) => (
                    <StageChip key={p.id}
                      status={p.status}
                      label={predictionDisplayName(p)}
                      sub={`置信 ${p.confidenceNow}`}
                      onClick={() => onOpen(p.id)}
                    />
                  ))}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
