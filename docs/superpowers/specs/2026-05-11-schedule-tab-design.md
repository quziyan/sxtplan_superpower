---
slug: schedule-tab
tier: E3
phase: plan
status: pending-approval
created: 2026-05-11
project: camera-news-prediction (排班系统)
---

# Schedule Tab — 月/周/日视图 Design

## Problem

现有 3 个角色视图(分析师/决策者/复盘师)各自只看本角色待处理任务,缺一个 **全局时间维度** 的观察面板:

- 看不到「本月哪些天审批堆积 / 拒单热点 / 派单密度」
- 跨角色协同时无共享视角(决策者批了 5 单,复盘师不知道分布在哪些天)
- 无法横向比较 prediction 在不同 window 上的分布

现有色彩表达散落在 `.status--*` 7 个 CSS 类里,各视图自己管自己,**跨视图色板一致性** 没有结构保障。

## Vision

打开「日程」tab 默认显示当月日历,每天格子内是 6 个状态点 + 数字 badge,鼠标移上去看摘要,点击进入详情。切到周视图同色块密度立刻反映出"AM/PM 哪个半天忙",切到日视图变成有色条的任务列表。三个视图共享一份数据 + 一套色板,**视觉记忆零摩擦**。

## Out of Scope

- ❌ 不做 schedule 作为独立 role(它是 view 不是 role)
- ❌ 不接入 dispatch_task 派单实体作为日历单位(用 prediction 为主轴;dispatch 在详情页内已有展示)
- ❌ 不做日历拖拽改窗口(改窗口走分析师工作台的编辑入口)
- ❌ 不做日历跨月凝聚视图(本期月视图按自然月切)
- ❌ 不做新建按钮 / 数据修改入口(纯只读 + 详情)
- ❌ 不做 URL 路由(沿用项目无 router 的现状;tab 状态走 sessionStorage)

## Principles

1. **色板单一源** — 7 个状态色用 token 表达,所有视图/组件 `var(--c-stage-X)` 引用,改色一次到位
2. **三视图共享数据** — 唯一 fetch 在 ScheduleView 容器层,子视图接收 props
3. **导航不改 role** — 切到 Schedule 不改用户 activeRoleKey;切回 role view 仍是原角色
4. **复用详情** — 不为 Schedule 新建一个 detail panel;DetailPane + PredictionDetail 已是 App 顶层,直接复用
5. **登录后可见** — Schedule 不被 availableRoles 过滤,任何登录用户都看得到

## Constraints

- bun/bunx 工具链 (不引 npm/npx)
- 不引入 react-router / swr / react-query(项目无,本期不引)
- 不引入 date-fns / dayjs(用原生 `Date` + 项目内 `dateUtils.ts`)
- 不动 Hono 中间件 / auth 流程
- listPredictions service 老路径(无 from/to)字节级兼容
- 单 commit per task(沿用项目惯例,subagent-driven 兼容)

## Goal

为系统补一个 **跨角色全局视图**:在 Topbar 加第 4 个 tab「📅 日程」(任何登录用户可见),内含月/周/日三个子视图,所有 prediction 按统一色板(token 驱动)渲染,点击任一项打开既有详情 modal。

## Stage Color Palette (规范化)

| 状态 | Token | 暗色值 | 亮色值 | 中文标签 |
|---|---|---|---|---|
| PROPOSED | `--c-stage-proposed` | `#7E8CA0` | `#B0B8C5` | 待审 |
| VALIDATED | `--c-stage-validated` | `#3B82F6` | `#3B82F6` | 已推送 |
| APPROVED | `--c-stage-approved` | `#22C55E` | `#16A34A` | 已批准 |
| REJECTED | `--c-stage-rejected` | `#EF4444` | `#DC2626` | 已驳回 |
| DISPATCHED | `--c-stage-dispatched` | `#A855F7` | `#9333EA` | 已调度 |
| COMPLETED | `--c-stage-completed` | `#84CC16` | `#65A30D` | 已完成 |
| EXPIRED | `--c-stage-expired` | `#4B5563` | `#6B7280` | 已过期 |

存量 `.status--*` CSS 类重构为 `color: var(--c-stage-X)` + `background: color-mix(in srgb, var(--c-stage-X) 18%, transparent)`。

## Architecture

```
App.tsx
├── activeTab: 'ANALYST' | 'DECIDER' | 'REVIEWER' | 'SCHEDULE'
├── openPrediction (顶层 modal 控制 — 复用)
├── DetailPane + PredictionDetail (顶层 — 复用)
└── 路由分发
    ├── activeTab=ANALYST/DECIDER/REVIEWER → 角色 view
    └── activeTab=SCHEDULE → ScheduleView
                              ├── useScheduleData(anchor, range) — 唯一 fetch
                              ├── 子 tab 导航
                              ├── MonthView (props: data, onOpen)
                              ├── WeekView (props: data, onOpen)
                              └── DayView (props: data, onOpen)

Topbar
├── 4 个 tab 横排:Analyst / Decider / Reviewer / Schedule
└── 点击 Schedule → setActiveTab('SCHEDULE'),不调 switchRole
    点击 Role X → setActiveTab(X) + switchRole(X)

Backend
GET /predictions?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=500
└── listPredictions({from, to, limit}) — windowDate ∈ [from, to]
```

## Data Flow

1. 进入 Schedule tab → ScheduleView mount,默认 anchor=today,默认 sub-tab=month
2. useScheduleData 计算覆盖窗口(月视图取整月 ± 1 周作 padding,实际拉取 ~6 周)
3. 单次 `listPredictions({from, to, limit:500, includeLatestSnapshot:true})` 获取所有相关行
4. ScheduleView 把 `predictions` 数组 + 工具函数(groupByDay, groupByHalfDay)传给当前激活的子视图
5. 子视图渲染,点击触发 `onOpen(predictionId)` → 父级 setOpenPrediction → App 顶层 modal 打开

## Components(新增)

| 文件 | 职责 |
|---|---|
| `frontend/src/components/StageDot.tsx` | 8px 圆点 + 状态色,month view 用 |
| `frontend/src/components/StageChip.tsx` | 紧凑色块卡片 + label,week view 用 |
| `frontend/src/components/StageLegend.tsx` | 7 色横向图例(每视图顶端) |
| `frontend/src/routes/schedule/ScheduleView.tsx` | 容器 + 子 tab 导航 + 数据 hook 调用 |
| `frontend/src/routes/schedule/MonthView.tsx` | 6×7 日历 |
| `frontend/src/routes/schedule/WeekView.tsx` | 7×2 半天网格 |
| `frontend/src/routes/schedule/DayView.tsx` | AM/PM 列表 |
| `frontend/src/routes/schedule/useScheduleData.ts` | data hook 含 anchor/range/loading |
| `frontend/src/routes/schedule/dateUtils.ts` | 月起止/周起止/AM/PM 分组工具 |

## Components(修改)

| 文件 | 改动 |
|---|---|
| `frontend/src/App.tsx` | 加 activeTab 状态 + ScheduleView 分发 |
| `frontend/src/components/topbar/Topbar.tsx` | 加 Schedule tab 渲染 + 回调 |
| `frontend/src/components/topbar/RoleTabs.tsx` | 重命名为 `ViewTabs` 或扩展支持 SCHEDULE 第 4 项 |
| `frontend/src/components/Status.tsx` | 内部仍用 `.status--*` 类,无 prop API 改动 |
| `frontend/src/styles/tokens.css` | 加 7 个 `--c-stage-*` token(暗+亮) |
| `frontend/src/styles/components.css` | `.status--*` 改用 `var(--c-stage-*)` |
| `frontend/src/lib/prediction-api.ts` | listPredictions 增 from/to 参数 |
| `src/modules/prediction/service.ts` | ListPredictionsOpts 增 from/to |
| `src/modules/prediction/routes.ts` | GET / 解析 from/to query |

## Test Strategy

| ISC | type | check | tool |
|---|---|---|---|
| ISC-1–8 | bun test | listPredictions service + route 双层 | `bun test src/modules/prediction/` |
| ISC-9–14 | bun test + tsc | token 存在 / 组件 props 渲染 | `bun test frontend/src/components/Stage*.test.tsx` |
| ISC-15–17 | bun test | Topbar 4-tab 渲染 + 点击行为 | `bun test frontend/src/components/topbar/` |
| ISC-18–21 | bun test | ScheduleView 子 tab 切换 + sessionStorage | `bun test frontend/src/routes/schedule/` |
| ISC-22–25 | bun test | MonthView 日历 + dot 点击 | `bun test MonthView.test.tsx` |
| ISC-26–28 | bun test | WeekView 网格 + chip 点击 | `bun test WeekView.test.tsx` |
| ISC-29–31 | bun test | DayView AM/PM section | `bun test DayView.test.tsx` |
| ISC-32–33 | manual + tsc | Modal 在 SCHEDULE 模式打开 + role 按钮可见性 | Interceptor 截图 |
| ISC-34 | bun tsc | typecheck | `cd frontend && bunx tsc --noEmit` + `bunx tsc --noEmit` |
| ISC-35 | manual | 未登录看不到 tab | Login 页 manual 验证 |
| ISC-36 | bun test | 切 Schedule 后 me.activeRoleKey 不变 | App.test.tsx |
| ISC-37 | bun test | 子 tab 切换不触发新 fetch | useScheduleData mock count |
| ISC-38 | bun test | 全量回归 | `bun test` 根目录 |

## Features

| name | description | satisfies | depends_on | parallelizable |
|---|---|---|---|---|
| F1 | Backend GET /predictions range | ISC-1–8 | - | yes |
| F2 | Stage color tokens + 重构 | ISC-9–14 | - | yes (与 F1 并行) |
| F3 | StageDot/Chip/Legend 组件 | ISC-11–14 | F2 | no |
| F4 | Topbar 加 Schedule tab | ISC-15–17 | - | yes (与 F1/F2 并行) |
| F5 | ScheduleView 容器 + hook | ISC-18–21 | F1 (API) | F2 | no |
| F6 | MonthView | ISC-22–25 | F3, F5 | no |
| F7 | WeekView | ISC-26–28 | F3, F5 | yes (与 F6 并行) |
| F8 | DayView | ISC-29–31 | F3, F5 | yes (与 F6/F7 并行) |
| F9 | Modal 集成验证 + 回归 | ISC-32–38 | all | no |

## Acceptance Criteria(交付时跑这个)

1. `bun test` 双端绿(445 + 新增 ≈ 25 测试)
2. `bunx tsc --noEmit`(根+frontend)零 error
3. Interceptor 截图:
   - Topbar 显示 4 tab
   - 月视图首屏含状态色点
   - 点击点弹出 modal,modal 内角色按钮按当前 role 渲染
   - 切到周视图无重复网络请求(devtools network 验)
4. 在分析师 role 下进 Schedule 看到全部 prediction,modal 内 approve/reject 按钮 **不出现**(role gating 正常)
5. 在决策者 role 下进 Schedule,modal 内 approve/reject 按钮出现

## Anti-Criteria

- Anti: Schedule tab 不可让未登录用户看到
- Anti: Schedule tab 不可改用户 activeRoleKey 持久化值
- Anti: 三视图不可各自独立 GET /predictions
- Anti: 不可硬编码 hex 在新组件代码里(必须走 token)

## Decisions

- **2026-05-11**: 选 prediction 作日历单位(用户 Q1=A 确认),非 dispatch_task,因为 prediction 有完整生命周期且已有详情页
- **2026-05-11**: 点击行为复用现有 DetailPane modal(用户 Q2=A 确认),非新建详情页
- **2026-05-11**: 全 3 个 role 可见(用户 Q3=A 确认),不加新角色「调度」
- **2026-05-11**: tab 状态用 sessionStorage 非 URL,因为项目无 react-router 且引入仅为此功能不划算
- **2026-05-11**: Topbar 第 4 tab 始终可见,不被 availableRoles 过滤(全局视图原则)
- **2026-05-11**: 月视图 padding 6 周窗口拉取(覆盖跨月日)避免边缘日空白
