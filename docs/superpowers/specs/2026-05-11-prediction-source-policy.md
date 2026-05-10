# Prediction Source Policy(ADR · 2026-05-11)

> 本文档定调:**「必须有新闻证据才能产生预测」原则的应用边界 + TaskCard 灰色地带的处置**。

## 背景

`#1 反向流` 改造(commit `0a2f4e4`)规定:**所有 prediction 在创建时必须同 transaction 链一条 news_evidence**。

但系统里有一条人驱动的产生路径 — **TaskCard**(用户主动声明「我要跟踪某次特定行动」),与新闻无关。两个路径产生 prediction,但语义不同:

| 路径 | 起源 | 证据来源 | 当前行为 |
|---|---|---|---|
| **NewsExtractAgent**(主) | 新闻进来 → LLM 判断 actionable | 新闻原文(news_evidence weight=HIGH) | commit `0a2f4e4` 已实现 + 强制 |
| **TaskCard**(豁免) | 用户在 UI「新建任务卡」 | 无新闻 — 用户人工指定 | **本 ADR 决定:豁免** |
| ~~spawn-from-all/watchlist~~(已删) | 自动覆盖未来窗口 | 无 | commit `<本次>` 删除 |
| ~~__demo/seed-prediction~~(收紧) | 演示种子 | 假 snapshot | 改 DEBUG_ROUTES env 门控 |

## 决策

### 1. NewsExtractAgent 是 prediction 的唯一**自动**生产路径

- 任何后端定时任务、worker、自动 spawn 一律走 NewsExtractAgent
- 新创建的 prediction 必带 news_evidence(weight=HIGH cited=true)+ 初始 confidence_snapshot

### 2. TaskCard 是 prediction 的唯一**人工**生产路径,**豁免新闻证据要求**

理由:
- TaskCard 是用户主动声明的跟踪意图(「我要看下周一这条街的某次专项行动」)
- 用户已经表达了跟踪需求,系统不应强求新闻反向证明合理性
- TaskCard 创建时 prediction.confidence_now 默认 0(诚实表态:「LLM 还没看过新闻」)
- 后续新闻进来后,NewsExtractAgent / triage 会自动给该 prediction 喂 evidence + 更新 confidence

约束:
- TaskCard 派生的 prediction 必须 source_kind='TASKCARD'(已通过 schema 强制)
- UI 上 TaskCard prediction 与 WATCHLIST prediction 视觉上区分(同样的列表,但 sourceKind 字段可用)
- **TaskCard 不允许批量创建** — 必须每条人工填表 + 提交 + 审计行 action='taskcard_created'

### 3. 演示路径(`__demo/seed-prediction`)收紧到显式 DEBUG_ROUTES env

- 之前只看 NODE_ENV != production,本地开发会无意暴露
- 现在必须 `NODE_ENV != production AND DEBUG_ROUTES=true` 才挂载
- 生产部署一定不带 DEBUG_ROUTES;本地开发显式开才能用

### 4. 测试夹具直接 INSERT prediction 是允许的

测试隔离环境,createTestDb 走完隔离 schema,不影响生产路径。但:
- 测试创建的 prediction 不带 evidence 是测试快路径,不视为违反原则
- 集成测试若验证「真闭环」必须走 NewsExtractAgent 路径,不能直接 INSERT

## 实施清单(本次 commit 内)

- [x] 删除 `src/modules/prediction/spawner.ts`
- [x] 删除 `src/scheduler/workers/prediction-spawn.ts`
- [x] 删除 `tests/modules/prediction/spawner.test.ts`
- [x] 删除 `/spawn-from-all` `/spawn-from-watchlist/:id` 路由
- [x] 新增 `/spawn-from-news` 路由(代替 📡 按钮)
- [x] 前端 spawnFromAllWatchlists → spawnFromNews
- [x] server.ts 的 demo 路由门控 + DEBUG_ROUTES env
- [x] 本 ADR 文档

未来工作(不阻断本次):

- [ ] TaskCard 创建路径接通 prediction 派生(目前 taskcard 创建只 INSERT task_card 行,不派生 prediction;如要接通,需在 service 加 `INSERT predictions WHERE source_kind='TASKCARD'`)
- [ ] 加 source_kind UI 标识(TaskCard vs WATCHLIST 的视觉区分)
- [ ] (可选)DB trigger 物理强制:`predictions` 表 INSERT 时,若 source_kind='WATCHLIST' 且 60s 内无对应 news_evidence → RAISE。最强约束,但增复杂度,留 m6

## Glossary

- **LLM-driven extraction**:NewsExtractAgent 根据一条新闻 + 全部 active watchlist roster 决定是否提取 N 个 prediction
- **幂等合并**:同 (sourceId, sourceKind, windowDate, windowHalf) 已有 prediction 时,新提取动作不重建,只 ① 加 evidence ② 写 snapshot ③ confidence 取 max
- **「立即重算」语义**:对当前 PROPOSED prediction 重新跑全 evidence 池上的 LLM 评估,触发 fullRecalcQueue P5
- **「📡 生成预测」语义(本 ADR 定调)**:对每个 active watchlist 拉一轮新闻(用户配置的 freshness 窗口)+ 同步 drain extract → 自动决定创建 / 合并 / 跳过

## Owner & Review

- 起草:CoCo · 2026-05-11
- 决策者:QuZhi · 接受
- 复议触发条件:
  - 出现 prediction 创建路径未列入本文档
  - LLM 提取的预测质量低于人工 TaskCard 阈值,需要重新评估两个路径的权重
  - DB trigger 物理强制是否要做
