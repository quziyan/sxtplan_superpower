import { useEffect, useState } from 'react'
import { Btn } from '@/components/Btn'
import type { PredictionTableRow } from '@/components/PredictionTable'

/**
 * 编辑 PROPOSED prediction 的窗口(windowDate + windowHalf)。
 * 只允许改这两个字段;V/T/region 改了语义等于新预测,应该删了重建。
 */
export function EditPredictionModal({
  open, row, onClose, onSubmit,
}: {
  open: boolean
  row: PredictionTableRow | null
  onClose: () => void
  onSubmit: (patch: { windowDate?: string; windowHalf?: 'AM' | 'PM' }) => Promise<void>
}) {
  const [windowDate, setWindowDate] = useState('')
  const [windowHalf, setWindowHalf] = useState<'AM' | 'PM'>('AM')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (row) {
      setWindowDate(row.windowDate.slice(0, 10))
      setWindowHalf(row.windowHalf)
      setError(null)
    }
  }, [row])

  if (!open || !row) return null

  const onSave = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      setError('日期格式应为 YYYY-MM-DD')
      return
    }
    setSaving(true); setError(null)
    try {
      const patch: { windowDate?: string; windowHalf?: 'AM' | 'PM' } = {}
      if (windowDate !== row.windowDate.slice(0, 10)) patch.windowDate = windowDate
      if (windowHalf !== row.windowHalf) patch.windowHalf = windowHalf
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      await onSubmit(patch)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--c-bg-1)',
          border: '1px solid var(--c-border, #2a2f3a)',
          borderRadius: 8,
          padding: 'var(--sp-5)',
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, marginBottom: 'var(--sp-4)' }}>
          编辑预测窗口
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-4)' }}>
          预测 [{row.id.slice(0, 8)}] · {row.vehicleClassName} / {row.taskClassName} / {row.regionShortId}
        </div>

        <label style={{ display: 'block', marginBottom: 'var(--sp-3)' }}>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 4 }}>窗口日期</div>
          <input
            type="date"
            value={windowDate}
            onChange={(e) => setWindowDate(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'var(--c-panel-2)',
              border: '1px solid var(--c-border, #2a2f3a)',
              borderRadius: 4, color: 'inherit', fontSize: 'var(--fs-3)',
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 4 }}>半天</div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Btn
              variant={windowHalf === 'AM' ? 'primary' : 'ghost'}
              onClick={() => setWindowHalf('AM')}
            >上午 AM</Btn>
            <Btn
              variant={windowHalf === 'PM' ? 'primary' : 'ghost'}
              onClick={() => setWindowHalf('PM')}
            >下午 PM</Btn>
          </div>
        </label>

        {error && (
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-bad)', marginBottom: 'var(--sp-3)' }}>
            ✗ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
          <Btn onClick={onClose} disabled={saving}>取消</Btn>
          <Btn variant="primary" onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
