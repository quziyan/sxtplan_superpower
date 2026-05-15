import { useEffect, useState } from 'react'
import { Btn } from '@/components'
import {
  listVehicleClasses, createVehicleClass, updateVehicleClass, deleteVehicleClass,
  getFollowedVehicleClasses, followVehicleClass, unfollowVehicleClass,
  type VehicleClass,
} from '@/lib/taxonomy-api'

/**
 * Plan-PP:车辆类型库管理 — 后台子模块。
 *
 * 功能:
 *   - 树形展示(level-1 父 → level-2 子)
 *   - 任何登录用户都能勾选「关注」(Q3=B:关注 level-1 = 自动含其所有 level-2 子)
 *   - ADMIN 角色可新增 / 重命名 / 删除节点
 *   - 抽取预测时 LLM 只从用户关注的 V 集合里选 vehicleClassId
 *
 * 权限:CRUD 路由后端 ADMIN-gated;非 ADMIN 调会 403,UI 这里不预判,失败时局部 flash 提示。
 */
export function VehicleClassManager() {
  const [classes, setClasses] = useState<VehicleClass[]>([])
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingChildOf, setAddingChildOf] = useState<string | 'root' | null>(null)
  const [addingDraft, setAddingDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const [vs, f] = await Promise.all([listVehicleClasses(), getFollowedVehicleClasses()])
      setClasses(vs)
      setFollowedIds(new Set(f))
    } catch (e) {
      setFlash('✗ ' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { refresh() }, [])

  const flashMsg = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 4500)
  }

  const level1 = classes.filter((c) => c.level === 1)
  const childrenOf = (pid: string) => classes.filter((c) => c.level === 2 && c.parentId === pid)

  const toggleFollow = async (v: VehicleClass) => {
    const wasFollowed = followedIds.has(v.id)
    // 乐观更新
    const next = new Set(followedIds)
    if (wasFollowed) next.delete(v.id); else next.add(v.id)
    setFollowedIds(next)
    try {
      if (wasFollowed) await unfollowVehicleClass(v.id)
      else await followVehicleClass(v.id)
    } catch (e) {
      // rollback
      setFollowedIds(followedIds)
      flashMsg('✗ ' + (e as Error).message)
    }
  }

  const toggleExpand = (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id); else next.add(id)
    setExpanded(next)
  }

  const submitAdd = async () => {
    const n = addingDraft.trim()
    if (!n) { setAddingChildOf(null); setAddingDraft(''); return }
    try {
      if (addingChildOf === 'root') {
        await createVehicleClass({ name: n, level: 1 })
      } else if (addingChildOf) {
        await createVehicleClass({ name: n, level: 2, parentId: addingChildOf })
      }
      setAddingChildOf(null); setAddingDraft('')
      await refresh()
    } catch (e) {
      flashMsg('✗ ' + (e as Error).message + '(需 ADMIN 角色)')
    }
  }

  const submitEdit = async (v: VehicleClass) => {
    const n = editingDraft.trim()
    if (!n || n === v.name) { setEditingId(null); return }
    try {
      await updateVehicleClass(v.id, { name: n })
      setEditingId(null)
      await refresh()
    } catch (e) {
      flashMsg('✗ ' + (e as Error).message + '(需 ADMIN 角色)')
    }
  }

  const onDelete = async (v: VehicleClass) => {
    const kids = childrenOf(v.id)
    if (kids.length > 0) {
      flashMsg(`✗ 该 V 节点有 ${kids.length} 个子分类,请先删子节点`)
      return
    }
    if (!window.confirm(`删除车辆类型「${v.name}」?\n所有用户对该节点的关注会被一并清掉。`)) return
    try {
      const r = await deleteVehicleClass(v.id)
      if (r.error) { flashMsg('✗ ' + r.error.message); return }
      flashMsg(`✓ 已删除 ${v.name}`)
      await refresh()
    } catch (e) {
      flashMsg('✗ ' + (e as Error).message + '(需 ADMIN 角色)')
    }
  }

  if (loading) return <div className="empty">加载中…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>
          ⭐ = 已关注;关注的车型会作为「抽取预测」LLM 的候选 V 集合。
          关注 level-1 父节点 = 自动含其所有 level-2 子。
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-accent, #4ea1ff)' }}>
          已关注 {followedIds.size} 个
        </span>
        <Btn onClick={() => { setAddingChildOf('root'); setAddingDraft('') }}>
          + 新增 level-1 大类(ADMIN)
        </Btn>
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
        borderRadius: 6, padding: 'var(--sp-3)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {level1.length === 0 && !addingChildOf && (
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>
            (空 — 点上方「+ 新增 level-1 大类」开始)
          </div>
        )}
        {level1.map((p) => {
          const kids = childrenOf(p.id)
          const isOpen = expanded.has(p.id)
          const followed = followedIds.has(p.id)
          return (
            <div key={p.id}>
              <ClassRow
                node={p}
                indent={0}
                editing={editingId === p.id}
                editDraft={editingDraft}
                setEditDraft={setEditingDraft}
                onStartEdit={() => { setEditingId(p.id); setEditingDraft(p.name) }}
                onSubmitEdit={() => submitEdit(p)}
                onCancelEdit={() => setEditingId(null)}
                followed={followed}
                toggleFollow={() => toggleFollow(p)}
                onDelete={() => onDelete(p)}
                onAddChild={() => { setAddingChildOf(p.id); setAddingDraft(''); setExpanded(new Set(expanded).add(p.id)) }}
                expandable={kids.length > 0}
                expanded={isOpen}
                onToggleExpand={() => toggleExpand(p.id)}
                childCount={kids.length}
              />
              {(isOpen || addingChildOf === p.id) && (
                <div style={{ marginLeft: 22 }}>
                  {kids.map((c) => (
                    <ClassRow
                      key={c.id}
                      node={c}
                      indent={1}
                      editing={editingId === c.id}
                      editDraft={editingDraft}
                      setEditDraft={setEditingDraft}
                      onStartEdit={() => { setEditingId(c.id); setEditingDraft(c.name) }}
                      onSubmitEdit={() => submitEdit(c)}
                      onCancelEdit={() => setEditingId(null)}
                      followed={followedIds.has(c.id)}
                      toggleFollow={() => toggleFollow(c)}
                      onDelete={() => onDelete(c)}
                    />
                  ))}
                  {addingChildOf === p.id && (
                    <AddInput value={addingDraft} setValue={setAddingDraft} onSubmit={submitAdd} onCancel={() => setAddingChildOf(null)} placeholder={`「${p.name}」的子类…`} />
                  )}
                </div>
              )}
            </div>
          )
        })}
        {addingChildOf === 'root' && (
          <AddInput value={addingDraft} setValue={setAddingDraft} onSubmit={submitAdd} onCancel={() => setAddingChildOf(null)} placeholder="新 level-1 大类名…" />
        )}
      </div>
    </div>
  )
}

function ClassRow({
  node, indent, editing, editDraft, setEditDraft, onStartEdit, onSubmitEdit, onCancelEdit,
  followed, toggleFollow, onDelete, onAddChild, expandable, expanded, onToggleExpand, childCount,
}: {
  node: VehicleClass
  indent: number
  editing: boolean
  editDraft: string
  setEditDraft: (v: string) => void
  onStartEdit: () => void
  onSubmitEdit: () => void
  onCancelEdit: () => void
  followed: boolean
  toggleFollow: () => void
  onDelete: () => void
  onAddChild?: () => void
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  childCount?: number
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
      padding: '6px 8px',
      paddingLeft: indent * 22 + 8,
      borderRadius: 4,
    }}>
      {/* 展开/收起箭头 */}
      <span
        onClick={onToggleExpand}
        style={{
          width: 16, cursor: expandable ? 'pointer' : 'default',
          color: 'var(--c-muted)', fontSize: 12,
        }}
      >
        {expandable ? (expanded ? '▼' : '▶') : ''}
      </span>

      {/* 关注切换 */}
      <button
        onClick={toggleFollow}
        title={followed ? '取消关注' : '关注'}
        style={{
          width: 22, height: 22, padding: 0, fontSize: 14,
          background: followed ? 'var(--c-accent, #4ea1ff)33' : 'transparent',
          color: followed ? 'var(--c-accent, #4ea1ff)' : 'var(--c-muted)',
          border: `1px solid ${followed ? 'var(--c-accent, #4ea1ff)' : 'var(--c-border, #2a2f3a)'}`,
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        {followed ? '⭐' : '☆'}
      </button>

      {/* level 标签 */}
      <span style={{
        fontSize: 10, padding: '1px 6px',
        background: node.level === 1 ? 'var(--c-warn-soft, rgba(251,191,36,0.18))' : 'var(--c-panel-2)',
        color: node.level === 1 ? 'var(--c-warn, #fbbf24)' : 'var(--c-muted)',
        borderRadius: 3, fontFamily: 'monospace',
      }}>
        L{node.level}
      </span>

      {/* 名称 / 编辑 */}
      {editing ? (
        <input
          type="text"
          value={editDraft}
          autoFocus
          onChange={(e) => setEditDraft(e.target.value)}
          onBlur={onSubmitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitEdit()
            else if (e.key === 'Escape') onCancelEdit()
          }}
          style={{
            flex: 1, padding: '2px 8px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-accent, #4ea1ff)',
            borderRadius: 3, color: 'inherit',
          }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: 'var(--fs-2)', cursor: 'pointer' }} onClick={onStartEdit} title="点击改名(ADMIN)">
          {node.name}
        </span>
      )}

      {childCount !== undefined && childCount > 0 && (
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>
          {childCount} 子
        </span>
      )}

      {/* ADMIN 操作:加子节点 / 删除 */}
      {onAddChild && (
        <button onClick={onAddChild} title="新增子分类" style={btnSmStyle()}>+ 子</button>
      )}
      <button onClick={onDelete} title="删除" style={{ ...btnSmStyle(), color: 'var(--c-bad, #ef4444)', borderColor: 'var(--c-bad, #ef4444)' }}>
        🗑
      </button>
    </div>
  )
}

function AddInput({ value, setValue, onSubmit, onCancel, placeholder }: {
  value: string; setValue: (v: string) => void
  onSubmit: () => void; onCancel: () => void
  placeholder: string
}) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '6px 8px', paddingLeft: 30 }}>
      <input
        type="text"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={onSubmit}
        placeholder={placeholder}
        style={{
          flex: 1, padding: '4px 10px',
          background: 'var(--c-panel)',
          border: '1px dashed var(--c-accent, #4ea1ff)',
          borderRadius: 3, color: 'inherit',
          fontSize: 'var(--fs-2)',
        }}
      />
    </div>
  )
}

function btnSmStyle(): React.CSSProperties {
  return {
    padding: '2px 8px', fontSize: 11,
    background: 'transparent',
    border: '1px solid var(--c-border, #2a2f3a)',
    color: 'var(--c-muted)',
    borderRadius: 3, cursor: 'pointer',
  }
}
