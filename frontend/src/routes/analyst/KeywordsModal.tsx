import { useEffect, useState } from 'react'
import { Btn } from '@/components'
import {
  getResolvedKeywords, updateWatchListKeywords,
  type WatchList, type ResolvedKeywords,
} from '@/lib/watchlist-api'

/**
 * Plan-PP follow-up:搜索关键词编辑器。
 *
 * 关键行为:
 *  - 加载时拉 /watchlists/:id/resolved-keywords → 看到 explicit + derived 两组
 *  - 若 explicit 为空,默认填入 derived 作为草稿(用户可改可删)
 *  - 保存 → PATCH /watchlists/:id/keywords。空数组 = 重新走派生 fallback
 *
 * 不可立即重跑(option A,与阈值编辑器一致 — 下次「生成预测」生效)。
 */
export function KeywordsModal({ open, watchlist, onClose, onSaved }: {
  open: boolean
  watchlist: WatchList | null
  onClose: () => void
  onSaved?: (wl: WatchList) => void
}) {
  const [resolved, setResolved] = useState<ResolvedKeywords | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !watchlist) return
    setResolved(null)
    setError(null)
    getResolvedKeywords(watchlist.id)
      .then((r) => {
        setResolved(r)
        // 草稿 = explicit(若有) || derived(让用户可直接编辑)
        const seed = r.explicit.length > 0 ? r.explicit : r.derived
        setDraft(seed.join('\n'))
      })
      .catch((e) => setError((e as Error).message))
  }, [open, watchlist])

  if (!open || !watchlist) return null

  const parsedKeywords = draft
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const tooLong = parsedKeywords.some((k) => k.length > 60)
  const tooMany = parsedKeywords.length > 20
  const valid = !tooLong && !tooMany

  const onSave = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      const wl = await updateWatchListKeywords(watchlist.id, parsedKeywords)
      if (onSaved) onSaved(wl)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onResetDerived = () => {
    if (!resolved) return
    setDraft(resolved.derived.join('\n'))
  }

  const onClearExplicit = () => {
    setDraft('')
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '85vh', overflow: 'auto',
          background: 'var(--c-panel)', border: '1px solid var(--c-border, #2a2f3a)',
          borderRadius: 8, padding: 'var(--sp-4)',
          display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>
            🔍 编辑搜索关键词
          </div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginTop: 4 }}>
            监视清单:<strong>{watchlist.name}</strong>
          </div>
        </div>

        {resolved === null ? (
          <div className="empty">加载中…</div>
        ) : (
          <>
            <div style={{
              padding: 'var(--sp-2) var(--sp-3)',
              background: 'var(--c-panel-2)', borderRadius: 6,
              fontSize: 'var(--fs-2)',
            }}>
              <div style={{ marginBottom: 4 }}>
                当前实际使用:<strong style={{ color: 'var(--c-accent, #4ea1ff)' }}>
                  {resolved.source === 'explicit' ? '显式覆盖' : '派生 fallback(V/T/区域名)'}
                </strong>
              </div>
              <div style={{ color: 'var(--c-muted)' }}>
                派生备选:<code>{resolved.derived.join(' · ') || '(空)'}</code>
              </div>
            </div>

            <div>
              <label style={{
                display: 'block', fontSize: 'var(--fs-2)', fontWeight: 500,
                marginBottom: 6,
              }}>
                关键词(每行一个,或用逗号分隔;空 = 走派生 fallback)
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                rows={8}
                placeholder="例如:&#10;治安巡逻&#10;广州交警&#10;天河区"
                style={{
                  width: '100%', padding: 'var(--sp-2) var(--sp-3)',
                  background: 'var(--c-panel-2)',
                  border: `1px solid ${valid ? 'var(--c-border, #2a2f3a)' : 'var(--c-bad, #ef4444)'}`,
                  borderRadius: 6, color: 'inherit',
                  fontFamily: 'monospace', fontSize: 'var(--fs-2)',
                  resize: 'vertical',
                }}
              />
              <div style={{
                marginTop: 4, fontSize: 'var(--fs-1)',
                color: valid ? 'var(--c-muted)' : 'var(--c-bad, #ef4444)',
              }}>
                {tooMany && '⚠ 关键词最多 20 个;'}
                {tooLong && '⚠ 每个关键词最长 60 字符;'}
                {valid && `${parsedKeywords.length} 个关键词`}
                {valid && parsedKeywords.length === 0 && ' · 将清空显式 → 下次搜索走派生 fallback'}
              </div>
            </div>

            {error && (
              <div style={{
                padding: 'var(--sp-2)', background: 'var(--c-bad-soft, rgba(239,68,68,0.12))',
                color: 'var(--c-bad, #ef4444)', borderRadius: 6, fontSize: 'var(--fs-2)',
              }}>
                ✗ {error}
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 'var(--sp-2)',
            }}>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Btn onClick={onResetDerived} disabled={saving}>填入派生备选</Btn>
                <Btn onClick={onClearExplicit} disabled={saving}>清空</Btn>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Btn onClick={onClose} disabled={saving}>取消</Btn>
                <Btn variant="primary" onClick={onSave} disabled={saving || !valid}>
                  {saving ? '保存中…' : '保存(下次生效)'}
                </Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
