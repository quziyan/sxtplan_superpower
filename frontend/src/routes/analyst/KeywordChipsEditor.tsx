import { useState, useEffect, useRef } from 'react'
import { updateWatchListKeywords, type WatchList } from '@/lib/watchlist-api'

/**
 * Plan-PP follow-up:关键词 chip 编辑器(每个 keyword 一个 chip,× 删除、点 chip 改、
 * 末尾 + 添加)。即时保存 — 每次修改后 PATCH /watchlists/:id/keywords。
 */
export function KeywordChipsEditor({ watchlist, onChange }: {
  watchlist: WatchList
  onChange: (updated: WatchList) => void
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [addingValue, setAddingValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingIdx !== null) inputRef.current?.focus()
  }, [editingIdx])
  useEffect(() => {
    if (adding) addRef.current?.focus()
  }, [adding])

  const persist = async (nextKeywords: string[]) => {
    setSaving(true); setError(null)
    try {
      const updated = await updateWatchListKeywords(watchlist.id, nextKeywords)
      onChange(updated)
    } catch (e) {
      setError((e as Error).message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = (idx: number) => {
    const next = watchlist.keywords.filter((_, i) => i !== idx)
    void persist(next)
  }

  const onStartEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditValue(watchlist.keywords[idx] ?? '')
  }
  const onSubmitEdit = () => {
    if (editingIdx === null) return
    const v = editValue.trim()
    if (!v) { setEditingIdx(null); return }
    if (v.length > 60) { setError('关键词最长 60 字符'); setTimeout(() => setError(null), 4000); return }
    if (v === watchlist.keywords[editingIdx]) { setEditingIdx(null); return }
    const next = watchlist.keywords.map((k, i) => i === editingIdx ? v : k)
    setEditingIdx(null)
    void persist(next)
  }
  const onCancelEdit = () => setEditingIdx(null)

  const onSubmitAdd = () => {
    const v = addingValue.trim()
    if (!v) { setAdding(false); setAddingValue(''); return }
    if (v.length > 60) { setError('关键词最长 60 字符'); setTimeout(() => setError(null), 4000); return }
    if (watchlist.keywords.length >= 20) { setError('最多 20 个关键词'); setTimeout(() => setError(null), 4000); return }
    if (watchlist.keywords.includes(v)) { setAdding(false); setAddingValue(''); return }
    setAdding(false); setAddingValue('')
    void persist([...watchlist.keywords, v])
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
      minHeight: 28,
    }}>
      {watchlist.keywords.length === 0 && !adding && (
        <span style={{ color: 'var(--c-muted)', fontStyle: 'italic', fontSize: 'var(--fs-2)' }}>
          (派生 fallback — 用 V/T/区域名)
        </span>
      )}

      {watchlist.keywords.map((kw, idx) => (
        editingIdx === idx ? (
          <input
            key={idx}
            ref={inputRef}
            type="text"
            value={editValue}
            disabled={saving}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={onSubmitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitEdit()
              else if (e.key === 'Escape') onCancelEdit()
            }}
            style={{
              padding: '2px 8px',
              fontSize: 'var(--fs-2)',
              fontFamily: 'monospace',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-accent, #4ea1ff)',
              borderRadius: 3,
              color: 'inherit',
              minWidth: 80,
              width: Math.max(80, editValue.length * 14),
            }}
          />
        ) : (
          <span key={idx} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 4px 2px 8px',
            background: 'var(--c-accent, #4ea1ff)22',
            color: 'var(--c-accent, #4ea1ff)',
            borderRadius: 3,
            fontSize: 'var(--fs-2)',
            fontFamily: 'monospace',
          }}>
            <span
              onClick={() => !saving && onStartEdit(idx)}
              style={{ cursor: saving ? 'default' : 'pointer' }}
              title="点击编辑"
            >
              "{kw}"
            </span>
            <button
              onClick={() => !saving && onDelete(idx)}
              disabled={saving}
              title="删除"
              style={{
                width: 16, height: 16,
                padding: 0, lineHeight: '14px', textAlign: 'center',
                fontSize: 12,
                background: 'transparent',
                border: 'none',
                color: 'var(--c-accent, #4ea1ff)',
                cursor: saving ? 'default' : 'pointer',
                opacity: 0.6,
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.opacity = '1') }}
              onMouseLeave={(e) => { (e.currentTarget.style.opacity = '0.6') }}
            >
              ×
            </button>
          </span>
        )
      ))}

      {adding ? (
        <input
          ref={addRef}
          type="text"
          value={addingValue}
          disabled={saving}
          onChange={(e) => setAddingValue(e.target.value)}
          onBlur={onSubmitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitAdd()
            else if (e.key === 'Escape') { setAdding(false); setAddingValue('') }
          }}
          placeholder="新关键词…"
          style={{
            padding: '2px 8px',
            fontSize: 'var(--fs-2)',
            fontFamily: 'monospace',
            background: 'var(--c-panel)',
            border: '1px dashed var(--c-accent, #4ea1ff)',
            borderRadius: 3,
            color: 'inherit',
            minWidth: 100,
          }}
        />
      ) : (
        <button
          onClick={() => !saving && watchlist.keywords.length < 20 && setAdding(true)}
          disabled={saving || watchlist.keywords.length >= 20}
          style={{
            padding: '2px 8px',
            fontSize: 'var(--fs-2)',
            background: 'transparent',
            border: '1px dashed var(--c-border, #2a2f3a)',
            borderRadius: 3,
            color: 'var(--c-muted)',
            cursor: 'pointer',
            opacity: watchlist.keywords.length >= 20 ? 0.4 : 1,
          }}
          title={watchlist.keywords.length >= 20 ? '最多 20 个' : '添加关键词'}
        >
          + 添加
        </button>
      )}

      {saving && (
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>保存中…</span>
      )}
      {error && (
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--c-bad, #ef4444)' }}>✗ {error}</span>
      )}
    </div>
  )
}
