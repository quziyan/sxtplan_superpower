import { useEffect, useState } from 'react'
import { Btn } from '@/components'
import {
  listAdminNewsItems, deleteAdminNewsItem, bulkDeleteAdminNewsItems, purgeAllNewsItems,
  type AdminNewsItem,
} from '@/lib/admin-api'

/**
 * Plan-PP follow-up:入库去重的库管理 — admin module。
 *
 * 用途:分析师反馈"重复点生成预测,全部 URL 在 DB,没新东西"时,管理员能在
 * 这里清掉指定/全部 news_items 让流水线重新跑。
 *
 * 安全:
 *  - 单条/批量删除若 news 有 news_evidence 引用,默认 409 拒绝;勾「级联」才连证据一起删
 *  - 「清空全部」需输入 DELETE_ALL 确认
 */
const PAGE_SIZE = 50

export function NewsItemsManager() {
  const [items, setItems] = useState<AdminNewsItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const [hasEvidence, setHasEvidence] = useState<'all' | 'true' | 'false'>('all')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)

  const refresh = async (newOffset = offset) => {
    setLoading(true)
    try {
      const r = await listAdminNewsItems({ q: q || undefined, limit: PAGE_SIZE, offset: newOffset, hasEvidence })
      setItems(r.items)
      setTotal(r.total)
      setOffset(r.offset)
      setSelected(new Set())
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh(0) }, [hasEvidence])

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.id)))
  }

  const onDelete = async (item: AdminNewsItem) => {
    const cascade = item.evidenceCount > 0
    const msg = cascade
      ? `这条新闻被 ${item.evidenceCount} 个 prediction 引用为证据。\n确定级联删除(连同证据)?`
      : `删除新闻 [${item.title.slice(0, 30)}…]?`
    if (!window.confirm(msg)) return
    try {
      const r = await deleteAdminNewsItem(item.id, cascade)
      if ('error' in r) {
        setFlash(`✗ ${r.error.message}`)
      } else {
        setFlash(`✓ 已删除 1 条(证据 ${r.deletedEvidence})`)
        refresh()
      }
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
    }
    setTimeout(() => setFlash(null), 5000)
  }

  const onBulkDelete = async (cascade: boolean) => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const msg = cascade
      ? `级联删除 ${ids.length} 条(连同关联证据)?不可恢复。`
      : `删除 ${ids.length} 条?有证据引用的会被拒绝(可改勾「级联」)。`
    if (!window.confirm(msg)) return
    try {
      const r = await bulkDeleteAdminNewsItems(ids, cascade)
      if ('error' in r) {
        setFlash(`✗ ${r.blockers.length} 条有证据引用,改用「级联删除」`)
      } else {
        setFlash(`✓ 删除 ${r.deleted} 条 / 证据 ${r.deletedEvidence}`)
        refresh()
      }
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
    }
    setTimeout(() => setFlash(null), 5000)
  }

  const onPurgeAll = async () => {
    const input = window.prompt(`将清空整个 news_items 表(${total} 条)+ 所有 news_evidence。\n输入 DELETE_ALL 确认:`)
    if (input !== 'DELETE_ALL') {
      setFlash('✗ 已取消')
      setTimeout(() => setFlash(null), 3000)
      return
    }
    try {
      const r = await purgeAllNewsItems()
      setFlash(`✓ 清空 ${r.deletedNews} 条新闻 + ${r.deletedEvidence} 条证据`)
      refresh()
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
    }
    setTimeout(() => setFlash(null), 5000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'center',
      }}>
        <input
          type="search"
          placeholder="搜索标题/URL…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refresh(0) }}
          style={{
            padding: '6px 12px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border, #2a2f3a)',
            borderRadius: 6, color: 'inherit',
            minWidth: 260,
          }}
        />
        <select
          value={hasEvidence}
          onChange={(e) => setHasEvidence(e.target.value as 'all' | 'true' | 'false')}
          style={{
            padding: '6px 12px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border, #2a2f3a)',
            borderRadius: 6, color: 'inherit',
          }}
        >
          <option value="all">全部</option>
          <option value="true">有证据引用</option>
          <option value="false">无证据引用</option>
        </select>
        <Btn onClick={() => refresh(0)} disabled={loading}>{loading ? '加载…' : '搜索'}</Btn>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
          共 {total} 条 · 已选 {selected.size}
        </span>
        <Btn onClick={() => onBulkDelete(false)} disabled={selected.size === 0}>
          删除选中
        </Btn>
        <Btn onClick={() => onBulkDelete(true)} disabled={selected.size === 0}>
          级联删除选中
        </Btn>
        <Btn onClick={onPurgeAll}>清空整个库</Btn>
      </div>

      {flash && (
        <div style={{
          padding: 'var(--sp-2) var(--sp-3)',
          background: flash.startsWith('✓') ? 'var(--c-ok-soft, rgba(34,197,94,0.12))' : 'var(--c-bad-soft, rgba(239,68,68,0.12))',
          color: flash.startsWith('✓') ? 'var(--c-ok)' : 'var(--c-bad)',
          borderRadius: 6, fontSize: 'var(--fs-2)',
        }}>{flash}</div>
      )}

      <div style={{
        border: '1px solid var(--c-border, #2a2f3a)',
        borderRadius: 6, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-2)' }}>
          <thead>
            <tr style={{ background: 'var(--c-panel-2)' }}>
              <th style={th()}>
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={selectAll}
                />
              </th>
              <th style={th()}>标题</th>
              <th style={th(180)}>来源</th>
              <th style={th(120)}>发布时间</th>
              <th style={th(80)}>证据</th>
              <th style={th(100)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr><td colSpan={6} className="empty" style={{ padding: 'var(--sp-4)', textAlign: 'center' }}>(空)</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid var(--c-border, #2a2f3a)' }}>
                <td style={td()}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
                <td style={td()}>
                  <div style={{ fontWeight: 500 }}>{item.title}</div>
                  <a href={item.url} target="_blank" rel="noreferrer" style={{
                    fontSize: 'var(--fs-1)', color: 'var(--c-muted)', fontFamily: 'monospace',
                  }}>{item.url.slice(0, 80)}{item.url.length > 80 ? '…' : ''}</a>
                </td>
                <td style={td(180)}>
                  <div>{item.sourceLabel}</div>
                  <div style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>{item.sourceKind}</div>
                </td>
                <td style={td(120)}>
                  <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>
                    {item.publishedAt?.slice(0, 10) ?? '—'}
                  </div>
                </td>
                <td style={td(80)}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: item.evidenceCount > 0 ? 'var(--c-accent, #4ea1ff)33' : 'transparent',
                    color: item.evidenceCount > 0 ? 'var(--c-accent, #4ea1ff)' : 'var(--c-muted)',
                  }}>{item.evidenceCount}</span>
                </td>
                <td style={td(100)}>
                  <Btn onClick={() => onDelete(item)}>删除</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
          第 {Math.floor(offset / PAGE_SIZE) + 1} 页 / 共 {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
        </span>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <Btn onClick={() => refresh(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0 || loading}>← 上一页</Btn>
          <Btn onClick={() => refresh(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total || loading}>下一页 →</Btn>
        </div>
      </div>
    </div>
  )
}

function th(width?: number): React.CSSProperties {
  return {
    padding: 'var(--sp-2) var(--sp-3)', textAlign: 'left',
    fontWeight: 500, fontSize: 'var(--fs-2)', color: 'var(--c-muted)',
    ...(width ? { width } : {}),
  }
}
function td(width?: number): React.CSSProperties {
  return {
    padding: 'var(--sp-2) var(--sp-3)', verticalAlign: 'top',
    ...(width ? { width } : {}),
  }
}
