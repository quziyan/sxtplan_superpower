import { useEffect, useState } from 'react'
import { Btn } from '@/components'
import {
  getNewsFreshnessDays, setNewsFreshnessDays,
  getNewsRelevanceThreshold, setNewsRelevanceThreshold,
  getNewsMaxToRerank, setNewsMaxToRerank,
} from '@/lib/settings-api'
import { updateWatchListName, deleteWatchList, type WatchList } from '@/lib/watchlist-api'
import { KeywordChipsEditor } from './KeywordChipsEditor'

/**
 * Plan-PP:阈值编辑器 — 三个 pipeline 阈值的统一编辑器 + 按 watchlist 的关键词入口。
 * 改完点保存,后端 PUT 到 app_settings 表;下次「📡 生成预测」生效(option A,
 * 不立即重跑当前)。
 */
export function ThresholdEditor({ onSaved, watchlists, onWatchListUpdated, onWatchListDeleted, onAddWatchList }: {
  onSaved?: () => void
  /** 用于在面板内列出每个监视清单的关键词。可选 — 不传则只展示阈值。 */
  watchlists?: WatchList[]
  /** chip / name 即时保存后回调。 */
  onWatchListUpdated?: (wl: WatchList) => void
  /** wl 删除成功后回调,父组件从 state 移除该 wl。 */
  onWatchListDeleted?: (id: string) => void
  /** 「+ 新建监视清单」点击 — 父组件弹 NewWatchListModal。 */
  onAddWatchList?: () => void
}) {
  const [freshness, setFreshness] = useState<number | null>(null)
  const [relevance, setRelevance] = useState<number | null>(null)
  const [maxRerank, setMaxRerank] = useState<number | null>(null)
  const [freshnessDraft, setFreshnessDraft] = useState('')
  const [relevanceDraft, setRelevanceDraft] = useState('')
  const [maxRerankDraft, setMaxRerankDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getNewsFreshnessDays(),
      getNewsRelevanceThreshold(),
      getNewsMaxToRerank(),
    ]).then(([f, r, m]) => {
      setFreshness(f); setFreshnessDraft(String(f))
      setRelevance(r); setRelevanceDraft(String(r))
      setMaxRerank(m); setMaxRerankDraft(String(m))
    }).catch(console.error)
  }, [])

  const fNum = parseInt(freshnessDraft, 10)
  const rNum = parseInt(relevanceDraft, 10)
  const mNum = parseInt(maxRerankDraft, 10)
  const fValid = Number.isFinite(fNum) && fNum >= 1 && fNum <= 365
  const rValid = Number.isFinite(rNum) && rNum >= 0 && rNum <= 100
  const mValid = Number.isFinite(mNum) && mNum >= 1 && mNum <= 100
  const allValid = fValid && rValid && mValid
  const dirty = freshness !== null && relevance !== null && maxRerank !== null && (
    fNum !== freshness || rNum !== relevance || mNum !== maxRerank
  )

  const onSave = async () => {
    if (!allValid || !dirty) return
    setSaving(true)
    setFlash(null)
    try {
      const tasks: Promise<unknown>[] = []
      if (fNum !== freshness) tasks.push(setNewsFreshnessDays(fNum).then(() => setFreshness(fNum)))
      if (rNum !== relevance) tasks.push(setNewsRelevanceThreshold(rNum).then(() => setRelevance(rNum)))
      if (mNum !== maxRerank) tasks.push(setNewsMaxToRerank(mNum).then(() => setMaxRerank(mNum)))
      await Promise.all(tasks)
      setFlash('✓ 已保存 · 下次「生成预测」生效')
      if (onSaved) onSaved()
      setTimeout(() => setFlash(null), 5000)
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
      setTimeout(() => setFlash(null), 8000)
    } finally {
      setSaving(false)
    }
  }

  const loading = freshness === null || relevance === null || maxRerank === null

  return (
    <div style={{
      marginBottom: 'var(--sp-4)',
      padding: 'var(--sp-3) var(--sp-4)',
      background: 'var(--c-panel-2)',
      borderRadius: 8,
      border: '1px solid var(--c-border, #2a2f3a)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 'var(--sp-2)',
      }}>
        <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>
          🎛️ 流水线阈值
        </div>
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>
          改完点保存 · 下次「生成预测」生效
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ThresholdField
          label="新鲜度(天)"
          help="1-365 · 只保留最近 N 天发布的新闻"
          value={freshnessDraft}
          onChange={setFreshnessDraft}
          valid={fValid}
          disabled={loading || saving}
        />
        <ThresholdField
          label="相关性阈值"
          help="0-100 · LLM 评分低于此数被丢弃"
          value={relevanceDraft}
          onChange={setRelevanceDraft}
          valid={rValid}
          disabled={loading || saving}
        />
        <ThresholdField
          label="送入 LLM 上限"
          help="1-100 · 规则过滤后,前 N 条送 LLM 评分"
          value={maxRerankDraft}
          onChange={setMaxRerankDraft}
          valid={mValid}
          disabled={loading || saving}
        />
        <Btn
          disabled={!allValid || !dirty || saving || loading}
          onClick={onSave}
        >
          {saving ? '保存中…' : '保存阈值'}
        </Btn>
        {flash && (
          <span style={{
            fontSize: 'var(--fs-2)',
            color: flash.startsWith('✓') ? 'var(--c-ok, #22c55e)' : 'var(--c-bad, #ef4444)',
          }}>
            {flash}
          </span>
        )}
      </div>

      {watchlists && onWatchListUpdated && (
        <div style={{
          marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)',
          borderTop: '1px dashed var(--c-border, #2a2f3a)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 'var(--sp-2)', gap: 'var(--sp-2)',
          }}>
            <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>
              🔍 搜索关键词(按监视清单)
            </div>
            <div style={{ flex: 1, fontSize: 'var(--fs-1)', color: 'var(--c-muted)', textAlign: 'right' }}>
              点 chip 改 · × 删除 · + 添加;点名字改名;🗑 删 wl;即时保存
            </div>
            {onAddWatchList && (
              <Btn onClick={onAddWatchList}>+ 新建监视清单</Btn>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {watchlists.filter(w => w.isActive).map((w) => (
              <WatchListRow
                key={w.id}
                watchlist={w}
                onChange={onWatchListUpdated}
                onDeleted={onWatchListDeleted}
              />
            ))}
            {watchlists.filter(w => w.isActive).length === 0 && (
              <div className="empty" style={{ padding: 'var(--sp-2) 0', fontSize: 'var(--fs-2)' }}>
                (无 active 监视清单 — 点右上「+ 新建监视清单」开始)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ThresholdField({ label, help, value, onChange, valid, disabled }: {
  label: string
  help: string
  value: string
  onChange: (v: string) => void
  valid: boolean
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
      <label style={{ fontSize: 'var(--fs-2)', fontWeight: 500 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          padding: '6px 10px',
          background: 'var(--c-panel)',
          border: `1px solid ${valid ? 'var(--c-border, #2a2f3a)' : 'var(--c-bad, #ef4444)'}`,
          borderRadius: 4,
          color: 'inherit',
          fontFamily: 'monospace',
          width: 110,
        }}
      />
      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>{help}</span>
    </div>
  )
}

/** 单行 watchlist:可改名、可删除、关键词 chip 编辑。 */
function WatchListRow({ watchlist, onChange, onDeleted }: {
  watchlist: WatchList
  onChange: (wl: WatchList) => void
  onDeleted?: (id: string) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(watchlist.name)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setNameDraft(watchlist.name) }, [watchlist.name])

  const submitName = async () => {
    const v = nameDraft.trim()
    if (!v) { setEditingName(false); setNameDraft(watchlist.name); return }
    if (v.length > 100) { setError('名称最长 100 字'); setTimeout(() => setError(null), 4000); return }
    if (v === watchlist.name) { setEditingName(false); return }
    setWorking(true); setError(null)
    try {
      const updated = await updateWatchListName(watchlist.id, v)
      onChange(updated)
      setEditingName(false)
    } catch (e) {
      setError((e as Error).message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setWorking(false)
    }
  }

  const onDelete = async () => {
    if (!window.confirm(`删除监视清单「${watchlist.name}」?\n若已产生预测,会被拒绝(需勾级联);若无预测,直接删。`)) return
    setWorking(true); setError(null)
    try {
      const r = await deleteWatchList(watchlist.id, false)
      if ('error' in r) {
        // 询问是否级联
        const ok = window.confirm(`${r.error.message}\n继续强删 watchlist(predictions 保留)?`)
        if (!ok) return
        const r2 = await deleteWatchList(watchlist.id, true)
        if ('error' in r2) { setError(r2.error.message); setTimeout(() => setError(null), 5000); return }
      }
      if (onDeleted) onDeleted(watchlist.id)
    } catch (e) {
      setError((e as Error).message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
      padding: '6px 10px',
      background: 'var(--c-panel)',
      border: '1px solid var(--c-border, #2a2f3a)',
      borderRadius: 6,
      fontSize: 'var(--fs-2)',
    }}>
      <div style={{ minWidth: 180, display: 'flex', alignItems: 'center' }}>
        {editingName ? (
          <input
            type="text"
            value={nameDraft}
            disabled={working}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={submitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitName()
              else if (e.key === 'Escape') { setEditingName(false); setNameDraft(watchlist.name) }
            }}
            style={{
              padding: '2px 6px',
              fontSize: 'var(--fs-2)',
              background: 'var(--c-panel-2)',
              border: '1px solid var(--c-accent, #4ea1ff)',
              borderRadius: 3,
              color: 'inherit',
              width: '100%',
            }}
          />
        ) : (
          <span
            onClick={() => !working && setEditingName(true)}
            style={{ fontWeight: 500, cursor: working ? 'default' : 'pointer' }}
            title="点击改名"
          >
            {watchlist.name}
          </span>
        )}
      </div>
      <KeywordChipsEditor watchlist={watchlist} onChange={onChange} />
      <button
        onClick={onDelete}
        disabled={working}
        title="删除该监视清单"
        style={{
          padding: '4px 10px',
          fontSize: 'var(--fs-1)',
          background: 'transparent',
          border: '1px solid var(--c-bad, #ef4444)',
          color: 'var(--c-bad, #ef4444)',
          borderRadius: 3,
          cursor: working ? 'default' : 'pointer',
          opacity: working ? 0.5 : 0.85,
        }}
      >
        🗑 删
      </button>
      {error && (
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--c-bad, #ef4444)' }}>✗ {error}</span>
      )}
    </div>
  )
}
