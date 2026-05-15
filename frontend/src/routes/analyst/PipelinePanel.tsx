import { useState } from 'react'
import type { StageTrace, StageDropReason, StageKeptEntry } from '@/lib/prediction-api'

/**
 * Plan-PP:Pipeline 漏斗面板 — 展示「生成预测」一轮的 6 阶段 in/out/dropped。
 *
 * Stages 来自 spawn-from-news 响应,append 顺序就是流水线顺序。多 wl 时各 wl
 * 的 stages 串联(用 watchlistName 区分);本组件只渲染传入的 stages 数组,
 * 父组件负责合并 / 选择展示哪一组。
 */

const STAGE_LABEL: Record<string, string> = {
  search: '🔍 搜索',
  freshness: '⏱️ 新鲜度',
  rule_filter: '🧹 规则过滤',
  rerank: '🤖 LLM 精排',
  ingest: '💾 入库去重',
  extract: '✨ 抽取预测',
}

const REASON_LABEL: Record<StageDropReason, string> = {
  'no-url': '无 URL',
  'no-title': '无标题',
  'short-title': '标题过短',
  'no-cjk': '无中文',
  'blocklist': '英文媒体黑名单',
  'expired': '超出时效窗口',
  'duplicate': 'URL 重复',
  'below-threshold': '低于相关性阈值',
  'over-cap': '超出送 LLM 上限',
}

const REASON_COLOR: Record<StageDropReason, string> = {
  'no-url': '#ef4444',
  'no-title': '#ef4444',
  'short-title': '#f59e0b',
  'no-cjk': '#a855f7',
  'blocklist': '#a855f7',
  'expired': '#3b82f6',
  'duplicate': '#22c55e',
  'below-threshold': '#fb923c',
  'over-cap': '#64748b',
}

/** 每个 stage 的展开模式:none / dropped / kept */
type ExpandMode = 'none' | 'dropped' | 'kept'

const STAGE_LABEL_SHORT: Record<string, string> = {
  search: '搜索',
  freshness: '新鲜度',
  rule_filter: '规则',
  rerank: 'LLM 精排',
  ingest: '入库',
  extract: '抽取',
}

export function PipelinePanel({ stages, title, onEditKeywords, defaultCollapsed = true }: {
  stages: StageTrace[]
  title?: string
  /** 触发后弹关键词编辑器(由 AnalystView 注入,知道是哪个 watchlist)。 */
  onEditKeywords?: () => void
  /** 默认折叠;点 header 展开。 */
  defaultCollapsed?: boolean
}) {
  const [expanded, setExpanded] = useState<Record<number, ExpandMode>>({})
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed)
  const setMode = (idx: number, mode: ExpandMode) =>
    setExpanded((prev) => ({ ...prev, [idx]: prev[idx] === mode ? 'none' : mode }))

  if (stages.length === 0) {
    return null
  }

  const peakIn = Math.max(1, ...stages.map((s) => Math.max(s.in, s.out)))

  // 汇总用于折叠态标题
  const firstIn = stages[0]?.out ?? 0  // search 阶段 out = 原始召回数
  const lastOut = stages[stages.length - 1]?.out ?? 0
  const lastStage = stages[stages.length - 1]
  const stepText = lastStage ? `${STAGE_LABEL_SHORT[lastStage.name] ?? lastStage.name} 完成` : '未执行'
  const totalDurationMs = stages.reduce((a, s) => a + s.durationMs, 0)
  // 进度条:每阶段 1 段,完成的段数 = stages.length;颜色按各段保留率反映"漏斗收紧"
  const stageSegments = stages.map((s) => {
    const ratio = s.in > 0 ? s.out / s.in : 1
    return ratio
  })

  return (
    <div style={{
      marginBottom: 'var(--sp-3)',
      padding: collapsed ? '8px var(--sp-3)' : 'var(--sp-4)',
      background: 'var(--c-panel-2)',
      borderRadius: 8,
      border: '1px solid var(--c-border, #2a2f3a)',
    }}>
      {/* 折叠 / 展开 公用的标题行 */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
          cursor: 'pointer',
          padding: collapsed ? 0 : '0 0 var(--sp-3) 0',
          marginBottom: collapsed ? 0 : 'var(--sp-2)',
          borderBottom: collapsed ? 'none' : '1px solid var(--c-border, #2a2f3a)',
        }}
        title={collapsed ? '点击展开详细漏斗' : '点击折叠'}
      >
        <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600, minWidth: 16 }}>
          {collapsed ? '▶' : '▼'}
        </span>
        <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600, minWidth: 200 }}>
          📊 {title ?? '生产流水线'}
        </span>
        {/* 6 阶段进度条:每阶段一段,颜色按保留率;鼠标 hover 显示名+比例 */}
        <div style={{
          flex: 1, display: 'flex', gap: 2, height: 10,
          alignItems: 'center', maxWidth: 360,
        }}>
          {stageSegments.map((ratio, i) => {
            const stage = stages[i]!
            // 收紧度颜色:保留率高 = 蓝;低 = 黄;0 = 红
            const color = ratio >= 0.8 ? 'var(--c-accent, #4ea1ff)'
              : ratio >= 0.3 ? 'var(--c-warn, #fbbf24)'
              : 'var(--c-bad, #ef4444)'
            return (
              <div
                key={i}
                title={`${STAGE_LABEL_SHORT[stage.name] ?? stage.name}: ${stage.in}→${stage.out} (${stage.durationMs}ms)`}
                style={{
                  flex: 1, height: '100%',
                  background: color,
                  borderRadius: 2,
                  opacity: 0.85,
                }}
              />
            )
          })}
        </div>
        <span style={{
          fontSize: 'var(--fs-2)', color: 'var(--c-muted)',
          fontFamily: 'monospace', minWidth: 110, textAlign: 'right',
        }}>
          {firstIn} → <strong style={{ color: lastOut > 0 ? 'var(--c-ok, #22c55e)' : 'var(--c-muted)' }}>{lastOut}</strong>
          <span style={{ marginLeft: 6, opacity: 0.7 }}>· {(totalDurationMs / 1000).toFixed(1)}s</span>
        </span>
        <span style={{
          fontSize: 'var(--fs-1)',
          padding: '2px 8px',
          background: lastStage && lastStage.note ? 'var(--c-warn-soft, rgba(251,191,36,0.18))' : 'var(--c-panel)',
          color: lastStage && lastStage.note ? 'var(--c-warn, #fbbf24)' : 'var(--c-muted)',
          borderRadius: 3,
          minWidth: 90, textAlign: 'center',
        }}>
          ✅ {stepText}
        </span>
      </div>

      {collapsed && null}

      {!collapsed && (
      <>
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        marginBottom: 'var(--sp-2)',
        fontSize: 'var(--fs-2)', color: 'var(--c-muted)',
      }}>
        每阶段可查看 📥 保留 / 📤 丢弃 样本
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        {stages.map((s, idx) => {
          const widthIn = (s.in / peakIn) * 100
          const widthOut = (s.out / peakIn) * 100
          const dropRate = s.in > 0 ? Math.round(((s.in - s.out) / s.in) * 100) : 0
          const mode: ExpandMode = expanded[idx] ?? 'none'
          const hasDropped = s.dropped.length > 0
          const hasKept = s.kept.length > 0
          return (
            <div key={idx} style={{
              padding: 'var(--sp-2) var(--sp-3)',
              background: 'var(--c-panel)',
              borderRadius: 6,
              border: '1px solid var(--c-border, #2a2f3a)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
              }}>
                <div style={{
                  minWidth: 110, fontSize: 'var(--fs-3)', fontWeight: 600,
                }}>
                  {STAGE_LABEL[s.name] ?? s.name}
                </div>
                <div style={{ flex: 1, position: 'relative', height: 18 }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0,
                    width: `${widthIn}%`, height: 8,
                    background: 'rgba(78, 161, 255, 0.25)',
                    borderRadius: 3,
                  }} />
                  <div style={{
                    position: 'absolute', top: 10, left: 0,
                    width: `${widthOut}%`, height: 8,
                    background: 'var(--c-accent, #4ea1ff)',
                    borderRadius: 3,
                  }} />
                </div>
                <div style={{
                  minWidth: 80, textAlign: 'right',
                  fontSize: 'var(--fs-2)', fontFamily: 'monospace',
                }}>
                  {s.in} → <strong>{s.out}</strong>
                </div>
                <div style={{
                  minWidth: 50, textAlign: 'right',
                  fontSize: 'var(--fs-2)',
                  color: dropRate > 50 ? 'var(--c-warn, #fbbf24)' : 'var(--c-muted)',
                }}>
                  -{dropRate}%
                </div>
                <div style={{
                  minWidth: 60, textAlign: 'right',
                  fontSize: 'var(--fs-1)', color: 'var(--c-muted)', fontFamily: 'monospace',
                }}>
                  {s.durationMs}ms
                </div>
              </div>
              {/* 双按钮:看保留 / 看丢弃,各阶段独立 */}
              <div style={{
                marginTop: 6, display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <button
                  disabled={!hasKept}
                  onClick={(e) => { e.stopPropagation(); setMode(idx, 'kept') }}
                  style={{
                    padding: '2px 8px', fontSize: 11,
                    background: mode === 'kept' ? 'var(--c-ok, #22c55e)' : 'transparent',
                    color: mode === 'kept' ? '#fff' : hasKept ? 'var(--c-ok, #22c55e)' : 'var(--c-muted)',
                    border: `1px solid ${hasKept ? 'var(--c-ok, #22c55e)' : 'var(--c-border, #2a2f3a)'}`,
                    borderRadius: 3,
                    cursor: hasKept ? 'pointer' : 'not-allowed',
                    opacity: hasKept ? 1 : 0.5,
                  }}
                >
                  📥 保留 {s.kept.length}
                </button>
                <button
                  disabled={!hasDropped}
                  onClick={(e) => { e.stopPropagation(); setMode(idx, 'dropped') }}
                  style={{
                    padding: '2px 8px', fontSize: 11,
                    background: mode === 'dropped' ? 'var(--c-bad, #ef4444)' : 'transparent',
                    color: mode === 'dropped' ? '#fff' : hasDropped ? 'var(--c-bad, #ef4444)' : 'var(--c-muted)',
                    border: `1px solid ${hasDropped ? 'var(--c-bad, #ef4444)' : 'var(--c-border, #2a2f3a)'}`,
                    borderRadius: 3,
                    cursor: hasDropped ? 'pointer' : 'not-allowed',
                    opacity: hasDropped ? 1 : 0.5,
                  }}
                >
                  📤 丢弃 {s.dropped.length}
                </button>
              </div>
              {s.note && (
                <div style={{
                  marginTop: 4, fontSize: 'var(--fs-1)',
                  color: 'var(--c-warn, #fbbf24)', fontStyle: 'italic',
                }}>
                  ⚠ {s.note}
                </div>
              )}
              {s.params && Object.keys(s.params).length > 0 && (
                <div style={{
                  marginTop: 4, fontSize: 'var(--fs-1)', color: 'var(--c-muted)',
                  fontFamily: 'monospace', wordBreak: 'break-all',
                }}>
                  {/* 搜索阶段:特殊渲染 keywords 数组 + 旁边一个「✏️ 改」按钮触发编辑 */}
                  {Array.isArray(s.params.keywords) && (
                    <div style={{
                      color: 'var(--c-accent, #4ea1ff)', marginBottom: 2,
                      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
                    }}>
                      <span>
                        🔍 keywords = [{(s.params.keywords as string[]).map(k => `"${k}"`).join(', ')}]
                      </span>
                      {onEditKeywords && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditKeywords() }}
                          style={{
                            padding: '1px 8px',
                            fontSize: 10,
                            background: 'var(--c-accent, #4ea1ff)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 3,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                          title="编辑这个监视清单的搜索关键词"
                        >
                          ✏️ 改关键词
                        </button>
                      )}
                    </div>
                  )}
                  {Object.entries(s.params)
                    .filter(([k]) => k !== 'keywords' && k !== 'cutoffMs')
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                    .join(' · ')}
                </div>
              )}
              {mode === 'dropped' && hasDropped && (
                <div style={{
                  marginTop: 'var(--sp-2)',
                  paddingTop: 'var(--sp-2)',
                  borderTop: '1px dashed var(--c-border, #2a2f3a)',
                }}>
                  <div style={{
                    fontSize: 'var(--fs-1)', color: 'var(--c-muted)', marginBottom: 4,
                  }}>
                    📤 丢弃样本({s.dropped.length} 条,最多展示 5)
                  </div>
                  {s.dropped.map((d, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)',
                      padding: '4px 0',
                      fontSize: 'var(--fs-1)',
                      borderBottom: i < s.dropped.length - 1 ? '1px dotted rgba(255,255,255,0.05)' : undefined,
                    }}>
                      <span style={{
                        flexShrink: 0, padding: '1px 6px', borderRadius: 3,
                        background: REASON_COLOR[d.reason] + '22',
                        color: REASON_COLOR[d.reason],
                        fontSize: 10, fontWeight: 600,
                      }}>
                        {REASON_LABEL[d.reason]}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {d.title || '(无标题)'}
                          {d.detail && (
                            <span style={{ color: 'var(--c-muted)', marginLeft: 6, fontFamily: 'monospace' }}>
                              {d.detail}
                            </span>
                          )}
                        </div>
                        {d.url && (
                          <div style={{
                            color: 'var(--c-muted)', fontFamily: 'monospace',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {d.url}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {mode === 'kept' && hasKept && (
                <div style={{
                  marginTop: 'var(--sp-2)',
                  paddingTop: 'var(--sp-2)',
                  borderTop: '1px dashed var(--c-border, #2a2f3a)',
                }}>
                  <div style={{
                    fontSize: 'var(--fs-1)', color: 'var(--c-muted)', marginBottom: 4,
                  }}>
                    📥 保留样本({s.kept.length} 条,最多展示 5)
                  </div>
                  {s.kept.map((k: StageKeptEntry, i: number) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)',
                      padding: '4px 0',
                      fontSize: 'var(--fs-1)',
                      borderBottom: i < s.kept.length - 1 ? '1px dotted rgba(255,255,255,0.05)' : undefined,
                    }}>
                      <span style={{
                        flexShrink: 0, padding: '1px 6px', borderRadius: 3,
                        background: 'rgba(34, 197, 94, 0.18)',
                        color: 'var(--c-ok, #22c55e)',
                        fontSize: 10, fontWeight: 600,
                      }}>
                        通过
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {k.title || '(无标题)'}
                          {k.detail && (
                            <span style={{ color: 'var(--c-muted)', marginLeft: 6, fontFamily: 'monospace' }}>
                              {k.detail}
                            </span>
                          )}
                        </div>
                        {k.url && (
                          <div style={{
                            color: 'var(--c-muted)', fontFamily: 'monospace',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {k.url}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </>
      )}
    </div>
  )
}
