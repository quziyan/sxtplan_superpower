import { Btn } from './Btn'
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

export function PredictionTable({ rows, activeId, onOpen, onEdit, onDelete }: {
  rows: PredictionTableRow[]
  activeId?: string | null
  onOpen?: (id: string) => void
  onEdit?: (row: PredictionTableRow) => void
  onDelete?: (row: PredictionTableRow) => void
}) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无预测</div>
  }
  const hasActions = !!(onEdit || onDelete)
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
          {hasActions && <th style={{ width: 160 }}>操作</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const shortId = r.id.split('-').slice(-1)[0]?.slice(0, 6) ?? r.id.slice(0, 8)
          return (
            <tr key={r.id} className={activeId === r.id ? 'active' : ''}>
              <td className="id-cell" onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{shortId}</td>
              <td onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{r.vehicleClassName}</td>
              <td onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{r.taskClassName}</td>
              <td className="id-cell" onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{r.regionShortId}</td>
              <td className="num" onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{r.windowDate} {r.windowHalf}</td>
              <td className="num" onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}>{r.kDays}</td>
              <td onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}><ConfBar value={r.confidence} /></td>
              <td onClick={() => onOpen?.(r.id)} style={{ cursor: 'pointer' }}><Status value={r.status} /></td>
              {hasActions && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onEdit && r.status === 'PROPOSED' && (
                      <Btn size="sm" onClick={() => onEdit(r)}>编辑</Btn>
                    )}
                    {onDelete && r.status === 'PROPOSED' && (
                      <Btn size="sm" variant="danger" onClick={() => onDelete(r)}>删除</Btn>
                    )}
                  </div>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
