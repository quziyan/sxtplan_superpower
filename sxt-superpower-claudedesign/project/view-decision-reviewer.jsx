// Decision-maker (A) inbox + Reviewer (D) reports

// ===== A · Decision-maker Inbox =====
const DecisionView = ({ data, onOpenPrediction }) => {
  const [filter, setFilter] = useState('PROPOSED');
  const [batchSel, setBatchSel] = useState(new Set());

  const filtered = data.predictions.filter(p =>
    filter === 'ALL' ? true : p.status === filter
  );

  const toggle = (id) => {
    const s = new Set(batchSel);
    if (s.has(id)) s.delete(id); else s.add(id);
    setBatchSel(s);
  };

  const proposedCount = data.predictions.filter(p => p.status === 'PROPOSED').length;
  const dispatchedCount = data.predictions.filter(p => p.status === 'DISPATCHED').length;
  const highValueCount = data.predictions.filter(p => p.status === 'PROPOSED' && p.confidence >= 70).length;

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">收件箱</div>
          <div className={`sidebar__item ${filter === 'PROPOSED' ? 'active' : ''}`} onClick={() => setFilter('PROPOSED')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="inbox" size={13} />待批准</span>
            <span className="sidebar__item-meta" style={{ color: 'var(--c-warn)' }}>{proposedCount}</span>
          </div>
          <div className={`sidebar__item ${filter === 'DISPATCHED' ? 'active' : ''}`} onClick={() => setFilter('DISPATCHED')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="cam" size={13} />跟进中</span>
            <span className="sidebar__item-meta">{dispatchedCount}</span>
          </div>
          <div className={`sidebar__item ${filter === 'COMPLETED' ? 'active' : ''}`} onClick={() => setFilter('COMPLETED')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="check" size={13} />已复盘</span>
            <span className="sidebar__item-meta">{data.predictions.filter(p => p.status === 'COMPLETED').length}</span>
          </div>
          <div className={`sidebar__item ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="layers" size={13} />全部</span>
            <span className="sidebar__item-meta">{data.predictions.length}</span>
          </div>
        </div>

        <div className="sidebar__group">
          <div className="sidebar__heading">快捷视图</div>
          <div className="sidebar__item">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="trend" size={13} />高置信 ≥70%</span>
            <span className="sidebar__item-meta">{highValueCount}</span>
          </div>
          <div className="sidebar__item">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="alertTri" size={13} className="" />漂移异常</span>
            <span className="sidebar__item-meta" style={{ color: 'var(--c-bad)' }}>1</span>
          </div>
          <div className="sidebar__item">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="clock" size={13} />K ≤ 3 天</span>
            <span className="sidebar__item-meta">2</span>
          </div>
        </div>

        <div className="sidebar__group">
          <div className="sidebar__heading">本周综述</div>
          <div style={{ padding: '8px 8px 4px', fontSize: 11, color: 'var(--c-text-3)', lineHeight: 1.6 }}>
            <div>· 本周共审批 <b style={{ color: 'var(--c-text-2)' }}>23</b> 项</div>
            <div>· 调度命中率 <b style={{ color: 'var(--c-ok)' }}>78%</b></div>
            <div>· 平均决策时长 <b style={{ color: 'var(--c-text-2)' }}>4m 12s</b></div>
            <div>· 月度预算占用 <b style={{ color: 'var(--c-text-2)' }}>61%</b></div>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <PageHeader
          title="决策者 · 收件箱"
          sub="审视分析师推送的预测，一键批准或驳回"
          actions={
            <>
              {batchSel.size > 0 && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--c-text-3)', alignSelf: 'center', marginRight: 8 }}>
                    已选 <b style={{ color: 'var(--c-text)' }}>{batchSel.size}</b> 项
                  </span>
                  <button className="btn btn--ok"><Icon name="check" size={12} />批量批准并调度</button>
                  <button className="btn btn--danger"><Icon name="x" size={12} />批量驳回</button>
                </>
              )}
              {batchSel.size === 0 && (
                <>
                  <button className="btn"><Icon name="bell" size={12} />提醒规则</button>
                  <button className="btn btn--primary"><Icon name="check" size={12} />一键批准全部高置信</button>
                </>
              )}
            </>
          }
        />

        <div className="workspace__body">
          {/* Today's overview */}
          <div className="kpi-row" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="kpi">
              <div className="kpi__label">需要您审批</div>
              <div className="kpi__value" style={{ color: 'var(--c-warn)' }}>{proposedCount}</div>
              <div className="kpi__sub">PROPOSED 状态</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">本周已批准</div>
              <div className="kpi__value">17<span className="kpi__delta kpi__delta--up">↑5 vs 上周</span></div>
              <div className="kpi__sub">含调度 14 项</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">驳回率</div>
              <div className="kpi__value">26<span style={{ fontSize: 16, color: 'var(--c-text-3)' }}>%</span></div>
              <div className="kpi__sub">本月 6/23</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">平均决策时长</div>
              <div className="kpi__value">4m<span style={{ fontSize: 16, color: 'var(--c-text-3)' }}> 12s</span></div>
              <div className="kpi__sub">从推送到批准</div>
            </div>
          </div>

          {/* Inbox cards (proposed) — card style different from analyst's table */}
          {filter === 'PROPOSED' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {filtered.map(p => {
                const r = data.regions.find(x => x.id === p.regionId);
                const ev = data.evidence[p.id] || [];
                const cited = ev.filter(e => e.cited);
                return (
                  <div key={p.id} className="card" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr 240px 200px', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
                      <input type="checkbox" checked={batchSel.has(p.id)} onChange={() => toggle(p.id)} style={{ marginTop: 4 }} />
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--c-text-3)' }}>
                          <span className="id-cell">{p.shortId}</span>
                          <span>·</span>
                          <span><Icon name="pin" size={10} /> {r?.name}</span>
                          <span>·</span>
                          <span><Icon name="clock" size={10} /> {p.window.date} {periodLabel(p.window.period)}</span>
                          <span>·</span>
                          <span style={{ color: p.kDays <= 3 ? 'var(--c-bad)' : 'var(--c-text-3)' }}>K = {formatK(p.kDays)}</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>
                          {p.vehicle} · {p.task}
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.6, margin: '0 0 8px', maxWidth: 600 }}>
                          {p.reasoning}
                        </p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {cited.slice(0, 3).map(e => (
                            <span key={e.id} style={{
                              fontSize: 10.5, padding: '2px 8px',
                              background: 'var(--c-bg-1)', border: '1px solid var(--c-line)',
                              borderRadius: 999, color: 'var(--c-text-2)',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-accent)' }} />
                              {e.title.length > 32 ? e.title.slice(0, 32) + '…' : e.title}
                            </span>
                          ))}
                          {cited.length > 3 && (
                            <span style={{ fontSize: 10.5, color: 'var(--c-text-3)', padding: '2px 0' }}>+{cited.length - 3} 条引用证据</span>
                          )}
                        </div>
                      </div>
                      <div style={{ borderLeft: '1px solid var(--c-line)', paddingLeft: 'var(--sp-4)' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>置信度</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{
                            fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em',
                            color: p.confidence >= 65 ? 'var(--c-conf-high)' : p.confidence >= 45 ? 'var(--c-conf-mid)' : 'var(--c-conf-low)',
                          }}>{p.confidence}</span>
                          <span style={{ fontSize: 13, color: 'var(--c-text-3)' }}>%</span>
                          {p.ci && <span style={{ fontSize: 10.5, color: 'var(--c-text-3)', marginLeft: 6 }}>CI [{p.ci[0]}-{p.ci[1]}]</span>}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--c-text-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>证据</span><b style={{ color: 'var(--c-text-2)' }}>{p.evidenceCount} 条</b></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>漂移</span><b style={{ color: p.driftPp > 25 ? 'var(--c-warn)' : 'var(--c-text-2)' }}>{p.driftPp}pp</b></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>分析师</span><b style={{ color: 'var(--c-text-2)' }}>{p.analyst}</b></div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button className="btn btn--ok"><Icon name="check" size={12} />批准并调度</button>
                        <button className="btn btn--danger"><Icon name="x" size={12} />驳回</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => onOpenPrediction(p.id)}><Icon name="expand" size={11} />展开详情</button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="card" style={{ padding: 'var(--sp-7)', textAlign: 'center' }}>
                  <Icon name="check" size={28} className="" />
                  <div style={{ fontSize: 14, color: 'var(--c-text-2)', marginTop: 12 }}>收件箱已清空</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-3)', marginTop: 4 }}>所有预测已审批完毕</div>
                </div>
              )}
            </div>
          )}

          {filter !== 'PROPOSED' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th><th>车类 · 任务</th><th>区域</th><th>时间窗</th><th>置信度</th><th>状态</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const r = data.regions.find(x => x.id === p.regionId);
                    return (
                      <tr key={p.id} onClick={() => onOpenPrediction(p.id)}>
                        <td><span className="id-cell">{p.shortId}</span></td>
                        <td><div>{p.vehicle}</div><div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{p.task}</div></td>
                        <td>{r?.name}</td>
                        <td>{p.window.date} {periodLabel(p.window.period)}</td>
                        <td><ConfBar value={p.confidence} /></td>
                        <td><Status value={p.status} /></td>
                        <td><Icon name="chevronRight" size={13} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// ===== D · Reviewer / Library =====
const ReviewerView = ({ data, onOpenPrediction }) => {
  const [section, setSection] = useState('reports');

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">复盘 & 案例库</div>
          <div className={`sidebar__item ${section === 'reports' ? 'active' : ''}`} onClick={() => setSection('reports')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="book" size={13} />复盘报告</span>
            <span className="sidebar__item-meta">{data.reports.length}</span>
          </div>
          <div className={`sidebar__item ${section === 'matrix' ? 'active' : ''}`} onClick={() => setSection('matrix')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="grid" size={13} />二轴矩阵</span>
          </div>
          <div className={`sidebar__item ${section === 'patterns' ? 'active' : ''}`} onClick={() => setSection('patterns')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="trend" size={13} />规律统计</span>
          </div>
          <div className={`sidebar__item ${section === 'cases' ? 'active' : ''}`} onClick={() => setSection('cases')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="layers" size={13} />案例库</span>
            <span className="sidebar__item-meta">{data.cases.length}</span>
          </div>
        </div>

        <div className="sidebar__group">
          <div className="sidebar__heading">筛选</div>
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--c-text-3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>结局 = HIT</span><input type="checkbox" defaultChecked style={{ accentColor: 'var(--c-accent)' }} />
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>结局 = MISS</span><input type="checkbox" defaultChecked style={{ accentColor: 'var(--c-accent)' }} />
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>结局 = NO_DATA</span><input type="checkbox" style={{ accentColor: 'var(--c-accent)' }} />
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>含 FALSE_POSITIVE</span><input type="checkbox" style={{ accentColor: 'var(--c-accent)' }} />
            </label>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {section === 'reports' && <ReportsSection data={data} onOpenPrediction={onOpenPrediction} />}
        {section === 'matrix' && <MatrixSection data={data} onOpenPrediction={onOpenPrediction} />}
        {section === 'patterns' && <PatternsSection data={data} />}
        {section === 'cases' && <CasesSection data={data} />}
      </main>
    </div>
  );
};

// ----- 4-piece reports -----
const ReportsSection = ({ data, onOpenPrediction }) => {
  const [openReport, setOpenReport] = useState(data.reports[0]?.id);
  const r = data.reports.find(x => x.id === openReport);
  const pred = r ? data.predictions.find(p => p.id === r.predictionId) : null;

  return (
    <>
      <PageHeader
        title="复盘报告"
        sub="四件套：可视证据 + 推理摘要 + 时间轴 + Δ 与稳健性 · 自动生成 → 复盘师定稿"
        actions={<button className="btn btn--primary"><Icon name="plus" size={12} />生成新报告</button>}
      />
      <div className="workspace__body" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.reports.map(rep => {
            const p = data.predictions.find(x => x.id === rep.predictionId);
            return (
              <div key={rep.id} className="card" style={{
                padding: 'var(--sp-3) var(--sp-4)', cursor: 'pointer',
                borderColor: openReport === rep.id ? 'var(--c-accent)' : 'var(--c-line)',
                background: openReport === rep.id ? 'var(--c-accent-soft)' : 'var(--c-panel)',
              }} onClick={() => setOpenReport(rep.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="id-cell">{rep.id}</span>
                  <Tag kind={rep.outcome === 'HIT' ? 'ok' : rep.outcome === 'MISS' ? 'bad' : 'ghost'}>{rep.outcome}</Tag>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{p?.vehicle} · {p?.task}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{rep.publishedAt}</span>
                  <span>{rep.author}</span>
                </div>
              </div>
            );
          })}
        </div>

        {r && pred && (
          <div className="card" style={{ padding: 'var(--sp-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-4)' }}>
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span className="id-cell">{r.id}</span>
                  <Tag kind={r.outcome === 'HIT' ? 'ok' : r.outcome === 'MISS' ? 'bad' : 'ghost'}>{r.outcome}</Tag>
                  <Tag kind="ghost">已定稿</Tag>
                </div>
                <h2 style={{ margin: 0, fontSize: 19, letterSpacing: '-0.015em' }}>{pred.vehicle} · {pred.task}</h2>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>
                  发布 {r.publishedAt} · 复盘师 {r.author} · 关联预测 <button className="btn btn--ghost btn--sm" onClick={() => onOpenPrediction(pred.id)}>{pred.shortId} ↗</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn--sm"><Icon name="download" size={11} />PDF</button>
                <button className="btn btn--sm"><Icon name="link" size={11} />分享</button>
              </div>
            </div>

            {/* Four pieces */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
              <ReportPiece num="01" title="可视证据" desc="部署照片 / 现场调度回传媒体">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                      aspectRatio: '4/3',
                      background: `linear-gradient(135deg, var(--c-panel-2), var(--c-bg-2))`,
                      borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--c-text-3)', fontSize: 10,
                    }}>
                      <div style={{ textAlign: 'center' }}>
                        <Icon name="cam" size={18} className="" />
                        <div style={{ marginTop: 4 }}>cam-{i}-frame</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 6 }}>4 帧自动抽样 · 已通过军事元素过滤</div>
              </ReportPiece>

              <ReportPiece num="02" title="推理摘要" desc="为何当时给出此置信度">
                <p style={{ fontSize: 11.5, color: 'var(--c-text-2)', lineHeight: 1.65, margin: 0 }}>
                  {r.summary}
                </p>
              </ReportPiece>

              <ReportPiece num="03" title="置信度时间轴" desc="预测窗内的演化">
                <MiniTimeline data={data.confidenceTimeline[r.predictionId] || []} />
                <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', marginTop: 6 }}>
                  起点 <b>{(data.confidenceTimeline[r.predictionId] || [])[0]?.conf}</b> → 锁定 <b>{(data.confidenceTimeline[r.predictionId] || [])[(data.confidenceTimeline[r.predictionId] || []).length - 1]?.conf}</b>
                </div>
              </ReportPiece>

              <ReportPiece num="04" title="Δ 与稳健性" desc="预期 vs 实际 + W/T/D/M 维度敏感性">
                <DeltaTable delta={r.delta} robustness={r.robustness} />
              </ReportPiece>
            </div>

            <div className="divider"></div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>关键 Take-aways</div>
                <ul style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
                  {r.takeaways.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>沉淀至案例库</div>
                <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 'var(--rad-2)', fontSize: 11.5 }}>
                  <div>新增 SuccessCase #{r.caseId}</div>
                  <div style={{ color: 'var(--c-text-3)', marginTop: 2 }}>嵌入向量已计算 · BM25 索引已更新 · 后续相似预测 will retrieve this case via few-shot</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const ReportPiece = ({ num, title, desc, children }) => (
  <div style={{ padding: 'var(--sp-4)', border: '1px solid var(--c-line)', borderRadius: 'var(--rad-3)', background: 'var(--c-bg-1)' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 10, color: 'var(--c-accent)', fontWeight: 600 }}>{num}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{desc}</div>
      </div>
    </div>
    {children}
  </div>
);

const MiniTimeline = ({ data }) => {
  if (!data.length) return <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>无数据</div>;
  const points = data.map((t, i) => ({
    x: (i / Math.max(1, data.length - 1)) * 100,
    y: 100 - t.conf,
    kind: t.kind,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <div style={{ height: 100, background: 'var(--c-panel)', borderRadius: 4, padding: 4, position: 'relative' }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
        <line x1="0" y1="40" x2="100" y2="40" stroke="var(--c-bad)" strokeWidth="0.3" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
        <path d={`${path} L 100 100 L 0 100 Z`} fill="rgba(78,163,255,0.18)" />
        <path d={path} fill="none" stroke="var(--c-accent)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.kind === 'FULL' ? 1.4 : 0.9}
            fill={p.kind === 'FULL' ? 'var(--c-accent)' : p.kind === 'MANUAL' ? 'var(--c-warn)' : 'var(--c-info)'}
            vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
};

const DeltaTable = ({ delta, robustness }) => (
  <div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', fontSize: 11.5 }}>
      <span style={{ color: 'var(--c-text-3)' }}>预期置信度</span>
      <span style={{ color: 'var(--c-text-2)', textAlign: 'right' }}>{delta.expected}</span>
      <span></span>
      <span style={{ color: 'var(--c-text-3)' }}>实际结局</span>
      <span style={{ color: 'var(--c-text-2)', textAlign: 'right' }}>{delta.actual}</span>
      <span></span>
      <span style={{ color: 'var(--c-text-3)' }}>偏差 (Δ)</span>
      <span style={{ textAlign: 'right', color: Math.abs(delta.diff) > 15 ? 'var(--c-warn)' : 'var(--c-ok)', fontWeight: 600 }}>{delta.diff > 0 ? '+' : ''}{delta.diff}</span>
      <span style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>{Math.abs(delta.diff) > 15 ? '需关注' : '良好'}</span>
    </div>
    <div className="divider" style={{ margin: '12px 0 8px' }}></div>
    <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Robustness · W/T/D/M</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      {Object.entries(robustness).map(([k, v]) => (
        <div key={k} style={{
          padding: '4px 6px',
          background: v >= 0.7 ? 'var(--c-ok-soft)' : v >= 0.5 ? 'var(--c-warn-soft)' : 'var(--c-bad-soft)',
          borderRadius: 3, fontSize: 10.5,
        }}>
          <div style={{ color: 'var(--c-text-3)', fontSize: 9 }}>{k}</div>
          <div style={{ color: v >= 0.7 ? 'var(--c-ok)' : v >= 0.5 ? 'var(--c-warn)' : 'var(--c-bad)', fontWeight: 600 }}>{v.toFixed(2)}</div>
        </div>
      ))}
    </div>
  </div>
);

// ----- 2-axis matrix -----
const MatrixSection = ({ data }) => {
  // x: 预测置信度 (0–100), y: 实际结局 (HIT/MISS/NO_DATA)
  // Rendered as scatter
  return (
    <>
      <PageHeader
        title="二轴矩阵 · 校准图"
        sub="横轴 = 预测置信度 · 纵轴 = 实际结局 · 理想：高置信→HIT 集中右上"
        actions={<button className="btn"><Icon name="info" size={12} />关于校准</button>}
      />
      <div className="workspace__body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--sp-4)' }}>
          <Card title="校准散点图" sub="所有已复盘预测 · 近 30 天">
            <div style={{ position: 'relative', height: 380, padding: '20px 20px 30px 50px' }}>
              {/* Y axis labels */}
              <div style={{ position: 'absolute', left: 10, top: 20, bottom: 30, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: 'var(--c-text-3)' }}>
                <span>HIT</span>
                <span>NO_DATA</span>
                <span>MISS</span>
              </div>
              {/* Plot area */}
              <div style={{ position: 'relative', height: '100%', border: '1px solid var(--c-line)', background: 'var(--c-panel)' }}>
                {/* Grid */}
                {[25, 50, 75].map(v => (
                  <div key={v} style={{ position: 'absolute', left: `${v}%`, top: 0, bottom: 0, width: 1, background: 'var(--c-line)' }} />
                ))}
                {[33, 66].map(v => (
                  <div key={v} style={{ position: 'absolute', top: `${v}%`, left: 0, right: 0, height: 1, background: 'var(--c-line)' }} />
                ))}
                {/* Diagonal "perfect calibration" hint */}
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                  <line x1="0" y1="100" x2="100" y2="0" stroke="var(--c-text-3)" strokeWidth="0.3" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
                </svg>
                {/* Scatter points */}
                {data.matrixPoints.map((pt, i) => {
                  const yMap = { HIT: 16, NO_DATA: 50, MISS: 84 };
                  return (
                    <div key={i} title={`${pt.label} · ${pt.confidence}% → ${pt.outcome}`}
                      style={{
                        position: 'absolute',
                        left: `${pt.confidence}%`, top: `${yMap[pt.outcome]}%`,
                        transform: 'translate(-50%, -50%)',
                        width: 10, height: 10, borderRadius: '50%',
                        background: pt.outcome === 'HIT' ? 'var(--c-ok)' : pt.outcome === 'MISS' ? 'var(--c-bad)' : 'var(--c-text-3)',
                        border: '1.5px solid var(--c-bg)',
                        cursor: 'pointer',
                      }} />
                  );
                })}
                {/* Quadrant labels */}
                <div style={{ position: 'absolute', right: 8, top: 8, fontSize: 9, color: 'var(--c-ok)', opacity: 0.7 }}>理想</div>
                <div style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 9, color: 'var(--c-text-3)', opacity: 0.6 }}>低风险驳回</div>
                <div style={{ position: 'absolute', right: 8, bottom: 8, fontSize: 9, color: 'var(--c-bad)', opacity: 0.7 }}>过度自信(FP)</div>
                <div style={{ position: 'absolute', left: 8, top: 8, fontSize: 9, color: 'var(--c-warn)', opacity: 0.7 }}>错失(漏报)</div>
              </div>
              {/* X axis labels */}
              <div style={{ position: 'absolute', left: 50, right: 20, bottom: 5, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--c-text-3)' }}>
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
              <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'var(--c-text-3)' }}>预测置信度 (%)</div>
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <Card title="本月校准指标">
              <KpiSmall label="ECE 校准误差" value="0.087" hint="<0.1 良好" trend="ok" />
              <KpiSmall label="Brier Score" value="0.142" hint="↓ better" trend="ok" />
              <KpiSmall label="HIT @ 高置信" value="84%" hint="conf ≥70%" trend="ok" />
              <KpiSmall label="过度自信" value="3 次" hint="conf ≥70 → MISS" trend="warn" />
              <KpiSmall label="错失（漏报）" value="2 次" hint="conf ≤30 → HIT" trend="bad" />
            </Card>
            <Card title="按车类">
              <BarRow label="高喷消防车" hit={12} miss={2} nodata={1} />
              <BarRow label="排涝车" hit={8} miss={1} nodata={2} />
              <BarRow label="抢险车" hit={5} miss={3} nodata={1} />
              <BarRow label="工程救援车" hit={3} miss={1} nodata={0} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
};

const KpiSmall = ({ label, value, hint, trend }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--c-line)' }}>
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-2)' }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{hint}</div>
    </div>
    <div style={{ fontSize: 15, fontWeight: 600, color: trend === 'ok' ? 'var(--c-ok)' : trend === 'warn' ? 'var(--c-warn)' : 'var(--c-bad)' }}>{value}</div>
  </div>
);

const BarRow = ({ label, hit, miss, nodata }) => {
  const total = hit + miss + nodata;
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--c-line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: 'var(--c-text-3)', fontVariantNumeric: 'tabular-nums' }}>{hit}/{total}</span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--c-bg-2)' }}>
        <div style={{ width: `${hit / total * 100}%`, background: 'var(--c-ok)' }} />
        <div style={{ width: `${nodata / total * 100}%`, background: 'var(--c-text-3)' }} />
        <div style={{ width: `${miss / total * 100}%`, background: 'var(--c-bad)' }} />
      </div>
    </div>
  );
};

// ----- Patterns / Cases -----
const PatternsSection = ({ data }) => (
  <>
    <PageHeader title="规律统计" sub="按车类 · 任务 · 区域聚合 · 用于规划阶段决策" />
    <div className="workspace__body">
      <div className="kpi-row" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="kpi"><div className="kpi__label">高出动率车类</div><div className="kpi__value" style={{ fontSize: 18 }}>高喷消防车</div><div className="kpi__sub">82% · 26/32 历史样本</div></div>
        <div className="kpi"><div className="kpi__label">高频任务</div><div className="kpi__value" style={{ fontSize: 18 }}>台风响应</div><div className="kpi__sub">14 起 · 占 37%</div></div>
        <div className="kpi"><div className="kpi__label">最活跃区域</div><div className="kpi__value" style={{ fontSize: 18 }}>粤西沿海</div><div className="kpi__sub">9 起 · ↑3 vs 上季</div></div>
        <div className="kpi"><div className="kpi__label">平均决策→出动间隔</div><div className="kpi__value">2.4<span style={{ fontSize: 16, color: 'var(--c-text-3)' }}>h</span></div><div className="kpi__sub">P50 · P95: 6.1h</div></div>
      </div>

      <Card title="车类 × 任务 热力" sub="近 90 天 · 出动频次">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--c-text-3)' }}></th>
                {['台风响应', '风暴潮', '应急演练', '内涝排水', '化工事故'].map(t => (
                  <th key={t} style={{ padding: '4px 8px', color: 'var(--c-text-3)', fontWeight: 400 }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { v: '高喷消防车', d: [12, 8, 5, 2, 7] },
                { v: '排涝车', d: [3, 9, 1, 14, 0] },
                { v: '抢险车', d: [6, 5, 4, 3, 2] },
                { v: '工程救援车', d: [2, 1, 6, 1, 4] },
                { v: '化学事故救援车', d: [0, 0, 1, 0, 8] },
              ].map(row => (
                <tr key={row.v}>
                  <td style={{ padding: '4px 8px', color: 'var(--c-text-2)' }}>{row.v}</td>
                  {row.d.map((n, i) => {
                    const max = 14;
                    const opacity = n / max;
                    return (
                      <td key={i} style={{ padding: 4 }}>
                        <div style={{
                          height: 32,
                          background: n === 0 ? 'var(--c-panel-2)' : `rgba(78,163,255,${0.15 + opacity * 0.65})`,
                          borderRadius: 3,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 600,
                          color: opacity > 0.6 ? 'white' : n === 0 ? 'var(--c-text-3)' : 'var(--c-text)',
                        }}>{n}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  </>
);

const CasesSection = ({ data }) => (
  <>
    <PageHeader title="案例库" sub="HIT 案例已嵌入向量 · 后续 PredictionAgent 通过 BM25 + embedding 检索 few-shot" />
    <div className="workspace__body">
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>案例 ID</th><th>车类 · 任务</th><th>区域</th><th>K（决策→出动）</th><th>原置信度</th><th>结局</th><th>嵌入维度</th><th>引用次数</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map(c => (
              <tr key={c.id}>
                <td><span className="id-cell">{c.id}</span></td>
                <td><div>{c.vehicle}</div><div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{c.task}</div></td>
                <td>{c.region}</td>
                <td className="num">{c.k} 天</td>
                <td><ConfBar value={c.confidence} /></td>
                <td><Tag kind={c.outcome === 'HIT' ? 'ok' : c.outcome === 'MISS' ? 'bad' : 'ghost'}>{c.outcome}</Tag></td>
                <td className="num" style={{ fontFamily: 'var(--ff-mono)', fontSize: 11 }}>1024</td>
                <td className="num">{c.refCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </>
);

window.DecisionView = DecisionView;
window.ReviewerView = ReviewerView;
