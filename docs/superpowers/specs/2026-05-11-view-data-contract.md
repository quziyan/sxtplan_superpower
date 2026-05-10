---
slug: view-data-contract
tier: E3
status: in-effect
created: 2026-05-11
project: camera-news-prediction (排班系统)
related:
  - 2026-05-11-prediction-source-policy.md
  - 2026-05-11-schedule-tab-design.md
---

# View Data Contract — Analyst / Decider / Reviewer / Schedule

## Problem

排班系统目前有 4 个顶层视图(Analyst / Decider / Reviewer / Schedule),各自从相同的
`predictions` 表拉数据,但过滤规则散落在各 view 自己的 `useEffect`。**没有契约说明哪些
prediction 该出现在哪个视图,也没有跨视图一致性测试**。新功能(如 Schedule tab)很容易
和老视图对不齐,且现在已经发现 3 个 P0 架构缺口(状态机 DISPATCHED/COMPLETED/EXPIRED 无
写入路径)+ 2 个 P1 规则漂移(Analyst 漏 hasEvidence 等)。

本文是 **跨视图数据契约**,作为 4 视图的统一规则源,以及 P0/P1 修复的 acceptance 依据。

## Goal

为 4 个视图各自定义 **不变量(invariants)** 与 **过滤规则(filters)**,并通过测试
锁住「同一 prediction 必须出现在该出现的视图、不出现在不该出现的视图」。

## 视图契约

每个视图给出三件事:**Filter**(后端 SQL)/ **Invariants**(必须满足的不变量)/ **Anti**(明确不该出现什么)。

### 1. Analyst(分析师工作台)

| 项 | 规则 |
|---|---|
| **Filter** | `status = 'PROPOSED' AND EXISTS(news_evidence FOR p.id)` |
| **API call** | `listPredictions({ status: 'PROPOSED', hasEvidence: true, ... })` |
| **Inv-A1** | 仅展示 PROPOSED |
| **Inv-A2** | 必须至少有 1 条 news_evidence(`prediction-source-policy` 要求) |
| **Inv-A3** | 包含 `latestSnapshot` 字段,供 InboxCard 展示 reasoning |
| **Anti-A1** | 不展示 VALIDATED(已推送的归 Decider) |
| **Anti-A2** | 不展示 APPROVED/REJECTED/DISPATCHED/COMPLETED/EXPIRED |
| **Anti-A3** | 不展示无证据 PROPOSED(spec 要求) |

### 2. Decider(决策者工作台)

| 项 | 规则 |
|---|---|
| **Filter** | `status = 'VALIDATED'` |
| **API call** | `listPredictions({ status: 'VALIDATED', ... })` |
| **Inv-D1** | 仅展示 VALIDATED(分析师已推送、决策者待审) |
| **Inv-D2** | 详情 modal 内可批准 → APPROVED / 驳回 → REJECTED / 打回重审 → PROPOSED |
| **Anti-D1** | 不展示 PROPOSED(归 Analyst,虽然 state machine `ALLOWED_SOURCES.APPROVED` 也允许 PROPOSED→APPROVED 作为 BC 路径,但 UI 通道闭合) |
| **Anti-D2** | 不展示 APPROVED/REJECTED 等终态(那些归 Reviewer 或 Schedule) |

### 3. Reviewer(复盘师工作台)

| 项 | 规则 |
|---|---|
| **Filter** | 读 `retrospectives` 表,不直接读 predictions |
| **API call** | `listRetrospectives({ limit })` |
| **来源** | `retrospective` worker 扫 `predictions WHERE status IN ('COMPLETED','EXPIRED')` 派生 |
| **Inv-R1** | retrospective 行数 = 终态 prediction 数(派生关系) |
| **Inv-R2** | 三 sub-tab(Reports / Matrix / Cases)共享同一份 retrospective 数据 |
| **Anti-R1** | 不展示 PROPOSED/VALIDATED/APPROVED/DISPATCHED 任意"未结算"状态 |
| **Anti-R2** | retrospective 不能在 prediction 还未到终态时凭空产生 |

### 4. Schedule(日程,全局视图)

| 项 | 规则 |
|---|---|
| **Filter** | `windowDate ∈ [from, to]`,**无 status 过滤** |
| **API call** | `listPredictions({ from, to, includeLatestSnapshot, includeNames, limit: 500 })` |
| **Inv-S1** | 显示 anchor 月覆盖的 6×7 grid 范围内所有 prediction,跨所有 7 个 status |
| **Inv-S2** | 与角色视图的关系:`Schedule ∩ Analyst_filter = Analyst 显示集`;`Schedule ∩ Decider_filter = Decider 显示集` |
| **Anti-S1** | Schedule **不**为 status 切片;它是全局态势感面板 |
| **Anti-S2** | Schedule modal 打开时,内部按钮按用户真实 role 渲染,不因从 Schedule 进入而绕过权限 |

## 跨视图一致性不变量(全局)

| ID | 不变量 | 强制方式 |
|---|---|---|
| **X1** | 同一 prediction.id 在所有视图展示相同 status / confidence / windowDate / V / T | 共享 `GET /predictions/:id` 详情接口 |
| **X2** | Analyst ∪ Decider ∪ {APPROVED/REJECTED/DISPATCHED/COMPLETED/EXPIRED} = 全集 | 状态枚举互斥 + worker 完整链 |
| **X3** | Schedule 命中 ⊇ 各角色视图命中(因 Schedule 不过滤 status) | 测试断言 |
| **X4** | retrospectives.predictionId 必须指向 status ∈ {COMPLETED, EXPIRED} 的 prediction | FK + worker filter |
| **X5** | 任何路径 INSERT 的 PROPOSED 必须先插入对应 news_evidence | NewsExtractAgent 单一入口(已实现);其他入口在测试和 demo seed 须显式带证据 |

## 当前不一致的处理

| 不一致 | 优先级 | 本 spec 中的处置 |
|---|---|---|
| Analyst 漏 `hasEvidence: true` | P1 | **已修(本 commit)** |
| PROPOSED 过期没人改为 EXPIRED | P0 | 待补 `expire-tick` worker |
| APPROVED 派单后没人改为 DISPATCHED | P0 | 待补 `dispatch-status-sync` worker(integrate `triggerDispatchAfterApproval`) |
| DISPATCHED 出勤完成后没人改为 COMPLETED | P0 | 待补 `settle-tick` worker(整合 retrospective worker 入口) |
| Schedule 不过滤 status 是设计意图 | P2 | **已文档化(本 spec)** |

## Acceptance(本 spec 的验收)

1. `tests/views/view-consistency.test.ts` 跑通,seed 覆盖 7 状态的 prediction,断言每视图 filter 命中 = 期望集合
2. Analyst 工作台 `hasEvidence: true` 进入 API 调用(grep 确认 ≥1 处)
3. 本 spec 落盘 + commit 后任何新视图必须在此处增节 + 加测试断言

## Decisions

- **2026-05-11**: 选契约 + 测试 而非 DB CHECK 约束,因 cross-row CHECK 不被 Postgres 支持,需 trigger 实现成本高;契约+测试覆盖 95% 风险
- **2026-05-11**: Reviewer 读 retrospectives 表是有意解耦 — 复盘是派生数据,不是"另一种 prediction 状态"
- **2026-05-11**: Schedule 全显示是设计意图(全局视图),不为 status 切片
- **2026-05-11**: BC 通道 PROPOSED→APPROVED 保留在 state machine,但 UI 关闭(避免分析师推送被绕)
