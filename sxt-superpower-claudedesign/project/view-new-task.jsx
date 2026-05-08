// New Task Card creation flow — two entry modes:
// 1. Manual form (deterministic structured input)
// 2. Agent-assisted (natural language → parsed structured fields → analyst confirms)

const NewTaskCardModal = ({ data, onClose, onSubmit }) => {
  const [mode, setMode] = useState('agent'); // 'agent' | 'manual'

  // ===== Manual form state =====
  const [step, setStep] = useState(1); // 1=basics, 2=region, 3=window, 4=preview
  const [vehicle, setVehicle] = useState('');
  const [task, setTask] = useState('');
  const [regionMode, setRegionMode] = useState('NAMED'); // NAMED | AD_HOC
  const [regionId, setRegionId] = useState('');
  const [adHocPolygon, setAdHocPolygon] = useState(null);
  const [windowDate, setWindowDate] = useState('2026-05-12');
  const [windowPeriod, setWindowPeriod] = useState('AM');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');

  // ===== Agent state =====
  const [nlInput, setNlInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState(null);

  const VEHICLES = [
    { v: '高喷消防车', cat: '消防', desc: '高位喷射 / 抢险救援场景常用' },
    { v: '排涝车', cat: '抢险', desc: '内涝排水 / 风暴潮响应' },
    { v: '抢险车', cat: '抢险', desc: '综合型抢险 / 通用救援' },
    { v: '工程救援车', cat: '工程', desc: '塌方 / 救援打通' },
    { v: '化学事故救援车', cat: '化工', desc: '化学品泄漏专用' },
    { v: '执法专用车', cat: '执法', desc: '巡查 / 执法保障' },
  ];

  const TASKS = [
    '台风响应', '风暴潮', '应急演练', '内涝排水',
    '化工事故', '森林火险', '执法巡检', '海事应急', '抢险救援'
  ];

  const PERIODS = [
    { v: 'AM', label: '上午', range: '06:00-12:00' },
    { v: 'PM', label: '下午', range: '12:00-18:00' },
    { v: 'EVE', label: '夜间', range: '18:00-24:00' },
    { v: 'ALL', label: '全天', range: '00:00-24:00' },
  ];

  const valid = vehicle && task && (regionMode === 'NAMED' ? regionId : adHocPolygon) && windowDate && windowPeriod;

  // ===== Agent parsing simulation =====
  const handleAgentParse = async () => {
    setParsing(true);
    setParseError(null);
    setParsed(null);
    await new Promise(r => setTimeout(r, 1400));

    // Mock: parse common patterns from input
    const text = nlInput.toLowerCase();
    const detectedVehicle = VEHICLES.find(v => nlInput.includes(v.v.slice(0, 2)) || nlInput.includes(v.v));
    const detectedTask = TASKS.find(t => nlInput.includes(t.slice(0, 2)) || nlInput.includes(t));
    const detectedRegion = data.regions.find(r => nlInput.includes(r.name.slice(0, 4)) || nlInput.includes('粤西') || nlInput.includes('汕头') || nlInput.includes('珠江'));

    if (!detectedVehicle && !detectedTask && !detectedRegion) {
      setParseError('未能从描述中识别出关键维度。请补充具体车类、任务或区域。');
      setParsing(false);
      return;
    }

    setParsed({
      vehicle: detectedVehicle?.v || '高喷消防车',
      vehicleConf: detectedVehicle ? 0.92 : 0.45,
      task: detectedTask || '抢险救援',
      taskConf: detectedTask ? 0.88 : 0.50,
      regionId: detectedRegion?.id || data.regions[0].id,
      regionConf: detectedRegion ? 0.95 : 0.60,
      windowDate: text.includes('明天') ? '2026-05-07' : text.includes('周末') ? '2026-05-09' : '2026-05-12',
      windowDateConf: 0.78,
      windowPeriod: text.includes('下午') ? 'PM' : text.includes('夜') ? 'EVE' : 'AM',
      windowPeriodConf: 0.70,
      reasoning: [
        { step: '维度抽取', detail: `识别 ${detectedVehicle ? '✓ 车类' : '✗ 车类'} · ${detectedTask ? '✓ 任务' : '✗ 任务'} · ${detectedRegion ? '✓ 区域' : '✗ 区域'} · 时间窗（启发式）` },
        { step: '区域映射', detail: detectedRegion ? `匹配命名区域 ${detectedRegion.name} (v${detectedRegion.version})` : '未匹配命名区域，回退至默认' },
        { step: '冲突检查', detail: '与现有监视清单无重复 · 未触发频率上限' },
        { step: '输出', detail: '建议用户确认后提交，可在结构化区域微调' },
      ],
      tokensIn: 312,
      tokensOut: 184,
      latencyMs: 1380,
    });
    setParsing(false);
  };

  const adoptParsed = () => {
    if (!parsed) return;
    setVehicle(parsed.vehicle);
    setTask(parsed.task);
    setRegionId(parsed.regionId);
    setRegionMode('NAMED');
    setWindowDate(parsed.windowDate);
    setWindowPeriod(parsed.windowPeriod);
    setMode('manual');
    setStep(4);
  };

  return (
    <div className="detail-pane" onClick={onClose}>
      <div className="detail-pane__panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        {/* Header */}
        <div style={{ padding: 'var(--sp-5) var(--sp-6) var(--sp-3)', borderBottom: '1px solid var(--c-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-text-3)', fontFamily: 'var(--ff-mono)', marginBottom: 4 }}>NEW · AD_HOC_QUERY</div>
              <h2 style={{ margin: 0, fontSize: 19, letterSpacing: '-0.015em' }}>新建任务卡</h2>
              <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 4 }}>
                离散一次性查询 · 不持续监视 · 提交后立即生成 PROPOSED 预测
              </div>
            </div>
            <button className="btn btn--ghost" onClick={onClose}><Icon name="x" size={14} /></button>
          </div>

          {/* Mode toggle */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 'var(--sp-4)' }}>
            <button onClick={() => setMode('agent')}
              style={{
                padding: 'var(--sp-3) var(--sp-4)', textAlign: 'left',
                background: mode === 'agent' ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                border: '1px solid', borderColor: mode === 'agent' ? 'var(--c-accent)' : 'var(--c-line)',
                borderRadius: 'var(--rad-3)',
                display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start',
              }}>
              <div style={{
                width: 28, height: 28, borderRadius: 'var(--rad-2)',
                background: mode === 'agent' ? 'var(--c-accent)' : 'var(--c-panel-2)',
                color: mode === 'agent' ? 'white' : 'var(--c-text-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}><Icon name="zap" size={14} /></div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: mode === 'agent' ? 'var(--c-accent)' : 'var(--c-text)' }}>Agent 辅助</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2, lineHeight: 1.5 }}>自然语言描述 → LLM 解析为结构化字段 → 你确认后提交</div>
              </div>
            </button>
            <button onClick={() => setMode('manual')}
              style={{
                padding: 'var(--sp-3) var(--sp-4)', textAlign: 'left',
                background: mode === 'manual' ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                border: '1px solid', borderColor: mode === 'manual' ? 'var(--c-accent)' : 'var(--c-line)',
                borderRadius: 'var(--rad-3)',
                display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start',
              }}>
              <div style={{
                width: 28, height: 28, borderRadius: 'var(--rad-2)',
                background: mode === 'manual' ? 'var(--c-accent)' : 'var(--c-panel-2)',
                color: mode === 'manual' ? 'white' : 'var(--c-text-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}><Icon name="edit" size={14} /></div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: mode === 'manual' ? 'var(--c-accent)' : 'var(--c-text)' }}>结构化表单</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2, lineHeight: 1.5 }}>逐步选择车类 · 区域 · 时间窗 · 适合精确控制</div>
              </div>
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--sp-5) var(--sp-6)' }}>
          {mode === 'agent' && (
            <AgentMode
              nlInput={nlInput} setNlInput={setNlInput}
              parsing={parsing} parsed={parsed} parseError={parseError}
              onParse={handleAgentParse} onAdopt={adoptParsed}
              data={data}
            />
          )}

          {mode === 'manual' && (
            <ManualMode
              step={step} setStep={setStep}
              vehicle={vehicle} setVehicle={setVehicle}
              task={task} setTask={setTask}
              regionMode={regionMode} setRegionMode={setRegionMode}
              regionId={regionId} setRegionId={setRegionId}
              adHocPolygon={adHocPolygon} setAdHocPolygon={setAdHocPolygon}
              windowDate={windowDate} setWindowDate={setWindowDate}
              windowPeriod={windowPeriod} setWindowPeriod={setWindowPeriod}
              priority={priority} setPriority={setPriority}
              notes={notes} setNotes={setNotes}
              data={data}
              VEHICLES={VEHICLES} TASKS={TASKS} PERIODS={PERIODS}
              valid={valid}
              onSubmit={() => { onSubmit?.({ vehicle, task, regionId, windowDate, windowPeriod, priority, notes }); onClose(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ===== Agent Mode =====
const AgentMode = ({ nlInput, setNlInput, parsing, parsed, parseError, onParse, onAdopt, data }) => {
  const examples = [
    '我想看下周一上午粤西沿海会不会有高喷消防车出动应对台风',
    '汕头湾这两天风暴潮，应急救援车有没有出动可能',
    '查珠江口岸明天下午执法专用车的巡检',
  ];
  const region = parsed ? data.regions.find(r => r.id === parsed.regionId) : null;

  return (
    <div className="split">
      <div>
        <div className="section-h" style={{ marginBottom: 8 }}>
          <div className="section-h__title">用一句话描述你想查的预测</div>
          <span className="section-h__sub">PredictionAgent · deepseek-v4-flash</span>
        </div>
        <div style={{ position: 'relative' }}>
          <textarea
            value={nlInput} onChange={e => setNlInput(e.target.value)}
            placeholder="例：粤西沿海下周一上午的高喷消防车出动情况"
            rows={4}
            style={{
              width: '100%', padding: 'var(--sp-3)',
              fontSize: 13, lineHeight: 1.6,
              background: 'var(--c-bg-1)',
              border: '1px solid var(--c-line)', borderRadius: 'var(--rad-3)',
              color: 'var(--c-text)', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ position: 'absolute', right: 10, bottom: 10, fontSize: 10.5, color: 'var(--c-text-3)' }}>
            {nlInput.length} / 280
          </div>
        </div>

        {/* Quick examples */}
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>示例</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {examples.map((e, i) => (
              <button key={i} onClick={() => setNlInput(e)}
                style={{
                  padding: '6px 10px', fontSize: 11.5, textAlign: 'left',
                  background: 'var(--c-bg-1)', border: '1px solid var(--c-line)',
                  borderRadius: 'var(--rad-2)', color: 'var(--c-text-2)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                <span>{e}</span>
                <Icon name="arrowRight" size={11} className="" />
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn--primary" onClick={onParse} disabled={!nlInput.trim() || parsing}>
            {parsing ? <><Icon name="refresh" size={12} /> 解析中…</> : <><Icon name="zap" size={12} /> 解析为结构化字段</>}
          </button>
          {parsing && <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>正在调用 LLM · 平均 1-2 秒</span>}
          {parseError && <span style={{ fontSize: 11.5, color: 'var(--c-bad)' }}>⚠ {parseError}</span>}
        </div>

        {parsing && (
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <SkeletonRow />
            <SkeletonRow w="60%" />
            <SkeletonRow w="80%" />
          </div>
        )}

        {parsed && (
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <div className="section-h">
              <div className="section-h__title">解析结果</div>
              <span className="section-h__sub">单个字段置信度 · 可点击微调</span>
            </div>
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <ParsedField label="车类" value={parsed.vehicle} conf={parsed.vehicleConf} />
              <ParsedField label="任务" value={parsed.task} conf={parsed.taskConf} />
              <ParsedField label="区域" value={`${region?.name || '—'}`} sub={region ? `${region.kind === 'ADMIN_NAMED' ? '命名区域 v' + region.version : '即时区域'} · ${region.area}` : ''} conf={parsed.regionConf} />
              <ParsedField label="时间窗" value={`${parsed.windowDate} · ${periodLabel(parsed.windowPeriod)}`} conf={Math.min(parsed.windowDateConf, parsed.windowPeriodConf)} last />
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 'var(--sp-3)' }}>
              <button className="btn btn--primary" onClick={onAdopt}><Icon name="check" size={12} />采纳并预览</button>
              <button className="btn btn--ghost" onClick={onParse}><Icon name="refresh" size={12} />重新解析</button>
            </div>
          </div>
        )}
      </div>

      {/* Right rail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {parsed && (
          <Card title="Agent 推理链" sub={`${parsed.latencyMs}ms · in ${parsed.tokensIn}t · out ${parsed.tokensOut}t`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {parsed.reasoning.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: 'var(--c-accent-soft)', color: 'var(--c-accent)',
                    fontSize: 10, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>{i + 1}</span>
                  <div>
                    <div style={{ color: 'var(--c-text-2)', fontWeight: 500 }}>{r.step}</div>
                    <div style={{ color: 'var(--c-text-3)', fontSize: 11, marginTop: 1 }}>{r.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card title="约束提示">
          <div style={{ fontSize: 11, color: 'var(--c-text-2)', lineHeight: 1.7 }}>
            <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
              <Icon name="check" size={11} className="" />
              <span>任务卡是<b>一次性</b>查询，不会持续监视</span>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
              <Icon name="check" size={11} className="" />
              <span>提交后立即触发 FULL 全量预测，约 30s 后产出 PROPOSED</span>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
              <Icon name="check" size={11} className="" />
              <span>所有解析过程纳入 OperationAudit</span>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '4px 0' }}>
              <Icon name="alertTri" size={11} className="" />
              <span style={{ color: 'var(--c-warn)' }}>解析置信度 &lt;60% 的字段会标黄要求确认</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

const SkeletonRow = ({ w = '100%' }) => (
  <div style={{
    height: 14, width: w, borderRadius: 4,
    background: 'linear-gradient(90deg, var(--c-panel-2) 0%, var(--c-bg-2) 50%, var(--c-panel-2) 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s infinite',
    marginBottom: 8,
  }} />
);

const ParsedField = ({ label, value, sub, conf, last }) => {
  const isLow = conf < 0.6;
  return (
    <div style={{
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--c-line)',
      display: 'grid', gridTemplateColumns: '90px 1fr auto auto', gap: 12,
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: isLow ? 'var(--c-warn)' : 'var(--c-text)' }}>{value}</div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>{sub}</div>}
      </div>
      <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: isLow ? 'var(--c-warn)' : 'var(--c-text-2)' }}>
        {Math.round(conf * 100)}%
      </span>
      <button style={{
        padding: '3px 8px', fontSize: 11,
        color: 'var(--c-accent)',
        border: '1px solid var(--c-line)',
        borderRadius: 4, background: 'transparent',
      }}>修改</button>
    </div>
  );
};

// ===== Manual Mode =====
const ManualMode = ({
  step, setStep,
  vehicle, setVehicle, task, setTask,
  regionMode, setRegionMode, regionId, setRegionId,
  windowDate, setWindowDate, windowPeriod, setWindowPeriod,
  priority, setPriority, notes, setNotes,
  data, VEHICLES, TASKS, PERIODS, valid, onSubmit,
}) => {
  return (
    <div>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 'var(--sp-5)', padding: '0 var(--sp-2)' }}>
        {[
          { n: 1, label: '车类 · 任务' },
          { n: 2, label: '区域' },
          { n: 3, label: '时间窗' },
          { n: 4, label: '预览 · 提交' },
        ].map((s, i, arr) => (
          <React.Fragment key={s.n}>
            <button onClick={() => setStep(s.n)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 10px',
              borderRadius: 'var(--rad-2)',
              background: step === s.n ? 'var(--c-accent-soft)' : 'transparent',
              cursor: 'pointer',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: step >= s.n ? 'var(--c-accent)' : 'var(--c-panel-2)',
                color: step >= s.n ? 'white' : 'var(--c-text-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
              }}>{step > s.n ? '✓' : s.n}</span>
              <span style={{
                fontSize: 12, fontWeight: step === s.n ? 600 : 400,
                color: step === s.n ? 'var(--c-accent)' : step > s.n ? 'var(--c-text-2)' : 'var(--c-text-3)',
              }}>{s.label}</span>
            </button>
            {i < arr.length - 1 && (
              <div style={{ flex: 1, height: 1, background: step > s.n ? 'var(--c-accent)' : 'var(--c-line)', margin: '0 4px' }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step bodies */}
      {step === 1 && (
        <div className="split">
          <div>
            <div className="section-h" style={{ marginBottom: 8 }}>
              <div className="section-h__title">选择车类</div>
              <span className="section-h__sub">CN/T 19999 国标分类</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {VEHICLES.map(v => (
                <button key={v.v} onClick={() => setVehicle(v.v)}
                  style={{
                    padding: 'var(--sp-3)', textAlign: 'left',
                    border: '1px solid', borderColor: vehicle === v.v ? 'var(--c-accent)' : 'var(--c-line)',
                    background: vehicle === v.v ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                    borderRadius: 'var(--rad-2)',
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: vehicle === v.v ? 'var(--c-accent)' : 'var(--c-text)' }}>{v.v}</span>
                    <Tag kind="ghost">{v.cat}</Tag>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 4 }}>{v.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="section-h" style={{ marginBottom: 8 }}>
              <div className="section-h__title">选择任务</div>
              <span className="section-h__sub">应急 / 抢险 / 巡查场景</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TASKS.map(t => (
                <button key={t} onClick={() => setTask(t)}
                  style={{
                    padding: '6px 12px', fontSize: 12,
                    border: '1px solid', borderColor: task === t ? 'var(--c-accent)' : 'var(--c-line)',
                    background: task === t ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                    color: task === t ? 'var(--c-accent)' : 'var(--c-text-2)',
                    borderRadius: 999,
                  }}>{t}</button>
              ))}
            </div>
            <div className="divider"></div>
            <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>优先级</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { v: 'low', label: '低', desc: '常规' },
                { v: 'normal', label: '正常', desc: '默认' },
                { v: 'high', label: '高', desc: '触发即时通知' },
              ].map(p => (
                <button key={p.v} onClick={() => setPriority(p.v)}
                  style={{
                    flex: 1, padding: 'var(--sp-2) var(--sp-3)', textAlign: 'left',
                    border: '1px solid', borderColor: priority === p.v ? 'var(--c-accent)' : 'var(--c-line)',
                    background: priority === p.v ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                    borderRadius: 'var(--rad-2)',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: priority === p.v ? 'var(--c-accent)' : 'var(--c-text)' }}>{p.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="split">
          <div>
            <div className="section-h" style={{ marginBottom: 8 }}>
              <div className="section-h__title">区域定义</div>
              <span className="section-h__sub">命名区域 = 行政片区 · 即时区域 = 框选 polygon</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--sp-3)' }}>
              <button onClick={() => setRegionMode('NAMED')}
                className={`btn ${regionMode === 'NAMED' ? 'btn--primary' : ''}`}>
                <Icon name="pin" size={11} />命名区域
              </button>
              <button onClick={() => setRegionMode('AD_HOC')}
                className={`btn ${regionMode === 'AD_HOC' ? 'btn--primary' : ''}`}>
                <Icon name="polygon" size={11} />即时框选
              </button>
            </div>
            {regionMode === 'NAMED' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.regions.filter(r => r.kind === 'ADMIN_NAMED').map(r => (
                  <button key={r.id} onClick={() => setRegionId(r.id)}
                    style={{
                      padding: 'var(--sp-3)', textAlign: 'left',
                      border: '1px solid', borderColor: regionId === r.id ? 'var(--c-accent)' : 'var(--c-line)',
                      background: regionId === r.id ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                      borderRadius: 'var(--rad-2)',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--c-text-3)' }}>v{r.version} · {r.area}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', marginTop: 2 }}>{r.adminChain}</div>
                  </button>
                ))}
              </div>
            )}
            {regionMode === 'AD_HOC' && (
              <div className="map-stub" style={{ height: 280, position: 'relative' }}>
                <div className="map-stub__grid"></div>
                <svg width="100%" height="100%" viewBox="0 0 400 280" style={{ position: 'absolute', inset: 0 }}>
                  <polygon points="80,80 200,60 280,110 250,200 110,180" fill="rgba(78,163,255,0.18)" stroke="var(--c-accent)" strokeWidth="2" strokeDasharray="6,4" />
                  {[[80, 80], [200, 60], [280, 110], [250, 200], [110, 180]].map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r="4" fill="var(--c-accent)" stroke="var(--c-bg-1)" strokeWidth="1.5" />
                  ))}
                </svg>
                <div className="map-stub__attribution">高德地图企业版 · 拖动顶点编辑 polygon</div>
                <div style={{ position: 'absolute', top: 10, left: 10, fontSize: 10.5, color: 'var(--c-text-2)', background: 'var(--c-bg)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--c-line)' }}>
                  5 顶点 · 约 38 km²
                </div>
              </div>
            )}
          </div>
          <div>
            <Card title="区域预览">
              <div className="map-stub" style={{ height: 200, position: 'relative' }}>
                <div className="map-stub__grid"></div>
                <svg width="100%" height="100%" viewBox="0 0 220 200" style={{ position: 'absolute', inset: 0 }}>
                  <polygon points="40,40 110,30 180,55 165,160 60,150" fill="rgba(78,163,255,0.18)" stroke="var(--c-accent)" strokeWidth="1.5" />
                </svg>
                <div className="map-stub__attribution">区域中心：113.5°E, 21.4°N</div>
              </div>
              <div className="divider"></div>
              <div style={{ fontSize: 11, color: 'var(--c-text-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--c-text-3)' }}>命名链</span>
                  <span>{regionMode === 'NAMED' ? data.regions.find(r => r.id === regionId)?.adminChain || '—' : '即时框选'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--c-text-3)' }}>覆盖摄像头</span>
                  <span>预计 8-12 个</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--c-text-3)' }}>历史样本</span>
                  <span>{regionMode === 'NAMED' ? '32 起' : '0 起'}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="split">
          <div>
            <div className="section-h" style={{ marginBottom: 8 }}>
              <div className="section-h__title">时间窗</div>
              <span className="section-h__sub">日期 + 时段 · 决定 K 值</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>日期</div>
                <input type="date" value={windowDate} onChange={e => setWindowDate(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: 13,
                    background: 'var(--c-bg-1)', border: '1px solid var(--c-line)',
                    borderRadius: 'var(--rad-2)', color: 'var(--c-text)',
                  }} />
                <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', marginTop: 4 }}>
                  K = <b style={{ color: 'var(--c-accent)' }}>{Math.ceil((new Date(windowDate) - new Date('2026-05-06')) / 86400000)}</b> 天 · 当前 cadence：每日 1 次
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>时段</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {PERIODS.map(p => (
                    <button key={p.v} onClick={() => setWindowPeriod(p.v)}
                      style={{
                        padding: '6px', fontSize: 12,
                        border: '1px solid', borderColor: windowPeriod === p.v ? 'var(--c-accent)' : 'var(--c-line)',
                        background: windowPeriod === p.v ? 'var(--c-accent-soft)' : 'var(--c-bg-1)',
                        color: windowPeriod === p.v ? 'var(--c-accent)' : 'var(--c-text-2)',
                        borderRadius: 'var(--rad-2)', textAlign: 'left',
                      }}>
                      <div style={{ fontWeight: 500 }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{p.range}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="divider"></div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>备注（可选）</div>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} placeholder="例：上级口头通知预案启动，需要提前查看…"
              style={{
                width: '100%', padding: 8, fontSize: 12,
                background: 'var(--c-bg-1)', border: '1px solid var(--c-line)',
                borderRadius: 'var(--rad-2)', color: 'var(--c-text)',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
          </div>
          <Card title="时间窗影响">
            <div style={{ fontSize: 11.5, color: 'var(--c-text-2)', lineHeight: 1.7 }}>
              <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 4, marginBottom: 8 }}>
                <div style={{ color: 'var(--c-text-3)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>K 范围 → cadence</div>
                <div>K ≤ 3 → 每 6h 重算</div>
                <div>3 &lt; K ≤ 14 → 每天</div>
                <div>14 &lt; K ≤ 60 → 每 2 天</div>
                <div>K &gt; 60 → 每周</div>
              </div>
              <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 4, borderLeft: '2px solid var(--c-info)' }}>
                <Icon name="info" size={11} className="" />
                <span style={{ marginLeft: 4 }}>任务卡 K=0（今日）会触发即时 FULL，约 30s 出结果。</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className="section-h" style={{ marginBottom: 8 }}>
            <div className="section-h__title">预览 · 提交</div>
            <span className="section-h__sub">提交后立即创建 AdHocQuery + 触发 PredictionAgent</span>
          </div>
          <div className="card" style={{ padding: 'var(--sp-5)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
              <PreviewField label="车类" value={vehicle || '—'} icon="layers" />
              <PreviewField label="任务" value={task || '—'} icon="target" />
              <PreviewField label="区域" value={regionMode === 'NAMED' ? (data.regions.find(r => r.id === regionId)?.name || '—') : '即时框选 polygon'} icon="pin" />
              <PreviewField label="时间窗" value={`${windowDate} · ${periodLabel(windowPeriod)}`} icon="clock" />
              <PreviewField label="优先级" value={priority === 'low' ? '低' : priority === 'high' ? '高' : '正常'} icon="flag" />
              <PreviewField label="K 值" value={`${Math.ceil((new Date(windowDate) - new Date('2026-05-06')) / 86400000)} 天`} icon="zap" />
            </div>
            {notes && (
              <div style={{ padding: 'var(--sp-3)', background: 'var(--c-bg-1)', borderRadius: 4, fontSize: 11.5, color: 'var(--c-text-2)' }}>
                <div style={{ color: 'var(--c-text-3)', fontSize: 10.5, marginBottom: 4 }}>备注</div>
                {notes}
              </div>
            )}
          </div>

          {/* Submission preview — what happens next */}
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <div className="section-h"><div className="section-h__title">提交后执行</div></div>
            <div className="card" style={{ padding: 0 }}>
              {[
                { t: 't+0s', a: '创建 AdHocQuery 记录', detail: 'INSERT into ad_hoc_query (operator=陈云岭, payload=…)' },
                { t: 't+1s', a: '触发 PredictionAgent', detail: '调用 dashscope deepseek-v4-flash · 检索 BM25 案例库' },
                { t: 't+~30s', a: '生成 PROPOSED 预测', detail: '可能产出 1 条预测，状态 PROPOSED · 进入收件箱' },
                { t: '同步', a: '记入操作审计', detail: 'audit.operation_audit · INSERT-only' },
              ].map((s, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '70px 200px 1fr', gap: 12,
                  padding: '8px 16px', borderBottom: '1px solid var(--c-line)', fontSize: 11.5,
                  alignItems: 'center',
                }}>
                  <span style={{ fontFamily: 'var(--ff-mono)', color: 'var(--c-accent)' }}>{s.t}</span>
                  <span style={{ color: 'var(--c-text)' }}>{s.a}</span>
                  <span style={{ color: 'var(--c-text-3)', fontSize: 11 }}>{s.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--c-line)' }}>
        <button className="btn btn--ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>
          ← 上一步
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          {step < 4 ? (
            <button className="btn btn--primary" onClick={() => setStep(step + 1)}
              disabled={(step === 1 && (!vehicle || !task)) || (step === 2 && regionMode === 'NAMED' && !regionId)}>
              下一步 →
            </button>
          ) : (
            <>
              <button className="btn btn--ghost">保存草稿</button>
              <button className="btn btn--primary" onClick={onSubmit} disabled={!valid}>
                <Icon name="zap" size={12} />提交并触发预测
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const PreviewField = ({ label, value, icon }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    <div style={{
      width: 28, height: 28, borderRadius: 'var(--rad-2)',
      background: 'var(--c-accent-soft)', color: 'var(--c-accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}><Icon name={icon} size={13} /></div>
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{value}</div>
    </div>
  </div>
);

window.NewTaskCardModal = NewTaskCardModal;
