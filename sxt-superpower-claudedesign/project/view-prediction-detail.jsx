// Prediction Detail — the heart of the prototype
// Shows: evidence chain + confidence timeline + manual override + approval flow

const PredictionDetail = ({ predictionId, data, onClose, onAct }) => {
  const raw = data.predictions.find(x => x.id === predictionId);
  if (!raw) return null;
  // Normalize: past/completed predictions miss many fields — fill with safe defaults
  const p = {
    cadence: raw.kDays < 0 ? '已结束' : '每日 1 次',
    lastFullAt: raw.window?.date ? `${raw.window.date} 06:00` : '—',
    lastIncrAt: raw.window?.date ? `${raw.window.date} 06:00` : '—',
    driftPp: 0,
    ci: [Math.max(0, (raw.confidence || 50) - 7), Math.min(100, (raw.confidence || 50) + 7)],
    reasoning: '历史预测，详细推理已归档至复盘报告。点击预测的 retrospective 链接查看完整分析。',
    sourcesMix: { gov: 30, mainstream: 45, social: 20, foreign: 5 },
    tags: [],
    ...raw,
  };
  const region = data.regions.find(r => r.id === p.regionId);
  const rawTimeline = data.confidenceTimeline[predictionId] || [];
  // Synthesize a minimal timeline for past predictions so charts don't crash
  const timeline = rawTimeline.length > 0 ? rawTimeline : [
    { ts: `${p.window.date} 06:00`, kind: 'FULL', conf: Math.max(20, p.confidence - 15), evidence: 2, note: '初次锚点（历史归档）', operator: 'PredictionAgent' },
    { ts: `${p.window.date} 12:00`, kind: 'INCR', conf: Math.max(25, p.confidence - 8), evidence: 4, note: '+2 条证据', operator: 'PredictionAgent' },
    { ts: `${p.window.date} 18:00`, kind: 'FULL', conf: p.confidence, evidence: p.evidenceCount || 5, note: '终态锚点', operator: 'PredictionAgent' },
  ];
  const evidence = data.evidence[predictionId] || [];
  const dispatch = data.dispatches.find(d => d.predictionId === predictionId);
  const retro = data.retrospectives?.find(r => r.predictionId === predictionId);

  const [tab, setTab] = useState(retro ? 'retro' : 'evidence');
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideVal, setOverrideVal] = useState(p.confidence);
  const [overrideReason, setOverrideReason] = useState('');

  return (
    <div className="detail-pane" onClick={onClose}>
      <div className="detail-pane__panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: 'var(--sp-5) var(--sp-6) var(--sp-4)', borderBottom: '1px solid var(--c-line)', background: 'var(--c-bg-1)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--c-text-3)', marginBottom: 6 }}>
                <span className="id-cell" style={{ background: 'var(--c-panel-2)', padding: '2px 8px', borderRadius: 3 }}>{p.id}</span>
                <Status value={p.status} />
                <Tag kind="ghost">{p.source === 'WATCHLIST' ? '监视清单驱动' : '任务卡查询'}</Tag>
                {p.tags?.map(t => <Tag key={t}>#{t}</Tag>)}
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
                {p.vehicle} <span style={{ color: 'var(--c-text-3)', fontWeight: 400 }}>·</span> {p.task}
              </h2>
              <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-3)', fontSize: 12 }}>
                <Field icon="pin" label="区域">{region?.name} <span style={{ color: 'var(--c-text-3)' }}>(v{region?.version || 'AD_HOC'})</span></Field>
                <Field icon="clock" label="时间窗">{p.window.date} · {periodLabel(p.window.period)}</Field>
                <Field icon="zap" label="K">{formatK(p.kDays)} ({Math.abs(p.kDays)} 天)</Field>
                <Field icon="refresh" label="刷新节奏">{p.cadence}</Field>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {p.status === 'PROPOSED' && (
                <>
                  <button className="btn btn--ok" onClick={() => onAct?.(p.id, 'approve')}>
                    <Icon name="check" size={13} />批准并调度
                  </button>
                  <button className="btn btn--danger" onClick={() => onAct?.(p.id, 'reject')}>
                    <Icon name="x" size={13} />驳回
                  </button>
                </>
              )}
              {(p.status === 'APPROVED' || p.status === 'DISPATCHED') && (
                <button className="btn btn--danger"><Icon name="stop" size={12} />撤单</button>
              )}
              <button className="btn btn--ghost" onClick={onClose}><Icon name="x" size={14} /></button>
            </div>
          </div>

          {/* Confidence header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--sp-3)', marginTop: 'var(--sp-5)' }}>
            <ConfHeroBlock label="当前置信度" value={p.confidence} ci={p.ci} hero />
            <ConfHeroBlock label="证据条数" value={p.evidenceCount} unit="条" raw />
            <ConfHeroBlock label="漂移" value={p.driftPp || 0} unit="pp" raw warn={p.driftPp > 25} />
            <div className="kpi" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
              <div className="kpi__label">阈值参考</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
                <span style={{ color: 'var(--c-bad)' }}>调度 ≥60</span>
                <span style={{ color: 'var(--c-text-3)' }}>稳定 ≥80</span>
              </div>
              <div style={{ height: 4, background: 'var(--c-bg-2)', borderRadius: 2, marginTop: 8, position: 'relative' }}>
                <div style={{ position: 'absolute', left: '60%', height: '100%', width: 1, background: 'var(--c-bad)' }} />
                <div style={{ position: 'absolute', left: '80%', height: '100%', width: 1, background: 'var(--c-ok)' }} />
                <div style={{
                  height: '100%', width: `${p.confidence}%`,
                  background: p.confidence >= 65 ? 'var(--c-conf-high)' : p.confidence >= 45 ? 'var(--c-conf-mid)' : 'var(--c-conf-low)',
                  borderRadius: 2,
                }} />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="tabs" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
            {retro && (
              <button className={`tabs__btn ${tab === 'retro' ? 'active' : ''}`} onClick={() => setTab('retro')}>
                复盘 <span style={{ marginLeft: 4, color: retro.predictionOutcome === 'HIT' ? 'var(--c-ok)' : 'var(--c-bad)' }}>●</span>
              </button>
            )}
            <button className={`tabs__btn ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
              证据链 <span style={{ color: 'var(--c-text-3)' }}>{evidence.length}</span>
            </button>
            <button className={`tabs__btn ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}>
              置信度时间轴 <span style={{ color: 'var(--c-text-3)' }}>{timeline.length}</span>
            </button>
            <button className={`tabs__btn ${tab === 'reasoning' ? 'active' : ''}`} onClick={() => setTab('reasoning')}>Agent 推理</button>
            <button className={`tabs__btn ${tab === 'dispatch' ? 'active' : ''}`} onClick={() => setTab('dispatch')}>调度 {dispatch && <span style={{ marginLeft: 4, color: 'var(--c-warn)' }}>●</span>}</button>
            <button className={`tabs__btn ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>操作审计</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--sp-5) var(--sp-6)' }}>
          {tab === 'retro' && retro && <RetroTab retro={retro} prediction={p} />}
          {tab === 'evidence' && <EvidenceTab evidence={evidence} reasoning={p.reasoning} sourcesMix={p.sourcesMix} /> }
          {tab === 'timeline' && (
            <TimelineTab
              timeline={timeline}
              prediction={p}
              overrideMode={overrideMode} setOverrideMode={setOverrideMode}
              overrideVal={overrideVal} setOverrideVal={setOverrideVal}
              overrideReason={overrideReason} setOverrideReason={setOverrideReason}
            />
          )}
          {tab === 'reasoning' && <ReasoningTab prediction={p} evidence={evidence} />}
          {tab === 'dispatch' && <DispatchTab dispatch={dispatch} prediction={p} />}
          {tab === 'audit' && <AuditTab prediction={p} timeline={timeline} />}
        </div>
      </div>
    </div>
  );
};

const Field = ({ icon, label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <Icon name={icon} size={12} className="" />
    <span style={{ color: 'var(--c-text-3)' }}>{label}：</span>
    <span style={{ color: 'var(--c-text)' }}>{children}</span>
  </div>
);

const ConfHeroBlock = ({ label, value, ci, hero, raw, unit, warn }) => (
  <div className="kpi" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
    <div className="kpi__label">{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
      <span style={{
        fontSize: hero ? 28 : 20, fontWeight: 600, letterSpacing: '-0.02em',
        color: hero ? (value >= 65 ? 'var(--c-conf-high)' : value >= 45 ? 'var(--c-conf-mid)' : 'var(--c-conf-low)') : warn ? 'var(--c-warn)' : 'var(--c-text)',
      }}>{value}</span>
      <span style={{ color: 'var(--c-text-3)', fontSize: 13 }}>{hero ? '%' : unit}</span>
    </div>
    {hero && ci && <div className="kpi__sub">CI 95%: {ci[0]}–{ci[1]}</div>}
    {!hero && raw && <div className="kpi__sub">{label === '漂移' ? '阈值 25pp' : ''}</div>}
  </div>
);

// ===== Evidence Tab =====
const EvidenceTab = ({ evidence, reasoning, sourcesMix }) => {
  const [showCitedOnly, setShowCitedOnly] = useState(false);
  const filtered = showCitedOnly ? evidence.filter(e => e.cited) : evidence;
  const sourceLabels = { gov: '政府公告', mainstream: '主流新闻', social: '社交媒体', foreign: '外文/外媒' };

  return (
    <div className="split">
      <div>
        <div className="section-h">
          <div className="section-h__title">新闻证据 <span className="section-h__sub">{filtered.length}/{evidence.length} 条</span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn btn--sm ${showCitedOnly ? '' : 'btn--ghost'}`} onClick={() => setShowCitedOnly(!showCitedOnly)}>
              {showCitedOnly ? '✓' : ''} 仅显示被引用
            </button>
            <button className="btn btn--sm btn--ghost"><Icon name="filter" size={11} />筛选</button>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {filtered.map(e => (
            <div key={e.id} className={`evidence-row ${e.cited ? 'cited' : ''}`}>
              <div className="evidence-row__tag-col">
                <Tag kind={e.source === 'gov' ? 'info' : e.source === 'mainstream' ? 'accent' : e.source === 'social' ? '' : 'warn'}>
                  {sourceLabels[e.source]}
                </Tag>
                <div className="evidence-row__weight" style={{ marginTop: 4 }}>
                  权重 <span style={{ color: e.weight === 'HIGH' ? 'var(--c-ok)' : e.weight === 'MED' ? 'var(--c-warn)' : 'var(--c-text-3)' }}>{e.weight}</span>
                </div>
              </div>
              <div>
                <div className="evidence-row__title">
                  {e.cited && <span style={{ marginRight: 6, color: 'var(--c-accent)' }}>●</span>}
                  {e.title}
                </div>
                <div className="evidence-row__meta">
                  <span><Icon name="user" size={10} /> {e.sourceLabel}</span>
                  <span><Icon name="clock" size={10} /> {e.pubAt}</span>
                  <span><Icon name="link" size={10} /> 原文</span>
                </div>
                <div className="evidence-row__snippet">{e.snippet}</div>
              </div>
              <div>
                <Icon name="arrowUpRight" size={13} className="" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right rail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <Card title="信源分布">
          <SourceMix mix={sourcesMix} />
          <div className="divider"></div>
          <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>跨境占比</span><span>0%</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>地理化命中</span><span>14/14</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>去重率</span><span>3 条</span></div>
          </div>
        </Card>

        <Card title="Agent 摘要" sub="PredictionAgent · 06:00 输出">
          <p style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.65, margin: 0 }}>{reasoning}</p>
        </Card>

        <Card title="案例库 few-shot" sub="BM25 检索 top-5">
          <CaseShot vehicle="高喷消防车" task="台风响应" outcome="HIT" k={5} sample="2025-09 海葵 II 级响应" />
          <CaseShot vehicle="抢险车" task="风暴潮" outcome="HIT" k={4} sample="2024-08 苏拉登陆" />
          <CaseShot vehicle="高喷消防车" task="台风演练" outcome="MISS" k={6} sample="2024-05 演练取消" />
        </Card>
      </div>
    </div>
  );
};

const CaseShot = ({ vehicle, task, outcome, k, sample }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--c-line)', fontSize: 11.5 }}>
    <div>
      <div style={{ color: 'var(--c-text-2)' }}>{vehicle} · {task}</div>
      <div style={{ color: 'var(--c-text-3)', fontSize: 10.5 }}>{sample} · K={k}d</div>
    </div>
    <Tag kind={outcome === 'HIT' ? 'ok' : 'bad'}>{outcome}</Tag>
  </div>
);

// ===== Timeline Tab =====
const TimelineTab = ({ timeline, prediction, overrideMode, setOverrideMode, overrideVal, setOverrideVal, overrideReason, setOverrideReason }) => {
  const minConf = 0, maxConf = 100;
  const points = timeline.map((t, i) => ({
    ...t,
    x: (i / Math.max(1, timeline.length - 1)) * 100,
    y: 100 - ((t.conf - minConf) / (maxConf - minConf)) * 100,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="split">
      <div>
        <Card
          title="置信度演化"
          sub={`${timeline.length} 个快照 · 最近 ${timeline.length > 0 ? timeline[timeline.length - 1].ts : '—'}`}
          action={
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn--sm"><Icon name="refresh" size={11} />立即重算</button>
              <button className={`btn btn--sm ${overrideMode ? 'btn--primary' : ''}`} onClick={() => setOverrideMode(!overrideMode)}>
                <Icon name="edit" size={11} />手动调整
              </button>
            </div>
          }
        >
          {/* Chart */}
          <div className="ctl">
            <div className="ctl__chart" style={{ height: 220 }}>
              <div className="ctl__axis-y">
                {[100, 80, 60, 40, 20, 0].map(v => (
                  <div key={v} style={{ top: `${100 - v}%` }}>{v}</div>
                ))}
              </div>
              <div className="ctl__plot">
                {[20, 40, 60, 80].map(v => (
                  <div key={v} className="ctl__grid" style={{ top: `${100 - v}%` }} />
                ))}
                {/* Threshold line at 60 */}
                <div className="ctl__threshold" style={{ top: '40%' }}>
                  <span className="ctl__threshold-label">调度阈值 60</span>
                </div>
                <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="ctlgrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={`${pathD} L 100 100 L 0 100 Z`} fill="url(#ctlgrad)" />
                  <path d={pathD} fill="none" stroke="var(--c-accent)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
                  {points.map((pt, i) => (
                    <g key={i}>
                      <circle cx={pt.x} cy={pt.y} r="1.2"
                        fill={pt.kind === 'FULL' ? 'var(--c-accent)' : pt.kind === 'MANUAL' ? 'var(--c-warn)' : 'var(--c-info)'}
                        stroke="var(--c-bg)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                      {pt.kind === 'FULL' && (
                        <circle cx={pt.x} cy={pt.y} r="2.5" fill="none" stroke="var(--c-accent)" strokeOpacity="0.4" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                      )}
                    </g>
                  ))}
                </svg>
                {/* Tooltips for FULL/MANUAL events */}
                {points.filter(pt => pt.kind !== 'INCR').map((pt, i) => (
                  <div key={i} style={{
                    position: 'absolute',
                    left: `${pt.x}%`,
                    top: `${pt.y}%`,
                    transform: 'translate(-50%, -100%)',
                    paddingBottom: 8,
                    pointerEvents: 'none',
                    fontSize: 9.5,
                  }}>
                    <span style={{
                      background: pt.kind === 'FULL' ? 'var(--c-accent)' : 'var(--c-warn)',
                      color: 'white', padding: '1px 4px', borderRadius: 2,
                    }}>{pt.kind}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--c-text-3)', paddingLeft: 36, marginTop: 4 }}>
              <span>{timeline[0]?.ts}</span>
              <span>{timeline[Math.floor(timeline.length / 2)]?.ts}</span>
              <span>{timeline[timeline.length - 1]?.ts}</span>
            </div>
          </div>

          <div className="divider"></div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 11, color: 'var(--c-text-3)' }}>
            <LegendDot color="var(--c-info)" label="INCR 增量更新" />
            <LegendDot color="var(--c-accent)" label="FULL 全量重算" />
            <LegendDot color="var(--c-warn)" label="MANUAL 人工" />
            <span style={{ marginLeft: 'auto' }}>↑ 漂移 +37pp · ↓ 1 次人工调整 · 2 次 FULL 锚点</span>
          </div>
        </Card>

        {/* Snapshot list */}
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div className="section-h">
            <div className="section-h__title">快照明细</div>
            <div className="section-h__sub">追加式 / 不可变 · 满足 INSERT-only 审计约束</div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {timeline.slice().reverse().map((t, i) => {
              const prev = timeline.slice().reverse()[i + 1];
              const delta = prev ? t.conf - prev.conf : 0;
              return (
                <div key={i} style={{
                  padding: 'var(--sp-3) var(--sp-4)',
                  borderBottom: '1px solid var(--c-line)',
                  display: 'grid',
                  gridTemplateColumns: '120px 70px 60px 1fr 80px',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  fontSize: 12,
                }}>
                  <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 11, color: 'var(--c-text-2)' }}>{t.ts}</span>
                  <Tag kind={t.kind === 'FULL' ? 'accent' : t.kind === 'MANUAL' ? 'warn' : 'info'}>{t.kind}</Tag>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.conf}</span>
                    {delta !== 0 && (
                      <span style={{ fontSize: 10, color: delta > 0 ? 'var(--c-ok)' : 'var(--c-bad)' }}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    )}
                  </span>
                  <span style={{ color: 'var(--c-text-2)', fontSize: 11.5 }}>{t.note}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--c-text-3)', textAlign: 'right' }}>{t.operator}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right rail: manual override */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {overrideMode ? (
          <Card title="人工微调" sub="将写入 MANUAL snapshot + 操作审计">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>当前 → 调整后</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600 }}>
                  <span style={{ color: 'var(--c-text-3)' }}>{prediction.confidence}</span>
                  <Icon name="arrowRight" size={14} />
                  <span style={{ color: overrideVal >= 65 ? 'var(--c-conf-high)' : overrideVal >= 45 ? 'var(--c-conf-mid)' : 'var(--c-conf-low)' }}>{overrideVal}</span>
                </div>
                <input
                  type="range" min="0" max="100" value={overrideVal}
                  onChange={e => setOverrideVal(parseInt(e.target.value))}
                  style={{ width: '100%', marginTop: 8 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>必填 · 备注理由</div>
                <textarea
                  rows={4} value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  placeholder="例：本地消防部门内部例会决议提前调度，外部新闻未覆盖..."
                  style={{
                    width: '100%', padding: 8, fontSize: 12, color: 'var(--c-text)',
                    background: 'var(--c-bg-1)', border: '1px solid var(--c-line)',
                    borderRadius: 'var(--rad-2)', resize: 'vertical', fontFamily: 'inherit',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--primary" disabled={!overrideReason}>提交</button>
                <button className="btn btn--ghost" onClick={() => setOverrideMode(false)}>取消</button>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', padding: 8, background: 'var(--c-bg-1)', borderRadius: 4, lineHeight: 1.5 }}>
                <Icon name="info" size={11} /> 操作将进入 OperationAudit 表（INSERT-only）；不重置 INCR 基底。下次 FULL 时人工备注会作为额外上下文输入到 LLM。
              </div>
            </div>
          </Card>
        ) : (
          <Card title="触发表状态" sub="P1-P5 全量重算条件">
            <TriggerRow label="P1" desc="距上次 FULL 5 次 INCR" cur={2} max={5} />
            <TriggerRow label="P2" desc="距上次 FULL 7 天" cur={1.5} max={7} unit="d" />
            <TriggerRow label="P3" desc="累计新增证据 ≥10" cur={3} max={10} />
            <TriggerRow label="P4" desc="漂移 |Σ Δ| > 25pp" cur={prediction.driftPp} max={25} unit="pp" warn />
            <TriggerRow label="P5" desc="分析师立即重算" manual />
          </Card>
        )}

        <Card title="自适应 cadence" sub={`当前 K=${prediction.kDays}d`}>
          <CadenceRow active={prediction.kDays <= 3} range="K ≤ 3" rate="每 6 小时" />
          <CadenceRow active={prediction.kDays > 3 && prediction.kDays <= 14} range="3 < K ≤ 14" rate="每天 1 次" />
          <CadenceRow active={prediction.kDays > 14 && prediction.kDays <= 60} range="14 < K ≤ 60" rate="每 2 天" />
          <CadenceRow active={prediction.kDays > 60} range="K > 60" rate="每周" />
        </Card>
      </div>
    </div>
  );
};

const LegendDot = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
    {label}
  </span>
);

const TriggerRow = ({ label, desc, cur, max, unit = '', warn, manual }) => {
  const pct = manual ? 0 : Math.min(100, (cur / max) * 100);
  return (
    <div style={{ padding: '6px 0', fontSize: 11.5, borderBottom: '1px solid var(--c-line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span><b style={{ color: warn && pct >= 100 ? 'var(--c-bad)' : 'var(--c-text-2)' }}>{label}</b> <span style={{ color: 'var(--c-text-3)' }}>{desc}</span></span>
        <span style={{ color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}>{manual ? '手动' : `${cur}/${max}${unit}`}</span>
      </div>
      {!manual && (
        <div style={{ height: 3, background: 'var(--c-bg-2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--c-bad)' : 'var(--c-accent)', borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
};

const CadenceRow = ({ active, range, rate }) => (
  <div style={{
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 11.5,
    background: active ? 'var(--c-accent-soft)' : 'transparent',
    color: active ? 'var(--c-accent)' : 'var(--c-text-3)',
    display: 'flex', justifyContent: 'space-between',
    fontWeight: active ? 500 : 400,
  }}>
    <span>{range}</span>
    <span>{rate}</span>
  </div>
);

// ===== Retro tab (for past completed predictions) =====
const RetroTab = ({ retro, prediction }) => {
  const dimColor = (v) => v >= 80 ? 'var(--c-ok)' : v >= 60 ? 'var(--c-warn)' : 'var(--c-bad)';
  return (
    <div className="split">
      <div>
        <Card title="复盘摘要" sub={`${retro.id} · 生成于 ${retro.generatedAt}`}>
          <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--c-text-2)', margin: 0 }}>{retro.summary}</p>
        </Card>
        <div style={{ marginTop: 12 }}>
          <Card title="因果分析">
            <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--c-text-2)', whiteSpace: 'pre-wrap' }}>
              {retro.causal.split('\n').map((line, i) => (
                <div key={i} style={{ marginBottom: line.startsWith('**') ? 4 : 8 }} dangerouslySetInnerHTML={{
                  __html: line.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--c-accent)">$1</strong>')
                }} />
              ))}
            </div>
          </Card>
        </div>
        {retro.reviewerNotes && (
          <div style={{ marginTop: 12 }}>
            <Card title="复盘师备注">
              <p style={{ fontSize: 12, color: 'var(--c-text-2)', margin: 0 }}>{retro.reviewerNotes}</p>
            </Card>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card title="结局" sub="预测 vs 摄像头实拍">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: 12, background: 'var(--c-bg-1)', borderRadius: 4 }}>
              <div style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>预测</div>
              <Tag kind={retro.predictionOutcome === 'HIT' ? 'ok' : 'bad'}>{retro.predictionOutcome}</Tag>
            </div>
            <div style={{ padding: 12, background: 'var(--c-bg-1)', borderRadius: 4 }}>
              <div style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>实拍</div>
              <Tag kind={retro.captureOutcome === 'CAPTURED' ? 'ok' : 'ghost'}>{retro.captureOutcome}</Tag>
            </div>
          </div>
        </Card>
        <Card title="W/T/D/M 维度评分" sub={`综合 ${retro.composite}`}>
          {Object.entries(retro.dimScores).map(([k, v]) => (
            <div key={k} style={{ padding: '6px 0', borderBottom: '1px solid var(--c-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                <span><b>{k}</b> <span style={{ color: 'var(--c-text-3)' }}>{ {V:'车类', T:'任务', R:'区域', W:'时间窗'}[k] }</span></span>
                <span style={{ color: dimColor(v), fontWeight: 600 }}>{v}</span>
              </div>
              <div style={{ height: 4, background: 'var(--c-bg-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${v}%`, height: '100%', background: dimColor(v) }} />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};

// ===== Reasoning tab =====
const ReasoningTab = ({ prediction, evidence }) => (
  <div className="split">
    <div>
      <Card title="PredictionAgent 推理链" sub="dashscope deepseek-v4-flash · 09:00:14 · 4.3s · 脱敏后">
        <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--c-text-2)' }}>
          <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 'var(--rad-2)', marginBottom: 12, borderLeft: '2px solid var(--c-accent)' }}>
            <strong style={{ color: 'var(--c-accent)' }}>Step 1 · 信号聚合</strong>
            <p style={{ margin: '6px 0 0' }}>从 14 条 NewsEvidence 中识别 3 大信号源：① 气象路径稳定性（红色预警 + 登陆时间窗）② 应急响应级别（II 级）③ 历史规律（同类响应 5/6 出动率）。</p>
          </div>
          <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 'var(--rad-2)', marginBottom: 12, borderLeft: '2px solid var(--c-info)' }}>
            <strong style={{ color: 'var(--c-info)' }}>Step 2 · 时空对齐</strong>
            <p style={{ margin: '6px 0 0' }}>消防部门已前置高喷消防车至电白区博贺镇、滨海新区。多源新闻明示 AM 时段为登陆窗口（5/11 06-10 时）。地理化命中粤西沿海应急片区 14/14。</p>
          </div>
          <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 'var(--rad-2)', marginBottom: 12, borderLeft: '2px solid var(--c-warn)' }}>
            <strong style={{ color: 'var(--c-warn)' }}>Step 3 · 案例库 few-shot</strong>
            <p style={{ margin: '6px 0 0' }}>检索到 5 个相似案例：3 HIT / 1 MISS / 1 FP。关键差异：本次气象路径置信度更高（红色 vs 黄色预警）；历史 MISS 案例为演练取消。</p>
          </div>
          <div style={{ padding: 'var(--sp-3)', background: 'var(--c-accent-soft)', borderRadius: 'var(--rad-2)', borderLeft: '2px solid var(--c-accent)' }}>
            <strong style={{ color: 'var(--c-accent)' }}>Step 4 · 输出</strong>
            <p style={{ margin: '6px 0 0' }}>
              probability = <b>78%</b>，CI 95% [71, 84]。<br/>
              主要不确定性：风暴登陆时刻偏移可能影响 AM/PM 划分（W 维不确定性）。
            </p>
          </div>
        </div>
      </Card>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <Card title="脱敏管线" sub="ISC-62 强制执行">
        <div style={{ fontSize: 11.5, color: 'var(--c-text-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>车牌→ XXXX 后4位</span><Icon name="check" size={11} className="" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>单位实名→编码</span><Icon name="check" size={11} className="" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GPS→100m 网格</span><Icon name="check" size={11} className="" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>时间→分钟级</span><Icon name="check" size={11} className="" /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>军事敏感预筛</span><Icon name="check" size={11} className="" /></div>
        </div>
        <div className="divider"></div>
        <div style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>
          脱敏后准确率系数 ≈ 0.82，已纳入 confidence 权重计算。
        </div>
      </Card>
      <Card title="LLM 调用">
        <div style={{ fontSize: 11.5, color: 'var(--c-text-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Provider</span><span>阿里云 dashscope</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Model</span><span>deepseek-v4-flash</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Tokens (in/out)</span><span>3,142 / 612</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>data_retention</span><span style={{ color: 'var(--c-ok)' }}>opt_out</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>enable_search</span><span style={{ color: 'var(--c-text-3)' }}>false</span></div>
        </div>
      </Card>
    </div>
  </div>
);

// ===== Dispatch tab =====
const DispatchTab = ({ dispatch, prediction }) => {
  if (!dispatch) {
    return (
      <div className="empty" style={{ padding: 'var(--sp-7)' }}>
        <Icon name="cam" size={32} className="" />
        <div style={{ marginTop: 12 }}>本预测尚未调度。</div>
        {prediction.status === 'PROPOSED' && (
          <div style={{ marginTop: 8, fontSize: 11.5 }}>当前置信度 <b style={{ color: 'var(--c-text)' }}>{prediction.confidence}%</b>，{prediction.confidence >= 60 ? '已达调度阈值。' : `距 60% 阈值差 ${60 - prediction.confidence}pp。`}</div>
        )}
      </div>
    );
  }
  return (
    <div className="split">
      <div>
        <Card title={`调度任务 ${dispatch.id}`} sub={`${dispatch.adapterName} · ${dispatch.adapter}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Field2 label="状态">
              <Tag kind={dispatch.state === 'COMPLETED' ? 'ok' : 'warn'}>{dispatch.state}</Tag>
            </Field2>
            <Field2 label="发送时间">{dispatch.sentAt}</Field2>
            <Field2 label="预计结束">{dispatch.expectedEnd || dispatch.endedAt}</Field2>
            <Field2 label="摄像头数">{dispatch.cameras.length} 个</Field2>
            <Field2 label="预算占用">{dispatch.cost}</Field2>
            <Field2 label="回传媒体">{dispatch.mediaCount} 件</Field2>
          </div>

          <div className="section-h">
            <div className="section-h__title">摄像头清单</div>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {dispatch.cameras.map((c, i) => (
              <div key={i} style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: '1px solid var(--c-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="cam" size={14} />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>FoV polygon · 视野半径约 200m · 已通过军事元素过滤器</div>
                  </div>
                </div>
                <Tag kind="ok">在线</Tag>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ marginTop: 16 }}>
          <div className="section-h">
            <div className="section-h__title">状态机</div>
          </div>
          <DispatchStateMachine current={dispatch.state} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <Card title="撤单">
          <p style={{ fontSize: 11.5, color: 'var(--c-text-2)', margin: '0 0 12px' }}>
            撤单将通过 adapter.cancel(idempotency_key) 双向幂等通知外部摄像头平台。已回传媒体不会删除。
          </p>
          <button className="btn btn--danger" style={{ width: '100%' }}><Icon name="stop" size={12} />立即撤单</button>
        </Card>

        <Card title="区域 FoV 叠加">
          <div className="map-stub" style={{ height: 180, position: 'relative' }}>
            <div className="map-stub__grid"></div>
            {/* Region polygon */}
            <svg width="100%" height="100%" viewBox="0 0 200 180" style={{ position: 'absolute', inset: 0 }}>
              <polygon points="40,40 100,30 160,55 150,140 60,135" fill="rgba(78,163,255,0.12)" stroke="var(--c-accent)" strokeWidth="1.5" strokeDasharray="3,3" />
              {/* Camera FoVs */}
              {[[70, 70], [110, 90], [130, 110]].map(([x, y], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r="22" fill="rgba(245,177,79,0.18)" stroke="var(--c-warn)" strokeWidth="0.8" />
                  <circle cx={x} cy={y} r="2" fill="var(--c-warn)" />
                </g>
              ))}
            </svg>
            <div className="map-stub__attribution">高德地图企业版 · GeoJSON Polygon</div>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', marginTop: 8 }}>
            <span style={{ color: 'var(--c-accent)' }}>● 预测区域</span> · <span style={{ color: 'var(--c-warn)' }}>● 摄像头 FoV</span>
          </div>
        </Card>
      </div>
    </div>
  );
};

const Field2 = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 12.5 }}>{children}</div>
  </div>
);

const DispatchStateMachine = ({ current }) => {
  const states = ['QUEUED', 'SENT', 'IN_PROGRESS', 'COMPLETED'];
  const idx = states.indexOf(current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: 'var(--sp-4)', background: 'var(--c-panel)', border: '1px solid var(--c-line)', borderRadius: 'var(--rad-3)' }}>
      {states.map((s, i) => (
        <React.Fragment key={s}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: i <= idx ? 'var(--c-accent)' : 'var(--c-panel-2)',
              border: '2px solid', borderColor: i <= idx ? 'var(--c-accent)' : 'var(--c-line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: i <= idx ? 'white' : 'var(--c-text-3)',
              fontSize: 11, fontWeight: 600,
            }}>{i < idx ? '✓' : i + 1}</div>
            <span style={{ fontSize: 10.5, color: i === idx ? 'var(--c-accent)' : 'var(--c-text-3)', fontWeight: i === idx ? 600 : 400 }}>{s}</span>
          </div>
          {i < states.length - 1 && (
            <div style={{
              flex: 1, height: 2,
              background: i < idx ? 'var(--c-accent)' : 'var(--c-line)',
              margin: '0 -2px',
              marginBottom: 18,
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ===== Audit tab =====
const AuditTab = ({ prediction, timeline }) => {
  const events = [
    { ts: '2026-05-02 06:00', actor: 'PredictionAgent', action: 'CREATE', detail: '由 wl-1 触发 → Prediction 创建' },
    { ts: '2026-05-04 14:00', actor: '陈云岭(分析态)', action: 'MANUAL_OVERRIDE', detail: '置信度 62→70 · 备注："本地消防部门内部例会决议提前调度"', critical: true },
    { ts: '2026-05-05 06:00', actor: 'PredictionAgent', action: 'FULL_RECALC', detail: '触发 P1（5 次 INCR）· 新锚点 73' },
    { ts: '2026-05-06 06:00', actor: 'PredictionAgent', action: 'INCR', detail: '+1 主流证据' },
    { ts: '2026-05-06 09:14', actor: '陈云岭(分析态)', action: 'OPEN', detail: '查看预测详情' },
  ];
  return (
    <div>
      <div className="section-h">
        <div className="section-h__title">操作审计</div>
        <div className="section-h__sub">audit.operation_audit · INSERT-only · DB 级权限隔离</div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {events.map((e, i) => (
          <div key={i} style={{
            padding: 'var(--sp-3) var(--sp-4)',
            borderBottom: '1px solid var(--c-line)',
            display: 'grid',
            gridTemplateColumns: '140px 140px 130px 1fr',
            gap: 12,
            alignItems: 'center',
            fontSize: 12,
            background: e.critical ? 'var(--c-warn-soft)' : 'transparent',
          }}>
            <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 11, color: 'var(--c-text-2)' }}>{e.ts}</span>
            <span style={{ color: 'var(--c-text-2)' }}>{e.actor}</span>
            <Tag kind={e.critical ? 'warn' : 'ghost'}>{e.action}</Tag>
            <span style={{ color: 'var(--c-text-2)' }}>{e.detail}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 12, padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 'var(--rad-2)', borderLeft: '2px solid var(--c-info)' }}>
        <Icon name="shield" size={11} /> 服务账号 <code style={{ background: 'var(--c-panel-2)', padding: '1px 4px', borderRadius: 2 }}>cnp_app</code> 对此表无 UPDATE / DELETE 权限。所有写操作通过 SECURITY DEFINER 函数受控。
      </div>
    </div>
  );
};

window.PredictionDetail = PredictionDetail;
