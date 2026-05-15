import { useState } from 'react'
import { createWatchList } from '@/lib/watchlist-api'

/**
 * Plan-PP fix:简化为「监视清单 = 名称 + 搜索关键词」。V/T/R/K 不暴露给用户,
 * 后端用「通用车辆 / 通用任务 / 通用区域」兜底,K 默认 1-14 天。
 *
 * 表单字段:
 *   - 名称(必填,1-100 字符)
 *   - 搜索关键词(可选,≤20 个,每个 ≤60 字符;每行一个或逗号分隔;空 = 派生 fallback)
 */
export function NewWatchListModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}) {
  const [name, setName] = useState('')
  const [keywordsRaw, setKeywordsRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const parseKeywords = (): string[] =>
    keywordsRaw.split(/[\n,，]/).map((s) => s.trim()).filter((s) => s.length > 0)

  const reset = () => {
    setName('')
    setKeywordsRaw('')
    setError(null)
  }
  const close = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const submit = async () => {
    const n = name.trim()
    if (!n) { setError('请填写名称'); return }
    if (n.length > 100) { setError('名称最长 100 字符'); return }
    const kws = parseKeywords()
    if (kws.length > 20) { setError('关键词最多 20 个'); return }
    if (kws.some((k) => k.length > 60)) { setError('每个关键词最长 60 字符'); return }

    setSubmitting(true)
    setError(null)
    try {
      await createWatchList({
        name: n,
        ...(kws.length > 0 ? { keywords: kws } : {}),
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
        <h3 className="modal__title">新建监视清单</h3>
        <p className="text-muted">
          名称 + 搜索关键词。关键词决定流水线第一阶段 Tavily 抓什么新闻;留空走 fallback。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>名称</span>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如:天河区治安巡逻监视"
              disabled={submitting}
              autoFocus
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              搜索关键词
              <span style={{ color: 'var(--c-muted)', fontWeight: 400, marginLeft: 6 }}>
                每行一个 或 逗号分隔;空 → 派生 fallback
              </span>
            </span>
            <textarea
              className="input"
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              disabled={submitting}
              rows={5}
              placeholder={'例如:\n天河 治安巡逻\n广州 公安\n街面巡查'}
              style={{ fontFamily: 'monospace', resize: 'vertical' }}
            />
          </label>
        </div>

        {error && <div className="alert alert--error" style={{ marginTop: 'var(--sp-3)' }}>{error}</div>}

        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={close} disabled={submitting}>
            取消
          </button>
          <button
            className="btn btn--primary"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
