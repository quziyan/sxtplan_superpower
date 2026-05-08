// Analyst View — B角色：监视清单 + 待处理预测列表 + 任务卡入口
const { useState, useMemo } = React;

const AnalystView = ({ data, onOpenPrediction, onOpenWatchlist, onNewTask }) => {
  const [activeTab, setActiveTab] = useState('predictions');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [activeWatchlist, setActiveWatchlist] = useState('all');

  const predictions = data.predictions.filter(p =>
    (filterStatus === 'ALL' || p.status === filterStatus) &&
    (activeWatchlist === 'all' || p.sourceRefId === activeWatchlist)
  );

  const stats = useMemo(() => {
    const all = data.predictions;
    return {
      proposed: all.filter(p => p.status === 'PROPOSED').length,
      tracking: all.filter(p => ['APPROVED', 'DISPATCHED'].includes(p.status)).length,
      completed: all.filter(p => p.status === 'COMPLETED').length,
      avgConf: Math.round(all.filter(p => p.status === 'PROPOSED').reduce((s, p) => s + p.confidence, 0) / Math.max(1, all.filter(p => p.status === 'PROPOSED').length)),
    };
  }, [data]);

  const getRegion = (id) => data.regions.find(r => r.id === id);

  return (
    <div className="page">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>监视清单</span>
            <button title="新建监视清单"><Icon name="plus" size={12} /></button>
          </div>
          <div className={`sidebar__item ${activeWatchlist === 'all' ? 'active' : ''}`} onClick={() => setActiveWatchlist('all')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="layers" size={13} />全部
            </span>
            <span className="sidebar__item-meta">{data.predictions.length}</span>
          </div>
          {data.watchlists.map(w => (
            <div key={w.id} className={`sidebar__item ${activeWatchlist === w.id ? 'active' : ''}`} onClick={() => setActiveWatchlist(w.id)} title={w.name}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="pin" size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
              </span>
              <span className="sidebar__item-meta">{w.activePredictions}</span>
            </div>
          ))}
        </div>

        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>任务卡（即时查询）</span>
            <button title="新建任务卡" onClick={onNewTask}><Icon name="plus" size={12} /></button>
          </div>
          <div className="sidebar__item">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="target" size={12} />粤西-高喷-单点</span>
            <span className="sidebar__item-meta">2h 前</span>
          </div>
          <div className="sidebar__item">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="target" size={12} />汕头-应急-单点</span>
            <span className="sidebar__item-meta">昨日</span>
          </div>
        </div>

        <div className="sidebar__group">
          <div className="sidebar__heading">区域</div>
          {data.regions.slice(0, 3).map(r => (
            <div key={r.id} className="sidebar__item" title={r.adminChain}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <Icon name={r.kind === 'ADMIN_NAMED' ? 'pin' : 'polygon'} size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              </span>
              <span className="sidebar__item-meta">v{r.version || '·'}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Workspace */}
      <main className="workspace">
        <PageHeader
          title="分析师工作台"
          sub="监视新闻信号 → 审证据 → 调置信度 → 推送给决策者"
          actions={
            <>
              <button className="btn"><Icon name="refresh" size={12} />立即重算</button>
              <button className="btn btn--primary" onClick={onNewTask}><Icon name="plus" size={12} />新建任务卡</button>
            </>
          }
        />

        <div className="workspace__body">
          {/* KPIs */}
          <div className="kpi-row" style={{ marginBottom: 'var(--sp-5)' }}>
            <div className="kpi">
              <div className="kpi__label">待批预测</div>
              <div className="kpi__value">{stats.proposed}<span className="kpi__delta kpi__delta--up">↑2 今日</span></div>
              <div className="kpi__sub">PROPOSED · 待 A 决策者审</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">在跟进</div>
              <div className="kpi__value">{stats.tracking}</div>
              <div className="kpi__sub">已批准 / 已调度</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">本月已复盘</div>
              <div className="kpi__value">{stats.completed}</div>
              <div className="kpi__sub">含 HIT/MISS/NO_DATA</div>
            </div>
            <div className="kpi">
              <div className="kpi__label">PROPOSED 均值置信度</div>
              <div className="kpi__value" style={{ color: 'var(--c-conf-mid)' }}>{stats.avgConf}<span style={{ fontSize: 16, color: 'var(--c-text-3)' }}>%</span></div>
              <div className="kpi__sub">≥60% 调度阈值</div>
            </div>
          </div>

          {/* Filter row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--sp-3)', alignItems: 'center' }}>
            <div className="tabs" style={{ borderBottom: 0, marginBottom: 0 }}>
              {['ALL', 'PROPOSED', 'APPROVED', 'DISPATCHED', 'COMPLETED', 'EXPIRED'].map(s => (
                <button key={s} className={`tabs__btn ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                  {s === 'ALL' ? '全部' : { PROPOSED: '待批', APPROVED: '已批', DISPATCHED: '调度中', COMPLETED: '已复盘', EXPIRED: '已过期' }[s]}
                  <span style={{ marginLeft: 6, color: 'var(--c-text-3)', fontSize: 11 }}>
                    {s === 'ALL' ? data.predictions.length : data.predictions.filter(p => p.status === s).length}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn--ghost btn--sm"><Icon name="filter" size={12} />筛选</button>
              <button className="btn btn--ghost btn--sm"><Icon name="download" size={12} />导出</button>
            </div>
          </div>

          {/* Predictions table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>ID</th>
                  <th>车类 · 任务</th>
                  <th>区域</th>
                  <th>时间窗</th>
                  <th>K</th>
                  <th>置信度 · CI</th>
                  <th>证据</th>
                  <th>状态</th>
                  <th>来源</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {predictions.map(p => {
                  const r = getRegion(p.regionId);
                  return (
                    <tr key={p.id} onClick={() => onOpenPrediction(p.id)}>
                      <td><span className="id-cell">{p.shortId}</span></td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p.vehicle}</div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{p.task}</div>
                      </td>
                      <td>
                        <div>{r?.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                          <Icon name={r?.kind === 'ADMIN_NAMED' ? 'pin' : 'polygon'} size={10} /> {r?.kind === 'ADMIN_NAMED' ? `v${r.version}` : '即时'}
                        </div>
                      </td>
                      <td className="num">
                        <div>{p.window.date}</div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{periodLabel(p.window.period)}</div>
                      </td>
                      <td className="num">
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontSize: 11,
                          background: p.kDays < 0 ? 'transparent' : p.kDays <= 3 ? 'var(--c-bad-soft)' : p.kDays <= 14 ? 'var(--c-warn-soft)' : 'var(--c-info-soft)',
                          color: p.kDays < 0 ? 'var(--c-text-3)' : p.kDays <= 3 ? 'var(--c-bad)' : p.kDays <= 14 ? 'var(--c-warn)' : 'var(--c-info)',
                        }}>{formatK(p.kDays)}</span>
                      </td>
                      <td>
                        <ConfBar value={p.confidence} ci={p.ci} showCI={!!p.ci} />
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 500 }}>{p.evidenceCount}</span>
                        <span style={{ color: 'var(--c-text-3)', fontSize: 11 }}> 条</span>
                      </td>
                      <td><Status value={p.status} /></td>
                      <td>
                        <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
                          {p.source === 'WATCHLIST' ? <><Icon name="layers" size={10} /> 监视清单</> : <><Icon name="target" size={10} /> 任务卡</>}
                        </span>
                      </td>
                      <td>
                        <Icon name="chevronRight" size={14} className="" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {predictions.length === 0 && (
              <div className="empty">该筛选下没有预测记录</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

window.AnalystView = AnalystView;
