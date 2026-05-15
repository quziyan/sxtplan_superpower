import type React from 'react'
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

/**
 * 判断预测窗口是否已过期(早于今天 00:00 本地时区)。
 * windowDate 是 'YYYY-MM-DD' 格式,直接字符串比较即可(同格式 ISO 字典序 == 时间序)。
 */
export function isExpiredWindow(windowDate: string, windowHalf?: 'AM' | 'PM'): boolean {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const wd = windowDate.slice(0, 10)
  if (wd < todayStr) return true
  // 同一天:PM 比 AM 晚,粗略策略 — 不判过期(让用户在当天有完整推送窗口)
  return false
}

export function PredictionTable({ rows, activeId, onOpen, onEdit, onDelete, selectedIds, onToggleSelect, onToggleSelectAll }: {
  rows: PredictionTableRow[]
  activeId?: string | null
  onOpen?: (id: string) => void
  onEdit?: (row: PredictionTableRow) => void
  onDelete?: (row: PredictionTableRow) => void
  // 当传入这 3 个 prop 时启用「多选」列(checkbox);只对 status === 'PROPOSED' 的行可选
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (allSelected: boolean) => void
}) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-6)' }}>暂无预测</div>
  }
  const hasActions = !!(onEdit || onDelete)
  const hasSelect = !!(selectedIds && onToggleSelect)
  // Plan-PP fix12:过期(windowDate < today)的 PROPOSED 不可推送,从全选/可选集合里排除
  const selectableIds = rows
    .filter((r) => r.status === 'PROPOSED' && !isExpiredWindow(r.windowDate, r.windowHalf))
    .map((r) => r.id)
  const allSelected = hasSelect && selectableIds.length > 0 && selectableIds.every((id) => selectedIds!.has(id))
  const someSelected = hasSelect && selectableIds.some((id) => selectedIds!.has(id))
  return (
    <table className="table">
      <thead>
        <tr>
          {hasSelect && (
            <th style={{ width: 36 }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
                onChange={() => onToggleSelectAll?.(allSelected)}
                title={allSelected ? '取消全选' : '全选可推送 PROPOSED 行'}
              />
            </th>
          )}
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
          const expired = isExpiredWindow(r.windowDate, r.windowHalf)
          // 过期 PROPOSED 不可勾选(无法推送);其他状态本来就不可选
          const selectable = hasSelect && r.status === 'PROPOSED' && !expired
          const checked = selectable ? selectedIds!.has(r.id) : false
          const rowStyle: React.CSSProperties = expired
            ? { background: 'rgba(255,255,255,0.02)', color: 'var(--c-muted)', opacity: 0.55 }
            : {}
          const cellCursor: React.CSSProperties = { cursor: 'pointer' }
          return (
            <tr key={r.id} className={activeId === r.id ? 'active' : ''} style={rowStyle}>
              {hasSelect && (
                <td onClick={(e) => e.stopPropagation()}>
                  {selectable ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelect!(r.id)}
                    />
                  ) : expired ? (
                    <input type="checkbox" disabled title="过期预测不可推送" />
                  ) : null}
                </td>
              )}
              <td className="id-cell" onClick={() => onOpen?.(r.id)} style={cellCursor}>{shortId}</td>
              <td onClick={() => onOpen?.(r.id)} style={cellCursor}>{r.vehicleClassName}</td>
              <td onClick={() => onOpen?.(r.id)} style={cellCursor}>{r.taskClassName}</td>
              <td className="id-cell" onClick={() => onOpen?.(r.id)} style={cellCursor}>{r.regionShortId}</td>
              <td className="num" onClick={() => onOpen?.(r.id)} style={cellCursor}>{r.windowDate} {r.windowHalf}</td>
              <td className="num" onClick={() => onOpen?.(r.id)} style={cellCursor}>{r.kDays}</td>
              <td onClick={() => onOpen?.(r.id)} style={cellCursor}><ConfBar value={r.confidence} /></td>
              <td onClick={() => onOpen?.(r.id)} style={cellCursor}>
                {expired ? (
                  <span style={{
                    display: 'inline-block', padding: '2px 8px',
                    fontSize: 'var(--fs-1)', borderRadius: 3,
                    background: 'rgba(148,163,184,0.18)', color: 'var(--c-muted)',
                  }}>⌛ 过期</span>
                ) : (
                  <Status value={r.status} />
                )}
              </td>
              {hasActions && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onEdit && r.status === 'PROPOSED' && !expired && (
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
