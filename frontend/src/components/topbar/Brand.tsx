export function Brand({ version = 'v0.4.2' }: { version?: string }) {
  return (
    <div className="topbar__brand">
      <div className="topbar__logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="var(--c-accent)" opacity="0.12" />
          <path d="M6 16 L10 9 L13 13 L18 6" stroke="var(--c-accent)" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="18" cy="6" r="1.6" fill="var(--c-accent)" />
        </svg>
      </div>
      <div>
        <div className="topbar__title">
          CNP <span style={{ color: 'var(--c-text-3)', fontWeight: 400 }}>· 新闻驱动决策预测</span>
        </div>
        <div className="topbar__sub">{version} · {new Date().toLocaleDateString('zh-CN')}</div>
      </div>
    </div>
  )
}
