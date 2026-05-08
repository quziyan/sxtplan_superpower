import type { ConfidenceSnapshot, NewsEvidenceWithItem } from '@/lib/prediction-api'

// m5 UI fix: 后端 occurredAt/addedAt 是 ISO UTC,前端按 Asia/Shanghai (UTC+8) 显示
const TZ = 'Asia/Shanghai'
function fmtCnTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function EvidenceList({
  snapshots, evidence,
}: { snapshots: ConfidenceSnapshot[]; evidence: NewsEvidenceWithItem[] }) {
  const withReasoning = snapshots.filter(s => s.reasoning && s.reasoning.length > 0)

  if (withReasoning.length === 0 && evidence.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-5)' }}>暂无推理记录与证据</div>
  }

  return (
    <div>
      {/* m5: news_evidence 块 — 真新闻原文 */}
      {evidence.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-2)' }}>
            📰 新闻证据({evidence.length} 条)
          </div>
          {evidence.map(ev => (
            <div key={ev.evidenceId} className="evidence-row">
              <div className="evidence-row__tag-col">
                <span className={`tag ${ev.weight === 'HIGH' ? 'tag--accent' : ev.weight === 'MED' ? 'tag--warn' : 'tag--ghost'}`}>
                  {ev.weight}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="evidence-row__title">
                  <a href={ev.news.url} target="_blank" rel="noreferrer" style={{ color: 'var(--c-link, #4ea1ff)' }}>
                    {ev.news.title}
                  </a>
                </div>
                <div className="evidence-row__meta">
                  <span>{ev.news.sourceLabel}</span>
                  <span>{ev.news.sourceKind}</span>
                  {ev.cited && <span style={{ color: 'var(--c-good)' }}>✓ cited</span>}
                  <span>添加 {fmtCnTime(ev.addedAt)}</span>
                  {ev.news.publishedAt && <span>发布 {fmtCnTime(ev.news.publishedAt)}</span>}
                </div>
                {(ev.news.summaryZh || ev.news.rawSnippet) && (
                  <div className="evidence-row__snippet">
                    {ev.news.summaryZh ?? ev.news.rawSnippet}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent 推理快照 */}
      {withReasoning.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)', marginBottom: 'var(--sp-2)' }}>
            🧠 推理记录({withReasoning.length} 条)
          </div>
          {withReasoning.map(s => (
            <div key={s.id} className="evidence-row">
              <div className="evidence-row__tag-col">
                <span className={`tag ${s.kind === 'FULL' ? 'tag--accent' : s.kind === 'MANUAL' ? 'tag--warn' : 'tag--ghost'}`}>
                  {s.kind}
                </span>
              </div>
              <div>
                <div className="evidence-row__title">{s.operator ?? '系统'}</div>
                <div className="evidence-row__meta">
                  <span>{fmtCnTime(s.occurredAt)}</span>
                  <span>conf {s.confidence}</span>
                  {s.confidenceCiLow !== null && s.confidenceCiHigh !== null && (
                    <span>CI [{s.confidenceCiLow}, {s.confidenceCiHigh}]</span>
                  )}
                </div>
                <div className="evidence-row__snippet">{s.reasoning}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
