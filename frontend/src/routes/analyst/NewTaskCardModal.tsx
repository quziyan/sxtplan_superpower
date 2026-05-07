import { useEffect, useState } from 'react'
import { listTaskClasses, listVehicleClasses, type TaskClass, type VehicleClass } from '@/lib/taxonomy-api'
import { listRegions, type RegionListItem } from '@/lib/region-api'
import { createTaskCard } from '@/lib/taskcard-api'

// Plan-C T32 / ISC-40: 新建任务卡 modal for ANALYST role.
// Form: name + V (vehicleClass) + T (taskClass) + R (named region) + targetWindowDate + half (AM/PM).
// Mirrors NewWatchListModal (T31) closely — same dropdown loading, same composite-key region encoding,
// same .modal-backdrop / .modal / .modal__actions / .alert--error CSS classes. The K range is replaced
// with a single concrete target half-day window because a 任务卡 is one-shot (single targeted prediction)
// rather than a recurring monitor.
//
// On submit: validate inline, POST /taskcards, fire onCreated so the parent can refetch, then close +
// reset state. targetWindowDate uses HTML <input type="date"> which already returns YYYY-MM-DD strings,
// so we pass the value through as-is. windowHalf uses a select to match existing form patterns.

type Option = { value: string; label: string }

// Presents level-1 entries first, then their level-2 children indented under
// each parent. Falls back to a flat alphabetical list if level/parent metadata
// is missing for some rows.
function buildClassOptions(rows: ReadonlyArray<VehicleClass | TaskClass>): Option[] {
  const level1 = rows.filter((r) => r.level === 1)
  const level2 = rows.filter((r) => r.level === 2)
  const orphans = rows.filter((r) => r.level !== 1 && r.level !== 2)
  const out: Option[] = []
  for (const p of level1) {
    out.push({ value: p.id, label: p.name })
    const kids = level2.filter((c) => c.parentId === p.id)
    for (const k of kids) {
      out.push({ value: k.id, label: `  └ ${k.name}` })
    }
  }
  // Level-2 rows whose parent is missing from the response — list them flat
  // at the bottom rather than dropping them silently.
  const seen = new Set(out.map((o) => o.value))
  for (const r of [...level2, ...orphans]) {
    if (!seen.has(r.id)) out.push({ value: r.id, label: r.name })
  }
  return out
}

function buildRegionOptions(rows: ReadonlyArray<RegionListItem>): Option[] {
  return rows.map((r) => ({
    value: `${r.id}@${r.version}`,
    label: r.name ?? `(未命名 ${r.id.slice(0, 8)})`,
  }))
}

// Default target = tomorrow (YYYY-MM-DD). Reasonable for a forward-looking task card.
function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function NewTaskCardModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}) {
  const [name, setName] = useState('')
  const [vehicleClassId, setVehicleClassId] = useState('')
  const [taskClassId, setTaskClassId] = useState('')
  // regionPick encodes both id and current version as `${id}@${version}` so
  // the backend createTaskCard payload (which requires regionVersion) stays
  // consistent with the row the analyst actually selected.
  const [regionPick, setRegionPick] = useState('')
  const [targetWindowDate, setTargetWindowDate] = useState(tomorrowIso())
  const [targetWindowHalf, setTargetWindowHalf] = useState<'AM' | 'PM'>('AM')

  const [vehicleOpts, setVehicleOpts] = useState<Option[]>([])
  const [taskOpts, setTaskOpts] = useState<Option[]>([])
  const [regionOpts, setRegionOpts] = useState<Option[]>([])

  const [loadingOpts, setLoadingOpts] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load taxonomy + region options each time the modal opens. Cheap (3 GETs,
  // small payloads) and avoids stale dropdowns if the analyst created a new
  // class/region in another tab between opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingOpts(true)
    setError(null)
    Promise.all([listVehicleClasses(), listTaskClasses(), listRegions()])
      .then(([vs, ts, rs]) => {
        if (cancelled) return
        setVehicleOpts(buildClassOptions(vs))
        setTaskOpts(buildClassOptions(ts))
        setRegionOpts(buildRegionOptions(rs))
      })
      .catch((e: Error) => { if (!cancelled) setError(`加载选项失败:${e.message}`) })
      .finally(() => { if (!cancelled) setLoadingOpts(false) })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const reset = () => {
    setName('')
    setVehicleClassId('')
    setTaskClassId('')
    setRegionPick('')
    setTargetWindowDate(tomorrowIso())
    setTargetWindowHalf('AM')
    setError(null)
  }

  const close = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const validate = (): string | null => {
    if (!name.trim()) return '请填写名称'
    if (!vehicleClassId) return '请选择车辆类别'
    if (!taskClassId) return '请选择任务类别'
    if (!regionPick) return '请选择区域'
    if (!targetWindowDate) return '请选择目标日期'
    // Sanity-check the YYYY-MM-DD shape <input type="date"> should already enforce.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetWindowDate)) return '目标日期格式无效'
    if (targetWindowHalf !== 'AM' && targetWindowHalf !== 'PM') return '请选择半天'
    return null
  }

  const submit = async () => {
    const err = validate()
    if (err) { setError(err); return }
    const [regionId, regionVersionRaw] = regionPick.split('@')
    const regionVersion = Number.parseInt(regionVersionRaw ?? '', 10)
    if (!regionId || !Number.isFinite(regionVersion) || regionVersion < 1) {
      setError('区域选择无效')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createTaskCard({
        name: name.trim(),
        vehicleClassId,
        taskClassId,
        regionId,
        regionVersion,
        targetWindowDate,
        targetWindowHalf,
      })
      reset()
      onCreated?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">新建任务卡</h3>
        <p className="text-muted">
          按 V(车辆类别) / T(任务类别) / R(区域)/ 目标日期 + 半天定义一次性预测任务。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>名称</span>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如:朝阳区-货运-周一早高峰"
              disabled={submitting}
              autoFocus
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>车辆类别 (V)</span>
            <select
              className="select"
              value={vehicleClassId}
              onChange={(e) => setVehicleClassId(e.target.value)}
              disabled={submitting || loadingOpts}
            >
              <option value="">{loadingOpts ? '加载中…' : '请选择'}</option>
              {vehicleOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>任务类别 (T)</span>
            <select
              className="select"
              value={taskClassId}
              onChange={(e) => setTaskClassId(e.target.value)}
              disabled={submitting || loadingOpts}
            >
              <option value="">{loadingOpts ? '加载中…' : '请选择'}</option>
              {taskOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>区域 (R, 命名区域)</span>
            <select
              className="select"
              value={regionPick}
              onChange={(e) => setRegionPick(e.target.value)}
              disabled={submitting || loadingOpts}
            >
              <option value="">{loadingOpts ? '加载中…' : '请选择'}</option>
              {regionOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>目标窗口</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <input
                className="input"
                type="date"
                value={targetWindowDate}
                onChange={(e) => setTargetWindowDate(e.target.value)}
                disabled={submitting}
                style={{ width: 160 }}
                aria-label="目标日期"
              />
              <select
                className="select"
                value={targetWindowHalf}
                onChange={(e) => setTargetWindowHalf(e.target.value === 'PM' ? 'PM' : 'AM')}
                disabled={submitting}
                style={{ width: 80 }}
                aria-label="半天"
              >
                <option value="AM">上午</option>
                <option value="PM">下午</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="alert alert--error" style={{ marginTop: 'var(--sp-3)' }}>{error}</div>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={close} disabled={submitting}>
            取消
          </button>
          <button
            className="btn btn--primary"
            onClick={submit}
            disabled={submitting || loadingOpts}
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
