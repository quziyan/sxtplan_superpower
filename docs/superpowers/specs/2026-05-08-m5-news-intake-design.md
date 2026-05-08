# m5 — News Intake Pipeline + Tavily Migration Design

> **Status:** DRAFT — pending QuZhi approval
> **Brainstorming session:** 2026-05-08
> **Predecessor:** Plan-D m4 Real Customer Onboarding (commit `fc206b9`, 390/1/0 tests)
> **Plan family:** Plan-E (mainline) — sibling Plan-F (frontend m4 UI) + Plan-G (hygiene) deferred

---

## 1. Problem

m4 audit(2026-05-08)发现 m3 声称的"Real End-to-End"实际只贯通了**输出侧**链路(prediction → dispatch → webhook → media → retro),**输入侧**(news → match → triage → INCR refresh)5 处断链:

1. **G1 Cadence tick INCR 错 kind**(`src/scheduler/workers/cadence.ts:59`)
   - 直接 enqueue `kind:'INCR'` 但不带 `newEvidenceNewsIds`
   - `runPredictionAgent` 在 INCR 模式下要求 IDs 列表,否则 throw `'INCR mode requires newEvidenceNewsIds'`(`src/agents/prediction-agent.ts:85-87`)
   - 效果:**生产部署后 1 个 cadence tick 就会 runtime error**

2. **G2 newsIngestQueue 零 consumer**(`src/scheduler/queue.ts:11`)
   - `newsIngestQueue` 队列定义存在,但没有任何 worker 消费
   - 没有周期性从 SearchAdapter 拉新闻、写 `news_items`、入管线的机制
   - Plan-D 加的 5 个真 SearchAdapter(Tavily 即将替换 Bing + RSS + 3 政务网爬虫)**production 路径上没人调用**

3. **G3 NewsTriageAgent 孤儿**(`src/agents/news-triage-agent.ts`)
   - `runNewsTriageAgent` 完整实现(包括 INSERT news_evidence 路径),但 production 代码没有任何 caller

4. **G4 PredictionMatcher 未接线**(`src/news/matcher.ts`)
   - `findMatchingPredictions(db, newsId)` 完整实现(基于 region + V/T 4 级匹配),但 production 0 调用

5. **G5 `recompute-now` 路由是 m2 stub**(`src/modules/prediction/routes.ts:222-238`)
   - 只 console.log + audit,**不真 enqueue** full-recalc 队列
   - "立即重算"按钮端到端不工作

加上独立约束:**Tavily 替代 Bing**(用户偏好,Plan-D Task 7 引入的 BingNewsSearchAdapter 应让位)。

---

## 2. Vision

m5 完工后,**新闻情报闭环可在生产持续自动运行**:

- 每 15 分钟,系统主动从 Tavily + RSS + 3 个政务网爬虫拉新闻
- 新闻通过 `findMatchingPredictions` 找到候选 prediction
- 每对 (prediction, news) 经 LLM triage 评分
- HIGH 评分写 `news_evidence(cited=true)` + 触发 INCR refresh
- INCR refresh 调 PredictionAgent 更新 `confidence_now`
- prediction 详情页持续更新,analyst 可见 reasoning + evidence 历史

副效果:**Tavily 成默认搜索源,Bing 保留 fallback**;`recompute-now` 按钮真工作。

---

## 3. Out of Scope

明确推迟到 Plan-F / Plan-G / m6+(已和用户决策锁定):

- **前端 watchlist keywords 输入字段** → Plan-F(m4/m5 UI 视图集合)
- **前端"自动撤单"标记 / DECIDER inbox 占位 / 政务网信号面板** → Plan-F
- **m4 observability tracing**(`[adapter:key:event]` tag + structured log) → Plan-G(hygiene)
- **DB migration rollback / down migrations** → Plan-G
- **`.env.example` 全字段一致性补齐** → Plan-G
- **DECIDER inbox 真子系统**(替换 console.log shim) → m6
- **历史 news 主动 backfill** → 不做(YAGNI;新管线只对上线后新闻生效)
- **LLM-derived keyword 增强**(根据 watchlist 历史命中调优) → m6
- **Bing adapter 删除** → 不做(留 fallback;若 m6 metrics 显示零调用再删)
- **prediction-level keywords 覆盖**(细于 watchlist 粒度) → m6+ 看实际需求

---

## 4. Principles

- **零回归** — m4 baseline 390 + 1 skip + 0 fail 必须保;新增 ~25-30 测试,完工目标 ≥ 415 / 0 fail
- **失败孤立** — 任一 SearchAdapter / 任一 triage job 失败不影响其他(Plan-D §4 失败孤立模式延续)
- **可降级** — Tavily / Bing / Gov 任一不可达 → 空数组 + degraded warn,不抛错
- **同步 vs 异步分工**(§ 1 (γ) 决策):DB 查询同步在 tick 内(快、廉价),LLM 推理异步进 newsTriageQueue(慢、贵)
- **职责单一** — INCR = 事件驱动(news triage 评分),FULL = 节奏驱动(P1-P5 trigger gate);两条路径互不干扰
- **YAGNI** — 没有 backfill,没有 prediction-level keyword,没有 LLM-derived keyword;先把闭环跑通

---

## 5. Constraints

- bun/bunx 始终,绝不 npm/npx
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `isolatedModules`
- 无新 runtime dep(Tavily 走 `fetch()` REST,不引 `@tavily/core` SDK)
- 单 commit per task,显式 git add 路径
- subagent-driven-development(implementer + spec reviewer + code reviewer 三角)
- 默认 `bun test` **不打真外部网络**(Tavily/Bing/Gov 全 mock fetch);LLM 例外:**测试用真 dashscope LLM**(`prds/LLMConfig.md`)
- Acceptance integration 测试用 `INTEGRATION_TESTS` env gate(沿用 Plan-D Task 10 模式)
- 明文密钥存储:`prds/*.md` 含 API key 是用户接受形态;代码读 env 不读 `prds/`

---

## 6. Goal

**实现 5 个 gap 的修复 + Tavily 适配 + watchlist keywords schema** —— 让 PredictionAgent 接入和推理证据的持续收集**端到端可在生产自动运行**,默认搜索源切到 Tavily。

---

## 7. Architecture

### 7.1 整体数据流

```
                ┌──────────────────────────────────────┐
                │  newsIngestTick (15 min)              │
                │  ──────────────────────              │
                │  for each active watchlist wl:        │
                │    keywords = wl.keywords ?? derive() │
                │    for adapter in [Tavily, RSS, Gov*] │
                │      news[] = adapter.query(keywords) │
                │      for each news:                    │
                │        INSERT news_items (URL UNIQUE)  │
                │        candidates = match(news.id)     │  ← 同步 SQL
                │        for each pred in candidates:    │
                │          newsTriageQueue.add({pred,n}) │  → 异步
                └──────────────────────────────────────┘
                                    │
                                    ▼
                ┌──────────────────────────────────────┐
                │  newsTriageWorker (concurrency=3)     │
                │  ──────────────────────              │
                │  consume {predId, newsId}:            │
                │    score = runNewsTriageAgent(...)    │  ← LLM 异步
                │    if relevance >= MED:                │
                │      INSERT news_evidence(weight,cited)│
                │    if relevance == HIGH:               │
                │      refreshQueue.add('incr',          │
                │        {predId, kind:'INCR',           │
                │         newEvidenceNewsIds:[newsId]})  │  → INCR 路径
                └──────────────────────────────────────┘
                                    │
                                    ▼
                ┌──────────────────────────────────────┐
                │  refreshWorker (existing m3)          │
                │  → runPredictionAgent(INCR with IDs)  │
                │  → confidence_snapshots               │
                │  → predictions.confidence_now         │
                └──────────────────────────────────────┘

                ╔══════ FULL 路径(独立)══════════╗
                ║  cadenceTick (60s)                ║
                ║  → fullRecalcQueue.add(predId)    ║  ← G1 修复:从 refreshQueue 切到 fullRecalcQueue
                ║                                  ║
                ║  fullRecalcWorker                 ║
                ║  → shouldTriggerFull (P1-P5)      ║
                ║  → if triggered:                  ║
                ║    refreshQueue.add('full', ...)  ║
                ╚══════════════════════════════════╝

                Manual: POST /predictions/:id/recompute-now
                  body 默认空 → fullRecalcQueue (manualTrigger=true) [P5]
                  body {kind:'INCR', newEvidenceNewsIds:[...]}
                       → refreshQueue.add('incr', {...})
```

### 7.2 5 个 gap 修法 + Tavily

| Gap / 主题 | 修法 | 主要文件 |
|---|---|---|
| **G1** cadence INCR 错 kind | cadence enqueue 改成 `fullRecalcQueue` | `src/scheduler/workers/cadence.ts:59` |
| **G2** newsIngest 无 worker | 新建 `tickNewsIngest`(15min 间隔) | `src/scheduler/workers/news-ingest.ts`(新) |
| **G3** triage 孤儿 | 新建 `newsTriageWorker` 消费 newsTriageQueue | `src/scheduler/workers/news-triage.ts`(新)+ `src/scheduler/queue.ts` 加 queue |
| **G4** matcher 未接线 | tickNewsIngest 同步调用 `findMatchingPredictions` | (no new file,wire 在 G2 worker 内) |
| **G5** recompute-now stub | routes.ts 改真 enqueue + 双模式 | `src/modules/prediction/routes.ts:222-238` |
| **Tavily** 接入 | 新 adapter 类,REST POST(不引 SDK) | `src/news/adapters/tavily.ts`(新) |

### 7.3 同步 vs 异步分工(§ 1 (γ) 决策依据)

- **同步在 tick 内**:`adapter.query()`(网络但快)、`INSERT news_items`、`findMatchingPredictions`(SQL,几 ms)
- **异步进 newsTriageQueue**:LLM triage(每次 ~2-5s,可能爆 quota)
- 鸿沟在 LLM:DB 操作早早完成,LLM 慢慢消化

### 7.4 INCR vs FULL 职责(§ 2A (β) 决策依据)

- **INCR 事件驱动**:newsTriageWorker 评 HIGH 时即时触发,带 `newEvidenceNewsIds`
- **FULL 节奏驱动**:cadenceTick 周期叩门,`shouldTriggerFull` P1-P4 评估累积量,只在阈值越过时触发
- P1(INCR 累积次数)、P2(自上次 FULL 天数)、P3(自上次 FULL 新 evidence 数,看 MED+)、P4(confidence 漂移)、P5(manual)

---

## 8. Schema Changes

### 8.1 Migration `0010_news_intake_keywords.sql`

```sql
-- watchlists.keywords:
ALTER TABLE watchlists
  ADD COLUMN keywords text[] NOT NULL DEFAULT '{}';

-- news_items.url UNIQUE 确认/补充:
-- 实施时先 \d news_items 确认。若已有 → skip 该行。若没 →
-- ALTER TABLE news_items ADD CONSTRAINT news_items_url_uq UNIQUE (url);
```

### 8.2 Drizzle schema 改动

```ts
// src/db/schema/watchlist.ts
export const watchlists = pgTable('watchlists', {
  // ... 现有列
  keywords: text('keywords').array().notNull().default(sql`ARRAY[]::text[]`),
})
```

`news_evidence` 不变(沿用 m2 weight HIGH/MED/LOW + cited boolean)。
`predictions` 不变(m4 加的 auto_cancel_* 复用)。

---

## 9. New env vars

```ts
// src/env.ts
TAVILY_API_KEY: z.string().default(''),  // 空 = degraded fallback
SEARCH_API_KIND: z.enum(['mock', 'bing-news', 'rss', 'ddg', 'aggregator',
                         'gov-gd-province', 'gov-gz-city', 'gov-public-security',
                         'gov-test', 'tavily']).default('tavily'),  // ← 默认改

NEWS_INGEST_INTERVAL_MIN: z.coerce.number().min(1).max(120).default(15),
NEWS_TRIAGE_CONCURRENCY: z.coerce.number().min(1).max(10).default(3),
```

`SearchAdapter.kind` union(`src/news/types.ts`)加 `'tavily'`。

---

## 10. ISC Criteria(21 项)

### G1 Cadence 修复
- **ISC-G1.1** `tickCadence` enqueue 到 `fullRecalcQueue`(非 refreshQueue)
- **ISC-G1.2** Cadence 路径在 unit test 中**不再**触发 `'INCR mode requires newEvidenceNewsIds'` error
- **ISC-G1.3** `shouldTriggerFull` 在 cadence 路径下被实际调用(测试中 spy 验证)

### G2/G4 newsIngestTick + matcher
- **ISC-G2.1** `tickNewsIngest()` 单元测试:1 watchlist + 1 mock adapter 返回 2 news → 2 news_items 插入
- **ISC-G2.2** Watchlist `keywords` 非空时优先用,空时降级 `deriveKeywordsForWatchlist`(2 case 覆盖)
- **ISC-G2.3** SearchAdapter 失败孤立:adapter A throw 时 adapter B 仍执行(per-adapter try/catch)
- **ISC-G2.4** `findMatchingPredictions` 在 tick 内调用 + 候选 enqueue 到 newsTriageQueue
- **ISC-G2.5** Idempotent:同一 URL 重复 fetch → news_items 不重复(URL UNIQUE 约束)

### G3 newsTriageWorker
- **ISC-G3.1** Worker 消费 newsTriageQueue + 调 `runNewsTriageAgent`(真 LLM,deepseek-v4-flash)
- **ISC-G3.2** relevance=HIGH → INSERT news_evidence(weight=HIGH, cited=true) + 1 refresh-INCR enqueue
- **ISC-G3.3** relevance=MED → INSERT news_evidence(weight=MED) 但**不** refresh-INCR
- **ISC-G3.4** relevance=LOW/NONE → 不写 evidence,不 enqueue
- **ISC-G3.5** Triage 失败孤立:LLM error 不阻塞队列(per-job try/catch + BullMQ retry policy)

### G5 recompute-now
- **ISC-G5.1** `POST /recompute-now` 默认 body → fullRecalcQueue + manualTrigger=true
- **ISC-G5.2** body `{kind:'INCR', newEvidenceNewsIds:[...]}` → refreshQueue INCR
- **ISC-G5.3** 两种模式都写 audit log `recompute_now_requested`(不退步)

### Tavily
- **ISC-T.1** `TavilySearchAdapter` happy path:fetch stub 返回 results → 映射到 `SearchHit[]`(title/url/snippet/source.name=domain/publishedAt)
- **ISC-T.2** No key → `[]` + degraded warn(不发 fetch 请求)
- **ISC-T.3** Rate-limited(3/sec window)第 4 次同窗口 → `[]`
- **ISC-T.4** HTTP 500 → `[]` + warn

### 端到端 Anti
- **ISC-Anti.1** 默认 `bun test` 不打真 Tavily/Bing/Gov 网络(全 mock fetch);LLM 例外允许
- **ISC-Anti.2** 全套 baseline ≥ 390 + 新增 ~25-30 测试 = ≥ 415 pass / 0 fail / tsc clean

---

## 11. Test Strategy

### 11.1 单元测试 — LLM 真调

- **决策**:LLM 推理用**真 dashscope deepseek-v4-flash**(不再 `inferFn` mock)。
  - Config 来源:`prds/LLMConfig.md`(`base_url=dashscope...compatible-mode/v1`,`model=deepseek-v4-flash`)
  - 代码读 env(沿用 m2 客户端实现):`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
  - 测试 timeout 提到 30s(LLM 真调 ~2-5s/次)
  - 成本估计:全 m5 测试 ~50 LLM 调用 × ~500 tokens × ¥0.001/k = **~¥0.025/run**(可接受)
- **网络仍 mock**:`globalThis.fetch` stub 仅给非 LLM 的 SearchAdapter(Tavily/Bing/Gov);LLM 调真 dashscope HTTP。
- **DB**:沿用 m2 `createTestDb` + 测试隔离模式(注:m4 Task 2 escape valve 决议下,测试 DB 共享真 PG,测试间用 timestamp/UUID 唯一性避免冲突)。

### 11.2 集成测试 — 端到端 mock 链路

`tests/e2e/news-intake-full-flow.test.ts`:
- seed:1 watchlist(keywords=['test-keyword'])+ 1 PROPOSED prediction(region/V/T)
- mock Tavily fetch → 1 high-relevance news(标题含 V/T/region 关键词)
- 同步调 `tickNewsIngest()` → news_items 入 + matcher 找到 prediction → newsTriageQueue 1 job
- 同步调 `processNewsTriageJob()` 处理那 1 job → 真 LLM 评分 → 若 HIGH 则 news_evidence 写入 + refreshQueue 1 INCR job
- 同步调 `processRefreshJob()` → 真 LLM 调 PredictionAgent → confidence_snapshots + predictions.confidence_now 更新
- assert GET /predictions/:id 返回新 snapshot,reasoning 非空

### 11.3 Acceptance integration(默认 skip)

`tests/integrations/tavily-acceptance.test.ts`:
- `describe.skipIf(!INTEGRATION_TESTS)` gate(同 Plan-D Task 10 模式)
- 真 Tavily key + 真 query → 验证 `SearchHit[]` 形状 + 至少 1 result
- 默认 CI 跳过;手动 `bun run test:integration` 启用

---

## 12. Risks

**R1: Tavily 中国网络访问不稳定**(低概率高影响)
- 缓解:`SEARCH_API_KIND=bing-news` env 一行切回 Bing
- degraded fallback 走空路径(同 Bing/Gov 模式)
- 监控:Plan-G observability 引入后加 `[tavily:fetch:error]` tag

**R2: LLM credit 爆炸**(中概率中影响)
- 缓解:`NEWS_TRIAGE_CONCURRENCY=3` 限速;relevance=LOW/NONE 早退;tick 默认 15min
- 监控:Plan-G 后看 newsTriageQueue 待办 + LLM 调用速率

**R3: 关键词召回质量低**(中概率高影响)
- 缓解:hybrid keyword(§ 2B (γ))— analyst 显式填高质,空时降级派生兜底
- m6 可加 LLM-derived keyword 增强

**R4: news_items URL 冲突未处理**(低概率高影响)
- 缓解:ISC-G2.5 显式测试;migration 0010 同步加 UNIQUE(若 m2 没加)

**R5: matcher 性能退化**(中概率中影响)
- m2 实现的 `findMatchingPredictions` 用 `news.matched_regions`;若 region IN-list 大,扫描慢
- 缓解:加 `predictions(region_id, status)` 复合索引(若 m2 没加);上线后看 query plan

**R6: 并发更新 confidence_now race**(低概率低影响)
- 多 worker 同时跑同一 prediction 的 INCR/FULL → confidence_now race
- 缓解:`runPredictionAgent` 用 `db.transaction`(prediction-agent.ts:152);Postgres ROW LOCK 默认避免;BullMQ jobId unique 强化

**R7: Tavily API 响应格式 breaking change**(低概率高影响)
- Tavily v0.x,响应可能改
- 缓解:adapter 内 `results ?? []` + `provider?.[0]?.name ?? 'Tavily'` 防御性 access;HTTP 错 → 空兜底
- 监控:Plan-G observability 后看 parse-error rate

---

## 13. Buffer 策略

- 估时:5-6 d → 6-8 d(buffer 30%)
- 若 R1 Tavily 中国不可达成立 → 切回 Bing 默认,Tavily 留 m6
- 若 R3 召回质量过低 → 第 2 周加 keyword-derive LLM 增强(scope 扩 1d)

---

## 14. Estimated Tasks

| # | Task | 估时 |
|---|---|---|
| 1 | G1 Cadence enqueue → fullRecalcQueue + 测试 | 0.25 d |
| 2 | watchlist.keywords schema migration + drizzle | 0.25 d |
| 3 | watchlist service/route 支持 keywords | 0.25 d |
| 4 | TavilySearchAdapter + 4-path 测试 | 0.5 d |
| 5 | search-adapter pool 加 tavily factory + 默认值切 + env | 0.25 d |
| 6 | `keyword-derive.ts` 派生 fallback + 测试 | 0.25 d |
| 7 | `tickNewsIngest` worker(G2 + G4)+ 失败孤立 + 测试 | 1.5 d |
| 8 | `newsTriageWorker`(G3)+ 真 LLM 测试 + 阈值分支 | 1 d |
| 9 | `newsTriageQueue` 定义 + workers.ts 注册 | 0.25 d |
| 10 | G5 recompute-now 双模式修复 + 测试 | 0.5 d |
| 11 | e2e 测试(news-intake-full-flow)| 0.75 d |
| 12 | Tavily acceptance integration test | 0.25 d |
| 13 | README m5 section + acceptance checklist | 0.5 d |
| 14 | Buffer + 集成 + 验收 | 0.75-1 d |
| **总** | | **6-8 d ≈ 1.5-2 周** |

---

## Appendix A — Decisions Traceability

7 项决策(brainstorming session 2026-05-08):

| § | 决策 | 选择 | 理由摘要 |
|---|---|---|---|
| § 0 | scope | (β) 拆 3 plans | Plan-E 主线 + Plan-F 视图 + Plan-G hygiene;凝聚力强 |
| § 1 | pipeline | (γ) Hybrid | DB 同步 + LLM 异步;失败粒度细 |
| § 2A | cadence | (β) → fullRecalcQueue | INCR 事件,FULL 节奏,职责分流 |
| § 2B | keywords | (γ) hybrid | watchlist.keywords 显式 + 派生 fallback |
| § 2C | Tavily | (β) Tavily 默认 + Bing fallback | 零回归 + 失败兜底 |
| § 2D | triage 阈值 | (β) MED+ 写 / HIGH 触发 INCR | schema 不变 + LLM credit 可控 |
| § 2E | recompute-now | (β) FULL P5 + 可选 INCR | analyst 双场景支持 |

---

## Appendix B — References

- m4 Plan: `docs/superpowers/plans/2026-05-07-m4-real-customer-onboarding.md`
- m4 Spec: `docs/superpowers/specs/2026-05-07-m4-real-customer-onboarding-design.md`
- m4 Acceptance Checklist: `docs/superpowers/plans/2026-05-07-m4-acceptance-checklist.md`
- LLM Config: `prds/LLMConfig.md`(dashscope deepseek-v4-flash)
- Tavily Config: `prds/TavilyConfig.md`(API key + Python SDK 示例)
- 系统逻辑: `prds/系统逻辑.md`
- m4 baseline: commit `fc206b9`(390 pass / 1 skip / 0 fail)

---

**End of m5 Plan-E Spec**
