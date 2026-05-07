# m4 — Real Customer Onboarding Design

> **Status:** Design approved 2026-05-07 (4-section brainstorming + 7 user decisions); ready for `writing-plans`.
>
> **Predecessors:** m3 (Plan-C, 313 tests, commit `b337298`) + cnp-adapters-unify (9 task, 348 tests, commit `2a41002`).
>
> **Successor:** Plan-D (writing-plans output) + m5 (deferred items).

## 1. Problem

m3 + cnp-adapters-unify 完工后系统具备完整 demo 能力,但**仍是 simulated 状态**:

- **Camera backend** 用 `SimulatedGuangzhouPoliceCamAdapter`(进程内 setTimeout 模拟),客户真 backend 未对接
- **新闻信源** 仅有 RSS 一种真接入,Bing News / 政务网 / 党媒等多通道全是 mock
- **资源管理** 只有人工撤单,置信度跌破阈值时摄像头资源持续浪费
- **m3 累积 5 项技术债**(logAudit Db|Tx 联合 / 测试 DB 事务隔离 / createBullMQWorker helper / DEFAULT_ADAPTER_KEY 常量 / GET /retrospectives/aggregate)未清,后续工作复用基础设施时持续踩坑

**距离客户付费上线还差**:真 backend + 真新闻 + 自动化 + 干净底座。

## 2. Vision

m4 完工时:

- **客户能用自己的 backend 跑端到端**(Slice 1 升级版 demo,从"看 simulator"过渡到"接真 Camera + 真 Bing 索引 + 真政务源")
- **多源新闻信号融合验证**(Bing 商业全文索引 + 广东省/广州市/公安厅 3 个政务网一手信息)产品化
- **资源自动节流**(置信度跌破 0.3 持续 15 分钟自动撤单 + DECIDER inbox 通知,人工可单条覆盖)
- **m3 技术债全清**,后续 m5+ 工作在更干净基础设施上推进

## 3. Out of Scope

明确推迟到 m5+(已和用户决策锁定):

- **A2-β 党媒爬虫**(新华网 / 央视网 / 人民网) — 法律合规风险高,需独立合规 spike
- **A2-δ DDG / 第三方搜索包装** — 价值低,m5 兜底
- **A2-ζ 外文新闻 + 翻译层** — 工程复杂度高,m5
- **B2 AD_HOC → ADMIN_NAMED 晋升 UI** — m5
- **B3 BM25 中文分词升级**(jieba / IK Analyzer) — m5
- **D 桶**:memfs OSS / Pulse 仪表板接入 — m5/m6
- **合规层 SAML / SSO** — 等客户主动提需求
- **ε 社交媒体**(微博 / Twitter) — 工程 + 商业双高门槛,无限期搁置

## 4. Principles

- **零回归** — m3 baseline 313 + cnp-adapters-unify 35 = **348 tests 必须保**;tsc 全程零错
- **DI 兼容** — 已有的 mock-based DI 模式延续,m4 新组件继承
- **失败隔离** — 多源 SearchAdapter 任一挂掉不影响其他源
- **可降级** — 真 API 不可用时 fallback 到 mock + 标 `degraded: true`,前端可见状态
- **观察先于优化** — B1 自动撤单上线即开 audit log,1 周后看实际触发率再调阈值
- **依赖可控** — 外部依赖(Bing key / 政务网 robots.txt / 客户 backend 契约)不阻塞 internal 工作

## 5. Constraints

- bun/bunx,绝不 npm/npx
- TypeScript strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + isolatedModules
- 无新 runtime dep(`cheerio` 用于政务网 HTML 解析是个例外,需明确审批)
- 单 commit per task,显式 git add 路径
- subagent-driven(implementer + spec reviewer + code reviewer 三角)
- m4 e2e 必须能在 CI 跑(无 Bing key + 无政务网络也能 PASS — 全 mock 路径)
- Acceptance integration test 默认 skip,需 `--integration` flag 启用(避免 CI 烧 quota)

## 6. Goal

按 6-block 顺序执行,**5.5-6 周完工**:

1. **C 桶清债**(并行)— 1 周
2. **A2-α Bing News API 接入** — 0.5 周
3. **A1 真 Camera 接入**(spec + impl)— 2.5 周(0.5 spec + 2 impl,跟 A2-γ 并行)
4. **A2-γ 政务网爬虫**(广东省 + 广州市 + 公安厅 3 站点)— 1 周(跟 A1 并行)
5. **B1 自动撤单** — 1 周
6. **缓冲 + 集成 + acceptance + Slice 1 demo runbook** — 0.5-1 周

完工时:`bun test` ≥ 380(348 base + ≥30 新)+ frontend tsc clean + Slice 1 runbook 可演示真客户对接路径。

## 7. Architecture

### 7.1 C 桶 5 项(全部按推荐落地)

| C# | 内容 | 实施细节 |
|---|---|---|
| C-1 | `logAudit` `Db | PgTransaction` 联合签名 | drizzle 0.36 PgTransaction 类型 union;callers 改 0 个(向下兼容);旧 `tx.insert(operationAudit)` 直插模式可改回 `logAudit(tx, ...)` 复用 helper |
| C-2 | 测试 DB 事务级隔离 | `createTestDb()` 每个 test 自动 BEGIN;测试结束 ROLLBACK;`SAVEPOINT` 嵌套兼容已用事务的 m3 测试(state-machine.test 等) |
| C-3 | `createBullMQWorker(name, handler, deps?)` helper | 提取共享 boilerplate(`new Worker(name, handler, { connection: { url: env.REDIS_URL } })`);6 现存 worker(refresh / cadence / full-recalc / dispatch / media-fetch / retrospective)retrofit |
| C-4 | `DEFAULT_ADAPTER_KEY` 常量 | `src/dispatch/constants.ts` 暴露 `getDefaultAdapterKey()`(根据 `SIMULATED_GZP_ENABLED` env 返回 `simulated-gzp` 或 `mock`);`triggerDispatchAfterApproval` + `enqueueDispatch` 都用它 |
| C-5 | `GET /retrospectives/aggregate` 端点 | 后端 SQL 一条 GROUP BY 直接聚合 outcome × overridden 计数 + KPI sums;MatrixTab 切到这个端点(替换原 limit=500 客户端聚合) |

### 7.2 A1 真 Camera 接入

**spec 协作模式 = (a) 我们起草 + 客户审核**:

- Week 1 末发出契约草案(基于 SimulatedGuangzhouPoliceCamAdapter 接口反推)
- 客户审核窗口 ≤ 2 周;超时 escalate
- 草案版本化(`docs/integrations/customer-camera-api-v0.1.md` 等);fallback 是按草案做实现,客户 m4 末加 patch

**实现策略**:

- `src/dispatch/adapters/real-gzp.ts` — 同 SimulatedGuangzhouPoliceCamAdapter 形态,差只是 `fetch(realBackendUrl)` 而非内部 `setTimeout`
- env 切换:`CAMERA_BACKEND_KIND=simulated-gzp|real-gzp`(makePool 模板已支持)
- e2e test 保留 simulated 版(快测,无网络);**acceptance test** 选项打 real backend(`--integration` flag,默认 skip)
- 渐进切换:`SIMULATED_GZP_ENABLED=true` 仍保留作为 demo / 开发期 fallback

**关键风险**:simulated 与 real 行为差异(webhook 重试 / mediaUrls 格式 / 状态机隐含约定)— A1 实施时跑双版本对比,差异即时 spec 反馈给客户。

### 7.3 A2-α Bing News API

- `BingNewsSearchAdapter` 从 mock 切真:替换 `globalThis.fetch` 实现部分(已 fetch-based)
- env `BING_NEWS_API_KEY`;Azure Cognitive Services Bing Search 申请(Week 1 启动,跟 C 桶并行)
- **Rate limit**:每秒 ≤3 calls,日 quota 防超
- **Cache**:同关键词 24h 内不重抓
- **Fallback**:超 quota / API 错时返回 `{ hits: [], degraded: true }`,前端可见

### 7.4 A2-γ 政务网爬虫

**架构**:`GovScraperBaseAdapter`(继承 SearchAdapter)抽象基类 + 3 子类:

```ts
class GovScraperBaseAdapter implements SearchAdapter {
  readonly key: string  // 'gov-gd-province' | 'gov-gz-city' | 'gov-public-security'
  // 共享:retry / dedupe / robots.txt check / rate limit / failure isolation
  protected abstract baseUrl: string
  protected abstract listSelector: string  // cheerio selector for news list
  protected abstract parser(html: string): SearchHit[]
}
```

**3 子站点**:

| 站点 | adapter key | 难度 | 备注 |
|---|---|---|---|
| 广东省政府公示 | `gov-gd-province` | 低 | 通常 RSS 可用,RssSearchAdapter 配置即可 |
| 广州市政府公示 | `gov-gz-city` | 中 | 部分页面 SSR;cheerio 静态解析,失败降级 RSS |
| 公安厅公示 | `gov-public-security` | 中 | 同上 |

**关键约束**:

- **robots.txt 必须 respect** — 抓前 check 一遍(每天缓存);不爬 `Disallow:` 路径
- **频率限制** — 每站每分钟 ≤1 request(政务网友好原则)
- **失败隔离** — 一个站挂掉不影响其他;每站独立 BullMQ job + 独立失败计数
- **预 spike**:Week 3 起手前 0.5 天 check 3 站点 robots.txt + 静态/动态判定;任一禁则该站跳过(隔离),不阻塞其他

### 7.5 B1 自动撤单

**触发机制**:

- BullMQ scheduler tick `auto-cancel-tick`(每 5 分钟扫一次)
- SQL:
```sql
SELECT dt.id, p.id AS prediction_id, p.confidence_final
FROM dispatch_tasks dt
JOIN predictions p ON p.id = dt.prediction_id
WHERE dt.state IN ('QUEUED', 'SENT', 'IN_PROGRESS')
  AND p.confidence_final < $threshold
  AND p.auto_cancel_disabled = FALSE
  AND p.auto_cancel_below_since < NOW() - INTERVAL '$lag_minutes minutes'
```
- 对每条调用 `requestCancel(db, dispatchId, reason)`,reason 标 `[AUTO] confidence dropped to <X.XX> at <timestamp>`
- 审计:`operation_audit` 行 `action='AUTO_CANCEL_DISPATCH'`
- 通知:DECIDER inbox 推送("X 预测自动撤单 — 原因:置信度跌至 0.27")

**配置**(全 (α) 推荐版本):

| 决策 | 默认 | env 覆盖 |
|---|---|---|
| 阈值 | `0.3` | `AUTO_CANCEL_THRESHOLD` |
| 滞后 | `15 min` | `AUTO_CANCEL_LAG_MINUTES` |
| per-prediction 覆盖 | `predictions.auto_cancel_disabled boolean default false` | (DB 字段,ANALYST/REVIEWER 角色可手动改) |
| 通知 | inbox 推送 DECIDER | `AUTO_CANCEL_NOTIFY=true` |

**Schema 变更**:

- `predictions` 加列 `auto_cancel_disabled boolean default false`
- `predictions` 加列 `auto_cancel_below_since timestamptz`(实际值由置信度更新时维护:每次 confidence < threshold 时,如果当前为 NULL 则设为 NOW();confidence ≥ threshold 时清 NULL)
- migration via drizzle 标准流程

### 7.6 commit 顺序(α)

1. **Week 1**:C 桶 5 项(internal,先清债)
2. **Week 2 前半**(0.5 周):A2-α Bing News(开胃 + 让 EX-Bing-key 申请并行)
3. **Week 2 后半 + 3-4**(2.5 周 + 1 周并行):A1 spec + impl // A2-γ 政务网爬虫(并行)
4. **Week 5**:B1 自动撤单
5. **Week 6**:缓冲 + 集成 + acceptance + Slice 1 runbook

## 8. ISC Criteria(~25 框架,具体编号 writing-plans 时定)

### Cross-cutting(4)

- ISC-CC1: m4 完工 `bun test` ≥ 380(348 base + ≥30 新)
- ISC-CC2: `bunx tsc --noEmit` 全程零错
- ISC-CC3: 无 m3 baseline 回归(任何已存在 test 都不 break)
- ISC-CC4: 每 task 独立 commit + 显式 git add

### C 桶(5)

- ISC-C1..C5:5 项各自落地 + 单测覆盖

### A1 真 Camera(3)

- ISC-A1.1:`docs/integrations/customer-camera-api.md` 草案 commit + 客户审核记录
- ISC-A1.2:`RealGuangzhouPoliceCamAdapter` 实现 + 同 Simulated 端到端 e2e 形态
- ISC-A1.3:`CAMERA_BACKEND_KIND` env 切换正确(simulated/real 无侵入互换)

### A2-α Bing News(2)

- ISC-A2α.1:真 API key 接入 + rate-limit + fallback to mock + degraded flag
- ISC-A2α.2:单测覆盖 happy / rate-limit / fallback 三路径

### A2-γ 政务网(4)

- ISC-A2γ.1:`GovScraperBaseAdapter` 抽象基类 + robots.txt + retry + dedupe
- ISC-A2γ.2:`GovGdProvinceAdapter` 落地
- ISC-A2γ.3:`GovGzCityAdapter` 落地
- ISC-A2γ.4:`GovPublicSecurityAdapter` 落地 + 失败隔离 e2e

### B1 自动撤单(3)

- ISC-B1.1:scheduler tick + SQL 查询 + `auto_cancel_disabled` schema migration
- ISC-B1.2:阈值 / 滞后 / 通知 4 项 env 配置 + audit log 触发
- ISC-B1.3:单测 + e2e(模拟置信度跌破 + 验证 cancel + audit + inbox)

### 集成 acceptance(3)

- ISC-INT.1:m4 e2e full-flow(基于 m3 e2e 扩展 — 真 Bing + 真政务源 + auto-cancel 触发,但都走 mock 路径)
- ISC-INT.2:README m4 section 增补
- ISC-INT.3:m4 acceptance checklist + Slice 1 demo runbook

### Anti-criteria(3)

- ISC-Anti.1:m4 改动不破任何 m3/cnp-adapters-unify 测试
- ISC-Anti.2:`--integration` flag 关闭时 m4 e2e 不调任何外部 API(Bing / 政务网 / 客户 backend)
- ISC-Anti.3:B1 自动撤单不会撤同一个 dispatch_task 两次(幂等性)

**总计 25 ISC**(4 + 5 + 3 + 2 + 4 + 3 + 3 + 1 anti — anti-criteria 数量按需调整)

## 9. Risks

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| **R1** | EX-2 客户 backend 契约审核拖延(我们起草 → 客户审核 → 来回返工)| 高 | 高 | A1 spec 草案 Week 1 末发出,跟 C 桶并行;客户超 2 周未给反馈则 escalate;给客户的草案版本号化,fallback 是按草案实现,客户 m4 末加 patch |
| **R2** | Bing News API quota 不足 / 申请慢 | 中 | 中 | Week 1 启动申请;quota 1000/月不够则:(i) cache 24h(同关键词不重抓)(ii) 频率限速 (iii) fallback 到 mock + degraded flag |
| **R3** | 政务网爬虫合规问题(robots.txt 禁,或目标页面 SSR 无法解析)| 中 | 中 | Week 3 政务-γ 起手前 0.5 天 spike check 3 站点;任一禁 → 跳过那一站(隔离),不阻塞其他;最坏全 3 站禁 → γ 整项 m5 重定向 |
| **R4** | A1 + γ 并行 Week 3-4 时 implementer 互相阻塞 | 低 | 低 | 文件级隔离 — A1 在 `src/dispatch/adapters/`,γ 在 `src/news/adapters/`;共享只读模块不并写;reviewer 检查文件冲突 |
| **R5** | C-2 测试 DB 事务隔离让 m3 测试 break(嵌套 SAVEPOINT 兼容)| 中 | 中 | C-2 实施时 `bun test` 全跑出红线,reviewer 强约束;有 break 测试标 `[m3-tx-fix-needed]` 单独 commit fix |
| **R6** | B1 自动撤单误撤(滞后 15min 不够防短期波动)| 低 | 高 | 实施时增加观察期日志(每次"准备撤单"先 log),人工查阅 1 周如不合理调阈值 / 滞后;DECIDER inbox 通知让人能及时干预 |
| **R7** | A1 真 Camera 接入暴露 simulated 与 real 行为差异(webhook 重试 / mediaUrls 格式 / 状态机隐含约定)| 中 | 高 | A1 实施时跑双版本 e2e 对比 → 差异即时 spec 反馈给客户;m3 已有 e2e 框架可复用 |

**Buffer 决策**:计划 6 周,预留 0.5-1 周缓冲(12% 弹性)。R1+R2 同时爆 → **优先延长 m4 到 7 周**,而非砍范围(已是高 ROI 子集);除非 R1+R2+R3 三爆,转向 m4/m5 重切。

## 10. Test Strategy

| Layer | 工具 | 默认运行 | 备注 |
|---|---|---|---|
| Unit | bun:test + DI mock | CI 跑 | 延续 m3/cnp-adapters-unify 模式 |
| Integration(本地 DB)| bun:test + createTestDb | CI 跑 | C-2 改造后用 BEGIN/ROLLBACK 隔离 |
| e2e | bun:test e2e + mocked external | CI 跑 | m3 e2e 扩展;Bing / 政务 / 客户 backend 都走 mock |
| Acceptance integration | bun:test + `--integration` flag | **默认 skip** | 真 Bing API / 真政务网 / 真客户 backend;手动跑前需配置凭证 + 接受 quota 消耗 |

## 11. Schema Changes

m4 引入 1 张表变更:

```sql
ALTER TABLE predictions ADD COLUMN auto_cancel_disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE predictions ADD COLUMN auto_cancel_below_since TIMESTAMPTZ;
```

通过 drizzle 标准 migration 流程(`bun run db:generate && bun run db:migrate`)。

## 12. New env vars

| Name | Default | 用途 |
|---|---|---|
| `CAMERA_BACKEND_KIND` | `simulated-gzp` | A1 切换 simulated vs real-gzp adapter |
| `BING_NEWS_API_KEY` | (empty) | A2-α 真 Bing News API key |
| `GOV_SCRAPER_ENABLED` | `false` | A2-γ 全局开关 |
| `AUTO_CANCEL_THRESHOLD` | `0.3` | B1 阈值 |
| `AUTO_CANCEL_LAG_MINUTES` | `15` | B1 滞后保护 |
| `AUTO_CANCEL_NOTIFY` | `true` | B1 inbox 通知开关 |

## 13. Slice 1 demo runbook(m4 末段产出)

m3 时已有 `docs/demo/slice-0-runbook.md`(Slice 0,基于 simulated)。m4 完工时新增 `docs/demo/slice-1-runbook.md` 覆盖:

1. EX-2 客户 backend 凭证 + URL 配置
2. Bing API key 配置 + quota 验证
3. 政务网络 + robots.txt 检查
4. 8 步演示流程升级(同 Slice 0,但调用真 backend / 真 Bing / 真政务源 / 自动撤单触发)
5. 故障排查(真 backend 超时 / Bing 限速 / 政务网 SSR 失败 / 自动撤单未触发)
6. 演示前自检 checklist 升级版

## 14. Spec 完成后流程

1. **User reviews this spec** — 改动?通过?
2. 通过 → 进 `superpowers:writing-plans` 写出 Plan-D 实施计划(类似 Plan-C 的 37-task 详细清单)
3. Plan-D 通过后,subagent-driven 跑实施(同 m3 / cnp-adapters-unify 节奏)

---

## Appendix A — 决策追溯

本 spec 基于 4 段 brainstorming + 7 user 决策点产出:

| # | 决策点 | 选 | 备注 |
|---|---|---|---|
| Q1 | m4 主线方向 | (δ) C 单独 sprint + A 全占 m4 主体 | 后被 (II) 切片细化 |
| Q2 | A 桶 3 项取舍 | (d) A1 + A2 子集,A3 推 m5 | EX-2 契约状态 (ii)(口头无文档) |
| Q3 | A2 第 2 个信源 | (α)(β)(γ)(δ)(ζ) 5 选(剔除 ε 社交)| 后被 (II) 削减为 (α)+(γ) |
| Q4 | B 桶夹手做项 | B1+B2 | 后被 (II) 削减为只 B1 |
| Q5 | 切片方式 | (II) m4/m5 两段 | 6 周一段 + 6 周一段 |
| § 1 | Scope | 通过 | 6 块 / 6 周 |
| § 2-1 | C 5 项 | 推荐 | 全部 default |
| § 2-2 | A1 spec 协作 | (a) 我们起草 + 客户审核 | |
| § 2-3 | B1 4 项 | (α) 全推 | 0.3 / 15min / 加覆盖 / 加通知 |
| § 2-4 | commit 顺序 | (α) | C → α → A1+γ 并行 → B1 → 缓冲 |
| § 3 | Risks + ISC + 测试 + 兜底 | 全推荐 | 7 风险 / 25 ISC / 6→7 周延长 |

## Appendix B — 引用

- m3 spec: `docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md` (commit `72b1868`)
- m3 plan: `docs/superpowers/plans/2026-05-07-m3-real-end-to-end.md` (commit `bf330f7`)
- m3 acceptance: `docs/superpowers/plans/2026-05-07-m3-acceptance-checklist.md` (commit `5e428a0`)
- Slice 0 runbook: `docs/demo/slice-0-runbook.md` (commit `b337298`)
- cnp-adapters-unify ISA: `~/.claude/PAI/MEMORY/WORK/cnp-adapters-unify/ISA.md`(本机内部)
