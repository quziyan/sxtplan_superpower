export type SourceMixData = {
  主流?: number
  政务?: number
  社交?: number
  外文?: number
}

const COLORS: Record<string, string> = {
  主流: 'var(--c-accent)',
  政务: 'var(--c-info)',
  社交: 'var(--c-cyan)',
  外文: 'var(--c-warn)',
}

export function SourceMix({ mix }: { mix: SourceMixData }) {
  const entries = Object.entries(mix) as Array<[keyof SourceMixData, number | undefined]>
  const total = entries.reduce((acc, [, v]) => acc + (v ?? 0), 0) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="smix">
          <span className="smix__label">{k}</span>
          <span className="smix__bar">
            <span className="smix__fill" style={{
              width: `${((v ?? 0) / total) * 100}%`,
              background: COLORS[k] ?? 'var(--c-text-3)',
            }} />
          </span>
          <span className="smix__num">{v ?? 0}</span>
        </div>
      ))}
    </div>
  )
}
