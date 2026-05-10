import type { ConfidenceSnapshot, NewsEvidenceWithItem, NewsItemSummary } from '@/lib/prediction-api'

// m5 UI fix: 后端 occurredAt/addedAt 是 ISO UTC,前端按 Asia/Shanghai (UTC+8) 显示
const TZ = 'Asia/Shanghai'
function fmtCnTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
// 仅日期(无时分)用于发布时间这种粗粒度展示
function fmtCnDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

const COLOR_NEW = '#22c55e'        // 绿:本次新增证据
const COLOR_REUSE = '#94a3b8'      // 灰:已在过去推理出现过
const COLOR_LINK = '#4ea1ff'

/**
 * EvidenceList — m5 UI v2:
 *
 * 按 snapshot 时间倒序分组(最新在最上)。每个 snapshot 块:
 *  - 头:tag(FULL/INCR/MANUAL)+ operator + time + confidence
 *  - reasoning 文本
 *  - 该 snapshot 的引用新闻列表(snapshot.evidenceIds 在 newsById 还原)
 *    - 🟢 新增:首次在该 snapshot 出现的新闻
 *    - ⚪ 复用:更早 snapshot 已引用过的新闻
 *
 * 末尾另显示"未被任何 snapshot 引用的 evidence"(news_evidence 表里有,但 LLM 没 cite 的)。
 */
export function EvidenceList({
  snapshots, evidence, newsById,
}: {
  snapshots: ConfidenceSnapshot[]
  evidence: NewsEvidenceWithItem[]
  newsById: Record<string, NewsItemSummary>
}) {
  // 按时间正序遍历,累计 first-seen 集合;倒序展示
  const sortedAsc = [...snapshots].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const seen = new Set<string>()
  const blocks: Array<{ snap: ConfidenceSnapshot; cited: Array<{ news: NewsItemSummary; isNew: boolean }> }> = []
  for (const snap of sortedAsc) {
    const ids = (snap.evidenceIds ?? []).filter(id => newsById[id])
    const cited = ids.map(id => {
      const isNew = !seen.has(id)
      seen.add(id)
      return { news: newsById[id]!, isNew }
    })
    blocks.push({ snap, cited })
  }
  // 倒序展示(最新在上)
  blocks.reverse()

  // snapshot 集合里没用到的 evidence(news_evidence 表里有但没 LLM 引用过)
  const citedAll = new Set<string>()
  for (const b of blocks) for (const c of b.cited) citedAll.add(c.news.id)
  const orphanEvidence = evidence.filter(ev => !citedAll.has(ev.news.id))

  if (blocks.length === 0 && orphanEvidence.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-5)' }}>暂无推理记录与证据</div>
  }

  // 通用证据表格(snapshot 内 cited 段 + orphan 段共用)
  const tableHeader = (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--c-border, #2a2f3a)', color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>
        <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 60 }}>状态</th>
        <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 110 }}>发表时间</th>
        <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 140 }}>来源</th>
        <th style={{ textAlign: 'left', padding: '6px 8px' }}>标题</th>
      </tr>
    </thead>
  )

  return (
    <div style={{ width: '100%' }}>
      {/* 图例 */}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-3)' }}>
        <span><span style={{ color: COLOR_NEW, fontWeight: 600 }}>● </span>本次新增证据</span>
        <span><span style={{ color: COLOR_REUSE, fontWeight: 600 }}>● </span>已在过去推理引用</span>
      </div>

      {/* per-snapshot 块 */}
      {blocks.map(({ snap, cited }) => (
        <div
          key={snap.id}
          id={`snap-${snap.id}`}
          style={{
            width: '100%',
            marginBottom: 'var(--sp-5)',
            padding: 'var(--sp-4)',
            background: 'var(--c-panel, #181b22)',
            border: '1px solid var(--c-border, #2a2f3a)',
            borderRadius: 8,
          }}
        >
          {/* Header 行:tag + operator + 时间 + confidence */}
          <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span className={`tag ${snap.kind === 'FULL' ? 'tag--accent' : snap.kind === 'MANUAL' ? 'tag--warn' : 'tag--ghost'}`}>
              {snap.kind}
            </span>
            <span style={{ fontWeight: 600 }}>{snap.operator ?? '系统'}</span>
            <span style={{ color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>{fmtCnTime(snap.occurredAt)}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 'var(--fs-3)' }}>置信度 {snap.confidence}</span>
            {snap.confidenceCiLow !== null && snap.confidenceCiHigh !== null && (
              <span style={{ color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>
                CI [{snap.confidenceCiLow}, {snap.confidenceCiHigh}]
              </span>
            )}
          </div>

          {/* 推理段:全宽 + 大字号 + 充足 padding,不压缩成窄文本框 */}
          {snap.reasoning && (
            <div style={{
              width: '100%',
              padding: 'var(--sp-3) var(--sp-4)',
              background: 'var(--c-panel-2, #20242c)',
              borderLeft: '3px solid var(--c-accent, #4ea1ff)',
              borderRadius: 4,
              fontSize: 'var(--fs-3)',
              lineHeight: 1.7,
              color: 'var(--c-text-1, #d6dae3)',
              marginBottom: 'var(--sp-4)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 6, fontWeight: 600 }}>
                推理
              </div>
              {snap.reasoning}
            </div>
          )}

          {/* 引用新闻表格 */}
          {cited.length > 0 ? (
            <div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-2)' }}>
                📰 引用新闻({cited.length} 条 · 新增 {cited.filter(c => c.isNew).length} · 复用 {cited.filter(c => !c.isNew).length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-2)' }}>
                {tableHeader}
                <tbody>
                  {cited.map(({ news, isNew }) => (
                    <tr key={news.id} style={{ borderBottom: '1px solid var(--c-border, #2a2f3a)' }}>
                      <td style={{ padding: '8px', color: isNew ? COLOR_NEW : COLOR_REUSE, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {isNew ? '● 新' : '○ 复用'}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--c-muted)' }}>
                        {news.publishedAt ? fmtCnDate(news.publishedAt) : '未知'}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--c-muted)' }}>
                        {news.sourceLabel}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <a href={news.url} target="_blank" rel="noreferrer"
                           style={{ color: COLOR_LINK, textDecoration: 'underline', textDecorationStyle: isNew ? 'solid' : 'dotted' }}>
                          {news.title}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : evidence.length > 0 ? (
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', padding: 'var(--sp-2)' }}>
              📂 该次推理未单独 cite 新闻 — <a href="#evidence-pool" style={{ color: COLOR_LINK, textDecoration: 'underline' }}>
                跳转证据池({evidence.length} 条)
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', fontStyle: 'italic', padding: 'var(--sp-2)' }}>
              该次推理无证据(LLM 在证据池为空时基于 V/T/region metadata 评估)
            </div>
          )}
        </div>
      ))}

      {/* 未被任何 snapshot 引用的 evidence(原始证据池里 LLM 没 cite 的)*/}
      {orphanEvidence.length > 0 && (
        <div id="evidence-pool" style={{
          width: '100%', marginTop: 'var(--sp-4)', padding: 'var(--sp-4)',
          background: 'var(--c-panel, #181b22)',
          border: '1px solid var(--c-border, #2a2f3a)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-2)' }}>
            📂 证据池剩余({orphanEvidence.length} 条 — 已写入但 LLM 未引用)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-2)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border, #2a2f3a)', color: 'var(--c-muted)', fontSize: 'var(--fs-2)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 60 }}>权重</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 110 }}>发表时间</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', width: 140 }}>来源</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>标题</th>
              </tr>
            </thead>
            <tbody>
              {orphanEvidence.map(ev => (
                <tr key={ev.evidenceId} style={{ borderBottom: '1px solid var(--c-border, #2a2f3a)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                    <span className={`tag ${ev.weight === 'HIGH' ? 'tag--accent' : ev.weight === 'MED' ? 'tag--warn' : 'tag--ghost'}`}>
                      {ev.weight}
                    </span>
                  </td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--c-muted)' }}>
                    {ev.news.publishedAt ? fmtCnDate(ev.news.publishedAt) : '未知'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--c-muted)' }}>
                    {ev.news.sourceLabel}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={ev.news.url} target="_blank" rel="noreferrer" style={{ color: COLOR_LINK }}>
                      {ev.news.title}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
