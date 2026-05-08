// Mock data for the Camera-News Prediction System prototype
// Slice 0 placeholders: V=应急救援车, T=抢险救援, R=广东沿海

window.SYSTEM_DATA = (() => {
  const now = new Date('2026-05-06T09:00:00+08:00');

  const users = [
    { id: 'u1', name: '陈云岭', email: 'chen@central-disc.gov', roles: ['DECIDER', 'ANALYST', 'REVIEWER'] },
  ];

  const regions = [
    { id: 'r-yj-coast', kind: 'ADMIN_NAMED', name: '粤西沿海应急片区', version: 2, parent: '广东省', adminChain: '中国 / 广东省 / 茂名市 / 电白区+滨海新区', area: '1,243 km²' },
    { id: 'r-pearl', kind: 'ADMIN_NAMED', name: '珠江口岸高速段', version: 1, parent: '广东省', adminChain: '中国 / 广东省 / 广州市 / 南沙区', area: '186 km²' },
    { id: 'r-zhuhai', kind: 'AD_HOC', name: '横琴—澳门口岸临时区', version: null, parent: null, adminChain: '即时框选', area: '24 km²' },
    { id: 'r-shantou', kind: 'ADMIN_NAMED', name: '汕头湾沿海风暴潮带', version: 1, parent: '广东省', adminChain: '中国 / 广东省 / 汕头市', area: '402 km²' },
  ];

  const watchlists = [
    { id: 'wl-1', name: '粤西台风季应急救援车监视', vehicle: '应急救援车 / 抢险救援车', task: '抢险救援', regionId: 'r-yj-coast', kRange: '3-14 天', activePredictions: 6, createdBy: 'u1', updatedAt: '2026-05-04 09:12' },
    { id: 'wl-2', name: '珠三角执法巡查公车', vehicle: '执法专用车 / 公务巡查车', task: '执法巡检', regionId: 'r-pearl', kRange: '1-7 天', activePredictions: 3, createdBy: 'u1', updatedAt: '2026-05-02 15:40' },
    { id: 'wl-3', name: '汕头湾抢险联动监视', vehicle: '应急救援车', task: '抢险救援', regionId: 'r-shantou', kRange: '7-30 天', activePredictions: 2, createdBy: 'u1', updatedAt: '2026-04-28 11:00' },
  ];

  const predictions = [
    {
      id: 'P-2026-0511-A',
      shortId: '0511-A',
      source: 'WATCHLIST', sourceRefId: 'wl-1',
      vehicle: '应急救援车 · 高喷消防车',
      task: '抢险救援',
      regionId: 'r-yj-coast',
      window: { date: '2026-05-11', period: 'AM' },
      kDays: 5,
      confidence: 78,
      ci: [71, 84],
      status: 'PROPOSED',
      cadence: '每日 1 次',
      lastFullAt: '2026-05-05 06:00',
      lastIncrAt: '2026-05-06 06:00',
      driftPp: 6,
      evidenceCount: 14,
      sourcesMix: { 主流: 8, 政务: 4, 社交: 2, 外文: 0 },
      analyst: '陈云岭',
      reasoning: '台风"海葵"5 月 9 日登陆粤西概率 73%。茂名应急局 5 月 4 日《防御台风预案》明确启动 II 级响应；茂名消防 5 月 5 日例会决议提前调度 3 台高喷消防车。结合 2024 年同类响应 5/6 次出动，AM 出动概率显著高于 PM。',
      tags: ['台风季', 'II级响应', '历史一致']
    },
    {
      id: 'P-2026-0509-B',
      shortId: '0509-B',
      source: 'TASKCARD', sourceRefId: 't-card-3',
      vehicle: '应急救援车 · 重型抢险车',
      task: '抢险救援',
      regionId: 'r-shantou',
      window: { date: '2026-05-09', period: 'PM' },
      kDays: 3,
      confidence: 64,
      ci: [56, 71],
      status: 'PROPOSED',
      cadence: '每 6 小时',
      lastFullAt: '2026-05-04 18:00',
      lastIncrAt: '2026-05-06 06:00',
      driftPp: 12,
      evidenceCount: 9,
      sourcesMix: { 主流: 5, 政务: 2, 社交: 2, 外文: 0 },
      analyst: '陈云岭',
      reasoning: '汕头湾 5 月 8-10 日风暴潮黄色预警，海洋局公告显示 PM 时段为高潮位。但本次预案未明示是否调用重型抢险车，故置信度偏中。',
      tags: ['风暴潮', '高潮位']
    },
    {
      id: 'P-2026-0510-C',
      shortId: '0510-C',
      source: 'WATCHLIST', sourceRefId: 'wl-2',
      vehicle: '执法专用车',
      task: '执法巡检',
      regionId: 'r-pearl',
      window: { date: '2026-05-10', period: 'AM' },
      kDays: 4,
      confidence: 42,
      ci: [33, 51],
      status: 'PROPOSED',
      cadence: '每日 1 次',
      lastFullAt: '2026-05-04 06:00',
      lastIncrAt: '2026-05-06 06:00',
      driftPp: 3,
      evidenceCount: 5,
      sourcesMix: { 主流: 2, 政务: 2, 社交: 1, 外文: 0 },
      analyst: '陈云岭',
      reasoning: '南沙区交通局周末例行执法计划存在但未指定具体路段；社交媒体提及强度中等；建议低置信度，不推送调度。',
      tags: ['例行', '低强度信号']
    },
    {
      id: 'P-2026-0508-D',
      shortId: '0508-D',
      source: 'WATCHLIST', sourceRefId: 'wl-1',
      vehicle: '应急救援车',
      task: '抢险救援',
      regionId: 'r-yj-coast',
      window: { date: '2026-05-08', period: 'AM' },
      kDays: 2,
      confidence: 86,
      ci: [81, 90],
      status: 'APPROVED',
      cadence: '每 6 小时',
      lastFullAt: '2026-05-06 00:00',
      lastIncrAt: '2026-05-06 06:00',
      driftPp: 2,
      evidenceCount: 18,
      sourcesMix: { 主流: 9, 政务: 5, 社交: 3, 外文: 1 },
      analyst: '陈云岭',
      reasoning: '台风预报路径稳定、登陆点已确认、应急办预案已发布。证据收敛度高。',
      tags: ['登陆确认', '高收敛'],
      approvedBy: '陈云岭(决策态)', approvedAt: '2026-05-06 08:14',
      dispatchTaskId: 'D-2026-0508-A1'
    },
    {
      id: 'P-2026-0506-E',
      shortId: '0506-E',
      source: 'WATCHLIST', sourceRefId: 'wl-1',
      vehicle: '应急救援车',
      task: '抢险救援',
      regionId: 'r-yj-coast',
      window: { date: '2026-05-06', period: 'AM' },
      kDays: 0,
      confidence: 91,
      ci: [88, 94],
      status: 'DISPATCHED',
      cadence: '已调度',
      lastFullAt: '2026-05-05 18:00',
      evidenceCount: 22,
      sourcesMix: { 主流: 11, 政务: 6, 社交: 4, 外文: 1 },
      tags: ['执行中'],
      dispatchTaskId: 'D-2026-0506-A1'
    },
    {
      id: 'P-2026-0429-F',
      shortId: '0429-F',
      source: 'WATCHLIST', sourceRefId: 'wl-1',
      vehicle: '应急救援车 · 高喷消防车',
      task: '抢险救援',
      regionId: 'r-yj-coast',
      window: { date: '2026-04-29', period: 'PM' },
      kDays: -7,
      confidence: 74,
      status: 'COMPLETED',
      evidenceCount: 16,
      tags: ['已复盘'],
      retrospectiveId: 'RV-2026-0429-F'
    },
    {
      id: 'P-2026-0425-G',
      shortId: '0425-G',
      source: 'WATCHLIST', sourceRefId: 'wl-2',
      vehicle: '执法专用车',
      task: '执法巡检',
      regionId: 'r-pearl',
      window: { date: '2026-04-25', period: 'AM' },
      kDays: -11,
      confidence: 58,
      status: 'COMPLETED',
      evidenceCount: 6,
      tags: ['已复盘'],
      retrospectiveId: 'RV-2026-0425-G'
    },
    {
      id: 'P-2026-0420-H',
      shortId: '0420-H',
      source: 'WATCHLIST', sourceRefId: 'wl-3',
      vehicle: '应急救援车',
      task: '抢险救援',
      regionId: 'r-shantou',
      window: { date: '2026-04-20', period: 'AM' },
      kDays: -16,
      confidence: 35,
      status: 'EXPIRED',
      evidenceCount: 3,
      tags: ['过期未调度'],
      retrospectiveId: 'RV-2026-0420-H'
    },
  ];

  // Confidence snapshots for the focused prediction P-2026-0511-A
  const confidenceTimeline = {
    'P-2026-0511-A': [
      { ts: '2026-05-02 06:00', kind: 'FULL', conf: 41, evidence: 3, note: '初次锚点。证据稀疏，仅气象部门预警。', operator: 'PredictionAgent' },
      { ts: '2026-05-02 18:00', kind: 'INCR', conf: 46, evidence: 5, note: '+2 条主流新闻：登陆点缩小至粤西。', operator: 'PredictionAgent' },
      { ts: '2026-05-03 06:00', kind: 'INCR', conf: 53, evidence: 7, note: '+2 条政务公告：茂名启动 III 级响应。', operator: 'PredictionAgent' },
      { ts: '2026-05-03 18:00', kind: 'INCR', conf: 58, evidence: 8, note: '+1 条社交媒体讨论。', operator: 'PredictionAgent' },
      { ts: '2026-05-04 06:00', kind: 'INCR', conf: 62, evidence: 10, note: '+2 条主流新闻：消防演练。', operator: 'PredictionAgent' },
      { ts: '2026-05-04 14:00', kind: 'MANUAL', conf: 70, evidence: 10, note: '分析师手动上调：本地消防部门内部例会决议提前调度，外部新闻未覆盖。', operator: '陈云岭(分析态)' },
      { ts: '2026-05-05 06:00', kind: 'FULL', conf: 73, evidence: 12, note: '触发 P1（5 次 INCR）→ 全量重算。新锚点建立，与人工修正一致。', operator: 'PredictionAgent' },
      { ts: '2026-05-05 18:00', kind: 'INCR', conf: 76, evidence: 13, note: '+1 条政务：II 级响应升级。', operator: 'PredictionAgent' },
      { ts: '2026-05-06 06:00', kind: 'INCR', conf: 78, evidence: 14, note: '+1 条主流：登陆时间窗确认。', operator: 'PredictionAgent' },
    ],
  };

  // Evidence chain for P-2026-0511-A
  const evidence = {
    'P-2026-0511-A': [
      { id: 'n1', source: 'gov', sourceLabel: '茂名应急局官网', title: '关于启动防御 5 号台风"海葵"II 级应急响应的通知', url: 'https://emerg.maoming.gov.cn/2026/05/...', pubAt: '2026-05-04 11:30', weight: 'HIGH', cited: true, snippet: '...各级应急救援队伍立即进入待命状态，重型抢险救援装备前置至沿海一线...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n2', source: 'mainstream', sourceLabel: '南方日报', title: '"海葵"逼近粤西 茂名启动 II 级应急响应', url: 'https://www.southcn.com/news/2026/05/...', pubAt: '2026-05-04 14:22', weight: 'HIGH', cited: true, snippet: '预计 8 日夜间至 9 日白天在阳江到湛江一带沿海登陆...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n3', source: 'gov', sourceLabel: '广东省气象局', title: '广东省气象台 5 月 5 日 17 时台风警报', url: 'https://gd.weather.com.cn/2026/...', pubAt: '2026-05-05 17:00', weight: 'HIGH', cited: true, snippet: '...红色预警信号生效中...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n4', source: 'mainstream', sourceLabel: '羊城晚报', title: '茂名消防演练高喷消防车协同作业', url: 'https://ycwb.com/2026/05/...', pubAt: '2026-05-04 19:05', weight: 'MED', cited: true, snippet: '...3 台高喷消防车前置到电白区...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n5', source: 'social', sourceLabel: '微博 @茂名应急', title: '【应急联动】高喷消防车已部署到位', url: 'https://weibo.com/u/...', pubAt: '2026-05-05 20:14', weight: 'MED', cited: true, snippet: '前置点：电白区博贺镇、滨海新区...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n6', source: 'gov', sourceLabel: '茂名市政府新闻办', title: '5 月 5 日防风工作会议召开', url: 'https://maoming.gov.cn/news/...', pubAt: '2026-05-05 22:40', weight: 'HIGH', cited: true, snippet: '...重型抢险车队 8 日凌晨完成前置部署...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n7', source: 'mainstream', sourceLabel: '新华社广东', title: '海葵将于 8 日夜登陆 粤西全面进入战时状态', url: 'https://gd.xinhua.com/...', pubAt: '2026-05-06 06:30', weight: 'HIGH', cited: true, snippet: '...AM 时段为登陆窗口...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n8', source: 'mainstream', sourceLabel: '人民日报', title: '广东多地启动防台预案', url: 'https://people.com.cn/...', pubAt: '2026-05-04 15:40', weight: 'MED', cited: true, snippet: '...粤西、粤东沿海地市同步启动...', regions: ['r-yj-coast', 'r-shantou'], origin: 'domestic' },
      { id: 'n9', source: 'mainstream', sourceLabel: '广州日报', title: '应急救援车队整装待发', url: 'https://gzdaily.cn/...', pubAt: '2026-05-04 16:00', weight: 'MED', cited: true, snippet: '...省消防总队前置 5 个救援组...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n10', source: 'social', sourceLabel: '抖音 #粤西防台', title: '现场视频：沙包堆放与车辆前置', url: 'https://www.douyin.com/...', pubAt: '2026-05-05 11:20', weight: 'LOW', cited: false, snippet: '车辆型号识别：高喷消防车 1 台、抢险车 2 台...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n11', source: 'mainstream', sourceLabel: '深圳特区报', title: '深圳消防驰援粤西', url: 'https://sztqb.com/...', pubAt: '2026-05-05 09:00', weight: 'LOW', cited: false, snippet: '...深圳消防 2 台高喷消防车增援茂名...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n12', source: 'gov', sourceLabel: '应急管理部', title: '广东台风"海葵"防御工作部署', url: 'https://mem.gov.cn/...', pubAt: '2026-05-05 14:30', weight: 'HIGH', cited: true, snippet: '...统筹调度高喷消防车等重型装备...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n13', source: 'social', sourceLabel: '微信公众号 茂名发布', title: '【台风预警】请市民关注最新动态', url: 'https://mp.weixin.qq.com/...', pubAt: '2026-05-05 16:00', weight: 'MED', cited: true, snippet: '...电白区已部署应急救援力量...', regions: ['r-yj-coast'], origin: 'domestic' },
      { id: 'n14', source: 'mainstream', sourceLabel: '南方日报', title: '海葵登陆窗口确认在 11 日 AM', url: 'https://www.southcn.com/news/2026/05/06/...', pubAt: '2026-05-06 05:50', weight: 'HIGH', cited: true, snippet: '...气象台最新研判，登陆时间窗口确定为 11 日上午 6-10 时...', regions: ['r-yj-coast'], origin: 'domestic' },
    ],
  };

  // Dispatch tasks
  const dispatches = [
    { id: 'D-2026-0508-A1', predictionId: 'P-2026-0508-D', adapter: 'gov-cam-gd-01', adapterName: '广东省应急摄像头平台', cameras: ['CAM-MM-001 茂名博贺港', 'CAM-MM-007 电白区高速口', 'CAM-MM-013 滨海大道'], state: 'IN_PROGRESS', sentAt: '2026-05-06 08:15', expectedEnd: '2026-05-08 14:00', cost: '¥3,000', mediaCount: 0 },
    { id: 'D-2026-0506-A1', predictionId: 'P-2026-0506-E', adapter: 'gov-cam-gd-01', adapterName: '广东省应急摄像头平台', cameras: ['CAM-MM-001', 'CAM-MM-007'], state: 'IN_PROGRESS', sentAt: '2026-05-06 05:00', expectedEnd: '2026-05-06 12:00', cost: '¥2,000', mediaCount: 4 },
    { id: 'D-2026-0429-A1', predictionId: 'P-2026-0429-F', adapter: 'gov-cam-gd-01', adapterName: '广东省应急摄像头平台', cameras: ['CAM-MM-001'], state: 'COMPLETED', sentAt: '2026-04-29 04:00', endedAt: '2026-04-29 18:00', cost: '¥1,000', mediaCount: 6 },
    { id: 'D-2026-0425-A1', predictionId: 'P-2026-0425-G', adapter: 'saas-cam-cn-02', adapterName: '城市公共安全 SaaS', cameras: ['CAM-NS-002'], state: 'COMPLETED', sentAt: '2026-04-25 06:00', endedAt: '2026-04-25 12:00', cost: '¥1,000', mediaCount: 2 },
  ];

  // Retrospectives — 4-pack
  const retrospectives = [
    {
      id: 'RV-2026-0429-F', predictionId: 'P-2026-0429-F',
      predictionOutcome: 'HIT', captureOutcome: 'CAPTURED',
      dimScores: { V: 92, R: 88, W: 76, T: 95 }, composite: 88,
      summary: '4 月 29 日 PM 高喷消防车实地出动 2 台，与预测吻合。摄像头于 13:42 捕获目标车队驶入博贺港；时段误差约 1.5 小时（预测 PM、实际 13:42）。',
      causal: '**关键证据**：茂名应急局《抢险救援预案》（4/27）+ 主流新闻 6 条 + 社交视频 3 条。\n\n**误差原因**：W 维分较低（76），原因是预测把 PM 整段标为出动窗口，实际仅 13-15 时为出动峰值。\n\n**漏读信号**：无重大遗漏。',
      reviewerNotes: 'D 角色确认：实拍画面清晰可识别。', generatedAt: '2026-05-06 02:14', overridden: false
    },
    {
      id: 'RV-2026-0425-G', predictionId: 'P-2026-0425-G',
      predictionOutcome: 'MISS', captureOutcome: 'NOT_CAPTURED',
      dimScores: { V: 60, R: 70, W: 30, T: 50 }, composite: 53,
      summary: '4 月 25 日 AM 南沙执法专用车未出动。摄像头部署 6 小时无目标车辆通过。判定为误报。',
      causal: '**误报来源**：交通局周计划存在但属于"待执行"状态，被 Agent 误判为高确定性。\n\n**漏读信号**：4/24 晚间公告显示"延期至下周"。NewsTriage 漏拣这条。',
      reviewerNotes: '建议：调整 NewsTriage 对"延期"关键词的优先级。', generatedAt: '2026-05-02 09:00', overridden: false
    },
    {
      id: 'RV-2026-0420-H', predictionId: 'P-2026-0420-H',
      predictionOutcome: 'HIT', captureOutcome: 'NOT_DISPATCHED',
      dimScores: { V: 85, R: 80, W: 80, T: 85 }, composite: 82,
      summary: '4 月 20 日汕头湾应急车出动属实，但置信度 35% 未达调度阈值，本次未派摄像头。事后通过新闻验证为命中（HIT）。',
      causal: '**正确决策**：低置信度→不调度，避免资源浪费。\n\n**反向价值**：此预测纳入案例库，作为"低置信度但命中"案例参考，下次同模式预测可适度上调。',
      reviewerNotes: '已加入 case library。', generatedAt: '2026-04-28 15:30', overridden: false
    },
  ];

  // Pattern stats
  const patterns = [
    { unit: '茂名应急局', vehicle: '应急救援车', trigger: '台风 II 级响应', freq: '11 / 14 次', confidence: '79%', stable: true, samples: 14 },
    { unit: '汕头海洋局', vehicle: '应急救援车', trigger: '风暴潮黄色预警', freq: '6 / 9 次', confidence: '67%', stable: true, samples: 9 },
    { unit: '南沙交通局', vehicle: '执法专用车', trigger: '周末例行', freq: '12 / 26 次', confidence: '46%', stable: false, samples: 26 },
    { unit: '湛江消防', vehicle: '高喷消防车', trigger: '森林火险预警', freq: '4 / 5 次', confidence: '80%', stable: false, samples: 5 },
    { unit: '珠海海关', vehicle: '执法专用车', trigger: '澳门假期客流', freq: '9 / 10 次', confidence: '90%', stable: true, samples: 10 },
  ];

  // Aliases + derived data for reviewer view
  const reports = retrospectives.map(r => {
    const p = predictions.find(x => x.id === r.predictionId) || {};
    return {
      id: r.id,
      predictionId: r.predictionId,
      outcome: r.predictionOutcome,
      publishedAt: r.generatedAt,
      author: '李研究员',
      summary: r.summary.replace(/\*\*/g, ''),
      delta: {
        expected: `${p.confidence || 50}%`,
        actual: r.predictionOutcome === 'HIT' ? '出动 · 命中' : r.predictionOutcome === 'MISS' ? '未出动 · 误报' : '无回传数据',
        diff: r.predictionOutcome === 'HIT' ? Math.max(-8, 100 - (p.confidence || 80) - 5) : -(p.confidence || 50),
      },
      robustness: {
        W: (r.dimScores.W || 75) / 100,
        T: (r.dimScores.T || 75) / 100,
        D: (r.dimScores.R || 75) / 100,
        M: (r.dimScores.V || 75) / 100,
      },
      takeaways: r.causal.split('\n').filter(s => s.trim() && !s.startsWith('**'))
        .map(s => s.replace(/\*\*/g, '').trim()).slice(0, 3),
      caseId: r.id.replace('RV', 'CASE'),
    };
  });

  const matrixPoints = predictions.filter(p => p.status === 'COMPLETED' || retrospectives.find(r => r.predictionId === p.id)).map(p => {
    const r = retrospectives.find(x => x.predictionId === p.id);
    return {
      label: p.shortId,
      confidence: p.confidence,
      outcome: r ? r.predictionOutcome : 'NO_DATA',
    };
  }).concat([
    // Synthetic extras for a richer scatter
    { label: 'C-01', confidence: 82, outcome: 'HIT' }, { label: 'C-02', confidence: 75, outcome: 'HIT' },
    { label: 'C-03', confidence: 71, outcome: 'HIT' }, { label: 'C-04', confidence: 68, outcome: 'HIT' },
    { label: 'C-05', confidence: 88, outcome: 'HIT' }, { label: 'C-06', confidence: 64, outcome: 'NO_DATA' },
    { label: 'C-07', confidence: 78, outcome: 'MISS' }, { label: 'C-08', confidence: 42, outcome: 'MISS' },
    { label: 'C-09', confidence: 31, outcome: 'MISS' }, { label: 'C-10', confidence: 58, outcome: 'HIT' },
    { label: 'C-11', confidence: 35, outcome: 'HIT' }, { label: 'C-12', confidence: 91, outcome: 'HIT' },
    { label: 'C-13', confidence: 48, outcome: 'NO_DATA' }, { label: 'C-14', confidence: 84, outcome: 'HIT' },
  ]);

  const cases = patterns.map((pt, i) => ({
    id: `CASE-${String(i + 1).padStart(3, '0')}`,
    vehicle: pt.vehicle,
    task: pt.trigger,
    region: pt.unit,
    k: 5 + i,
    confidence: parseInt(pt.confidence),
    outcome: pt.stable ? 'HIT' : (i % 2 ? 'MISS' : 'HIT'),
    refCount: pt.samples,
  }));

  return { now, users, regions, watchlists, predictions, confidenceTimeline, evidence, dispatches, retrospectives, patterns, reports, matrixPoints, cases };
})();
