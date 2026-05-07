import type { ConfidenceSnapshot } from '@/lib/prediction-api'

export function EvidenceList({ snapshots }: { snapshots: ConfidenceSnapshot[] }) {
  // m2: evidence 列表的真实接口 m3 暴露;暂用 snapshots 中带 reasoning 的条目当时间线展示
  const withReasoning = snapshots.filter(s => s.reasoning && s.reasoning.length > 0)
  if (withReasoning.length === 0) {
    return <div className="empty" style={{ padding: 'var(--sp-5)' }}>暂无推理记录</div>
  }
  return (
    <div>
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
              <span>{s.occurredAt.slice(0, 16)}</span>
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
  )
}
