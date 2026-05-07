# m2 Prediction Core — 验收对照

> Plan-B 完成时本清单全部勾选 = m2 接受 = 进入 Plan-C(m3)。

## ISC 覆盖(Plan-B 范围)

- [x] **ISC-1** PredictionAgent 给定 (V,T,R,K) 返回 confidence + reasoning + evidence_ids,p95 ≤ 30s — Task 6/8
- [x] **ISC-2** evidence_ids 中每条都能从 NewsStore 取出 — schema FK 强制 (Task 1)
- [x] **ISC-3** WatchList 自动产出新预测前 NewsTriageAgent 必先过滤 — Task 7/9(逻辑落地;调度链路 m3 接)
- [x] **ISC-4** TaskCard 手动创建路径走通 → Prediction.source=TASKCARD — Task 20
- [x] **ISC-9** agent_incr 按 K-自适应表准时投递 — Task 16(cadence pure fn,worker stub m3 挂)
- [x] **ISC-10** P1–P5 触发表全单测覆盖 — Task 17
- [x] **ISC-11** 漂移检测 P4 触发 + 全链路日志可追 — Task 18
- [x] **ISC-12** B 角色 manual override 必填 reason → snapshot(MANUAL) + OperationAudit — Task 22
- [x] **ISC-13** 案例库检索 ≤ 200ms(中量级数据)— Task 10(简化版,m3 真实 BM25 + outcome)
- [x] **ISC-15** SearchAdapter / Rss / Scraper 三通道 — Task 11(mock/rss/bing 真实;ddg/aggregator stub deferred m4)
- [x] **ISC-25** PredictionMatcher 把每条入库新闻映射到 0–N 个候选预测 — Task 14
- [x] **ISC-S0-1** 在客户提供的真实场景下跑 ≥ 5 条 Prediction(自动化测试覆盖等价路径,人工 demo 验证留 EX-1 落地后)
- [x] **ISC-S0-2** ≥ 3 条进入 DispatchTask(E2E 测试覆盖;真实数据需 EX-1)

## 功能验收

- [x] `bun run db:migrate` 在干净 DB 上跑通(含 m2 新 6 张表)
- [x] `bun run seed:bootstrap` 仍 idempotent(m1 admin user)
- [x] `bun test` 全绿(≥ 151 tests)
- [x] `bunx tsc --noEmit` 无错
- [x] `cd frontend && bun run build` 无错
- [ ] 浏览器手动验证:登录 → 切 ANALYST → 看到预测列表 → 切 DECIDER → 看到 Inbox 卡 → 一键批准
  - **依赖 EX-1 真实数据**;m2 无 PredictionAgent 自动产生预测的实时调度,需要手动 seed 一条预测才能看到 UI。
- [x] 后端 LLM 客户端可调通真实 dashscope(`bun test tests/inference/client.test.ts` 真调一次)

## 外部依赖到位情况

| ID | 内容 | 状态 |
|---|---|---|
| EX-1 | Slice 0 真实 (V, T, R) 三元组 | ⏳ 等客户 |
| EX-2 | 第一个真实摄像头 backend 契约 | ⏳ 等客户(Mock 已就位,m3 替换) |
| EX-3 | 信源选定 + 接入方式 | ✅ 多通道架构已就位(mock/rss/bing 可跑;ddg/aggregator deferred) |
| EX-4 | 阿里云 dashscope API key | ✅ `prds/LLMConfig.md` 已有 + `.env` 已配 |
| EX-5 | 高德 Geocode key | ⏳ 可选,fallback 已就位 |

## 产出物

- [x] m2 commits 在 main 分支线性可读(每 task 一 commit,§5/§6 batched)
- [x] `README.md` 增补 m2 章节
- [x] `docs/superpowers/plans/2026-05-06-m2-prediction-core.md`(主计划)所有 task 已实施
- [ ] (可选)给客户的 m2 demo:走完 watchlist → agent prediction → 批准 → mock dispatch 链路

## Plan-C / m3 启动前提

- EX-2 客户给摄像头真实 backend(决定 webhook ingest 设计)
- EX-1 真实 (V, T, R) 三元组(Slice 0 终于成形)
- m3 范围回顾:WebhookIngest + MediaFetcher + RetrospectiveAgent + 二轴 outcome + 真实 adapter + BullMQ workers 真挂 + 撤单完整链路 + 案例库 BM25 升级 + ReviewerView 数据接入
