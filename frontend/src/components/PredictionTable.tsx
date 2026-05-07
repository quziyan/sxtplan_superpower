import { ConfBar } from './ConfBar'
import { Status, type PredictionStatus } from './Status'

export type PredictionTableRow = {
  id: string
  vehicleClassName: string
  taskClassName: string
  regionShortId: string  // 后 6 位或自定义
  windowDate: string
  windowHalf: 'AM' | 'PM'
  kDays: number
  confidence: number
  status: PredictionStatus
}

export function PredictionTable({ rows, activeId, onOpen }: {
  rows: PredictionTableRow[]
  activeId?: string | null
  onOpen?: (id: string) => void
}) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无预测</div>
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>ID</th>
          <th>车类</th>
          <th>任务</th>
          <th>区域</th>
          <th>窗口</th>
          <th>K</th>
          <th>置信度</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const shortId = r.id.split('-').slice(-1)[0]?.slice(0, 6) ?? r.id.slice(0, 8)
          return (
            <tr key={r.id} className={activeId === r.id ? 'active' : ''} onClick={() => onOpen?.(r.id)}>
              <td className="id-cell">{shortId}</td>
              <td>{r.vehicleClassName}</td>
              <td>{r.taskClassName}</td>
              <td className="id-cell">{r.regionShortId}</td>
              <td className="num">{r.windowDate} {r.windowHalf}</td>
              <td className="num">{r.kDays}</td>
              <td><ConfBar value={r.confidence} /></td>
              <td><Status value={r.status} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
