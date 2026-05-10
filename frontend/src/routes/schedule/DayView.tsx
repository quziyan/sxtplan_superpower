import { useMemo } from 'react'
import { Btn } from '@/components/Btn'
import { Status } from '@/components/Status'
import { ConfBar } from '@/components/ConfBar'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, predictionDisplayName } from './dateUtils'

/**
 * 单日视图 — AM section 左 / PM section 右,各自纵向 prediction 列表。
 * 每条左边 4px 状态色条(与 token 一致),整行可点开详情。
 */
export function DayView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const ymd = formatYmd(anchor)
  const am = useMemo(
    () => data.filter((p) => p.windowDate.slice(0, 10) === ymd && p.windowHalf === 'AM'),
    [data, ymd],
  )
  const pm = useMemo(
    () => data.filter((p) => p.windowDate.slice(0, 10) === ymd && p.windowHalf === 'PM'),
    [data, ymd],
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn size="sm" onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() - 1); onAnchor(d) }}>← 昨日</Btn>
        <Btn size="sm" onClick={() => onAnchor(new Date())}>今日</Btn>
        <Btn size="sm" onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() + 1); onAnchor(d) }}>明日 →</Btn>
        <div style={{ fontSize: 16, fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{ymd}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
        <Section title={`上午 AM · ${am.length}`} items={am} onOpen={onOpen} />
        <Section title={`下午 PM · ${pm.length}`} items={pm} onOpen={onOpen} />
      </div>
    </div>
  )
}

function Section({ title, items, onOpen }: {
  title: string
  items: PredictionListItem[]
  onOpen: (id: string) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 'var(--sp-2)' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0
          ? <div className="empty" style={{ padding: 'var(--sp-4)' }}>暂无</div>
          : items.map((p) => <Row key={p.id} p={p} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

function Row({ p, onOpen }: { p: PredictionListItem; onOpen: (id: string) => void }) {
  const colorVar = `var(--c-stage-${p.status.toLowerCase()})`
  const name = predictionDisplayName(p)
  // 副标题:车类 · 任务 · 区域(若有)— V/T 已经体现在 sourceName 里时省略,
  // 但补 region 信息对调度判断有用。
  const subParts: string[] = []
  if (p.vehicleClassName && p.taskClassName && p.sourceName && p.sourceName !== `${p.vehicleClassName} · ${p.taskClassName}`) {
    subParts.push(`${p.vehicleClassName} · ${p.taskClassName}`)
  }
  if (p.regionName) subParts.push(p.regionName)
  subParts.push(`K=${p.kDays}`)
  return (
    <button
      type="button"
      onClick={() => onOpen(p.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 1fr auto auto',
        gap: 12, alignItems: 'center', width: '100%', textAlign: 'left',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-line)',
        borderLeft: 'none',
        borderRadius: 3,
        padding: '8px 12px',
        cursor: 'pointer',
        color: 'inherit',
      }}>
      <div style={{
        width: 4, height: 36,
        background: colorVar,
        borderTopLeftRadius: 3,
        borderBottomLeftRadius: 3,
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
          {subParts.join(' · ')}
        </div>
      </div>
      <ConfBar value={p.confidenceNow} />
      <Status value={p.status} />
    </button>
  )
}
