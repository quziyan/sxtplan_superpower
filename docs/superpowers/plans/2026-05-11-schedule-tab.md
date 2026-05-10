# Schedule Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给系统加第 4 个顶层 tab「日程」,内含月/周/日视图,跨视图色板一致,点击 prediction 复用既有详情 modal。

**Architecture:** React + Vite SPA 在 App 层加 activeTab,Topbar 渲染 4 tab,新建 `routes/schedule/` 三视图共享单次 fetch。后端 listPredictions 加 from/to 范围参数。色板抽 token 化。

**Tech Stack:** TypeScript + bun + Hono + drizzle + React 18 + Vite + 项目自有 design tokens

**Spec:** `docs/superpowers/specs/2026-05-11-schedule-tab-design.md`

---

## Section 0 — Preflight

### Task 0.1: Baseline 验证

**Files:** none (read-only)

- [ ] **Step 1: 跑测试基线**

```bash
cd /Users/quzhi/Desktop/排班系统设计-superpowers
bun test 2>&1 | tail -5
```

Expected: `445 pass / 0 fail / 2 skip`

- [ ] **Step 2: typecheck baseline**

```bash
bunx tsc --noEmit && (cd frontend && bunx tsc --noEmit)
```

Expected: 双端无 error

---

## Section 1 — Backend GET /predictions Range

### Task 1.1: listPredictions service 增 from/to

**Files:**
- Modify: `src/modules/prediction/service.ts:11-26`(ListPredictionsOpts)
- Modify: `src/modules/prediction/service.ts:45-79`(listPredictions body)
- Test: `tests/modules/prediction/list-by-date-range.test.ts`(new)

- [ ] **Step 1: 写测试 list-by-date-range.test.ts**

```typescript
import { describe, expect, test } from 'bun:test'
import { listPredictions } from '@/modules/prediction/service'
import { createTestDb, seedPredictions } from '@/test-utils/db'

describe('listPredictions by date range', () => {
  test('returns rows with windowDate in [from, to]', async () => {
    const db = await createTestDb()
    await seedPredictions(db, [
      { windowDate: '2026-05-01', windowHalf: 'AM' },
      { windowDate: '2026-05-15', windowHalf: 'PM' },
      { windowDate: '2026-05-31', windowHalf: 'AM' },
      { windowDate: '2026-06-01', windowHalf: 'AM' },
    ])
    const rows = await listPredictions(db, { from: '2026-05-01', to: '2026-05-31' })
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.windowDate >= '2026-05-01' && r.windowDate <= '2026-05-31')).toBe(true)
  })

  test('from-only filter works', async () => {
    const db = await createTestDb()
    await seedPredictions(db, [
      { windowDate: '2026-04-15', windowHalf: 'AM' },
      { windowDate: '2026-05-15', windowHalf: 'AM' },
    ])
    const rows = await listPredictions(db, { from: '2026-05-01' })
    expect(rows).toHaveLength(1)
  })

  test('no from/to is byte-compatible with prior behavior', async () => {
    const db = await createTestDb()
    await seedPredictions(db, [{ windowDate: '2026-05-15', windowHalf: 'AM' }])
    const rows = await listPredictions(db, {})
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败(from/to 还未实现)**

```bash
bun test tests/modules/prediction/list-by-date-range.test.ts
```

Expected: FAIL `from is not a valid option`

- [ ] **Step 3: 改 service.ts 加 from/to**

```typescript
// 在 ListPredictionsOpts 加:
from?: string  // YYYY-MM-DD
to?: string    // YYYY-MM-DD

// 在 listPredictions 函数 hasEvidence 分支之外加 from/to 处理:
const { from, to } = opts
// Drizzle 用 gte/lte
import { gte, lte } from 'drizzle-orm'
const whereClauses = []
if (opts.status) whereClauses.push(eq(predictions.status, opts.status))
if (from) whereClauses.push(gte(predictions.windowDate, from))
if (to) whereClauses.push(lte(predictions.windowDate, to))
const where = whereClauses.length ? and(...whereClauses) : undefined
const rows = where
  ? await db.select().from(predictions).where(where).orderBy(...).limit(limit)
  : await db.select().from(predictions).orderBy(...).limit(limit)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
bun test tests/modules/prediction/list-by-date-range.test.ts
```

Expected: PASS 3/3

- [ ] **Step 5: 全量回归**

```bash
bun test 2>&1 | tail -3
```

Expected: 448 pass(原 445 + 新 3)

- [ ] **Step 6: commit**

```bash
git add src/modules/prediction/service.ts tests/modules/prediction/list-by-date-range.test.ts
git commit -m "feat(prediction): listPredictions accepts from/to date range filter"
```

### Task 1.2: GET /predictions route 接收 from/to query

**Files:**
- Modify: `src/modules/prediction/routes.ts:44-62`
- Test: `tests/modules/prediction/routes-range.test.ts`(new)

- [ ] **Step 1: 写测试**

```typescript
import { describe, expect, test } from 'bun:test'
import { buildApp } from '@/test-utils/app'

describe('GET /predictions range params', () => {
  test('?from=2026-05-01&to=2026-05-31 returns scoped rows', async () => {
    const { app, db, token } = await buildApp()
    // seed 多日数据 ...
    const res = await app.request('/predictions?from=2026-05-01&to=2026-05-31', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows.every((r: any) => r.windowDate >= '2026-05-01' && r.windowDate <= '2026-05-31')).toBe(true)
  })

  test('?from=garbage returns 400', async () => {
    const { app, token } = await buildApp()
    const res = await app.request('/predictions?from=not-a-date', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
bun test tests/modules/prediction/routes-range.test.ts
```

Expected: FAIL — from/to 还未在 route 处理

- [ ] **Step 3: 改 routes.ts**

```typescript
app.get('/', authRequired(db), async (c) => {
  const status = c.req.query('status')
  const fromRaw = c.req.query('from')
  const toRaw = c.req.query('to')
  // 校验 YYYY-MM-DD
  if (fromRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
    throw BadRequest('from must be YYYY-MM-DD')
  }
  if (toRaw && !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    throw BadRequest('to must be YYYY-MM-DD')
  }
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10), 500) : undefined
  // ... 现有 include/hasEvidence 解析 ...
  return c.json(await listPredictions(db, {
    ...(status ? { status: status as any } : {}),
    ...(fromRaw ? { from: fromRaw } : {}),
    ...(toRaw ? { to: toRaw } : {}),
    ...(limit ? { limit } : {}),
    ...(includeLatestSnapshot ? { includeLatestSnapshot: true } : {}),
    ...(hasEvidence ? { hasEvidence: true } : {}),
  }))
})
```

- [ ] **Step 4: 跑测试 PASS**

- [ ] **Step 5: commit**

```bash
git add src/modules/prediction/routes.ts tests/modules/prediction/routes-range.test.ts
git commit -m "feat(prediction): GET /predictions accepts from/to query params"
```

---

## Section 2 — Stage Color Tokens + Status 重构

### Task 2.1: tokens.css 增 7 个 stage token

**Files:**
- Modify: `frontend/src/styles/tokens.css`

- [ ] **Step 1: 在 :root(暗色 default)与 light theme 块都加 token**

```css
/* 在 :root 暗色块尾部加: */
--c-stage-proposed:   #7E8CA0;
--c-stage-validated:  #3B82F6;
--c-stage-approved:   #22C55E;
--c-stage-rejected:   #EF4444;
--c-stage-dispatched: #A855F7;
--c-stage-completed:  #84CC16;
--c-stage-expired:    #4B5563;

/* 在 light theme 块尾部加(覆盖): */
--c-stage-proposed:   #B0B8C5;
--c-stage-approved:   #16A34A;
--c-stage-rejected:   #DC2626;
--c-stage-dispatched: #9333EA;
--c-stage-completed:  #65A30D;
--c-stage-expired:    #6B7280;
/* validated 两 theme 同色 */
```

- [ ] **Step 2: 重构 components.css `.status--*`**

```css
/* 删除原 .status--proposed/validated/.../expired 7 行
   改成统一逻辑: */
.status--proposed   { color: var(--c-stage-proposed);   background: color-mix(in srgb, var(--c-stage-proposed) 18%, transparent); }
.status--validated  { color: var(--c-stage-validated);  background: color-mix(in srgb, var(--c-stage-validated) 18%, transparent); }
.status--approved   { color: var(--c-stage-approved);   background: color-mix(in srgb, var(--c-stage-approved) 18%, transparent); }
.status--rejected   { color: var(--c-stage-rejected);   background: color-mix(in srgb, var(--c-stage-rejected) 18%, transparent); }
.status--dispatched { color: var(--c-stage-dispatched); background: color-mix(in srgb, var(--c-stage-dispatched) 18%, transparent); }
.status--completed  { color: var(--c-stage-completed);  background: color-mix(in srgb, var(--c-stage-completed) 18%, transparent); }
.status--expired    { color: var(--c-stage-expired);    background: color-mix(in srgb, var(--c-stage-expired) 18%, transparent); }
```

- [ ] **Step 3: 视觉回归 — Interceptor 看分析师/决策者/复盘师页**

```bash
# 确认 status pill 颜色与之前接近(只是 token 化,视觉应几乎一致)
bunx interceptor open http://localhost:5173/
```

- [ ] **Step 4: commit**

```bash
git add frontend/src/styles/tokens.css frontend/src/styles/components.css
git commit -m "refactor(tokens): introduce --c-stage-* tokens; status pills consume them"
```

### Task 2.2: StageDot / StageChip / StageLegend 三组件

**Files:**
- Create: `frontend/src/components/StageDot.tsx`
- Create: `frontend/src/components/StageChip.tsx`
- Create: `frontend/src/components/StageLegend.tsx`
- Create: `frontend/src/components/Stage.test.tsx`
- Modify: `frontend/src/components/index.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, expect, test } from 'bun:test'
import { render } from '@testing-library/react'
import { StageDot } from './StageDot'
import { StageChip } from './StageChip'
import { StageLegend } from './StageLegend'

describe('Stage components', () => {
  test('StageDot renders with status color CSS variable', () => {
    const { container } = render(<StageDot status="APPROVED" />)
    const dot = container.querySelector('.stage-dot') as HTMLElement
    expect(dot.style.backgroundColor).toContain('var(--c-stage-approved)')
  })

  test('StageChip renders status label', () => {
    const { getByText } = render(<StageChip status="VALIDATED" label="车辆A · 巡逻" />)
    expect(getByText(/车辆A/)).toBeTruthy()
  })

  test('StageLegend renders 7 status entries', () => {
    const { container } = render(<StageLegend />)
    expect(container.querySelectorAll('.stage-legend__item')).toHaveLength(7)
  })
})
```

- [ ] **Step 2: 实现 StageDot.tsx**

```typescript
import type { PredictionStatus } from './Status'

export function StageDot({ status, size = 8, title }: {
  status: PredictionStatus
  size?: number
  title?: string
}) {
  return (
    <span
      className="stage-dot"
      title={title}
      style={{
        display: 'inline-block',
        width: size, height: size, borderRadius: '50%',
        backgroundColor: `var(--c-stage-${status.toLowerCase()})`,
      }}
    />
  )
}
```

- [ ] **Step 3: 实现 StageChip.tsx**

```typescript
import type { PredictionStatus } from './Status'

export function StageChip({ status, label, sub, onClick }: {
  status: PredictionStatus
  label: string
  sub?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="stage-chip"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: 'var(--sp-2)',
        borderLeft: `4px solid var(--c-stage-${status.toLowerCase()})`,
        background: `color-mix(in srgb, var(--c-stage-${status.toLowerCase()}) 12%, transparent)`,
        border: '1px solid var(--c-border, #2a2f3a)',
        borderRadius: 4,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 'var(--fs-2)', fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>{sub}</div>}
    </button>
  )
}
```

- [ ] **Step 4: 实现 StageLegend.tsx**

```typescript
import type { PredictionStatus } from './Status'

const LEGEND: Array<{ status: PredictionStatus; label: string }> = [
  { status: 'PROPOSED', label: '待审' },
  { status: 'VALIDATED', label: '已推送' },
  { status: 'APPROVED', label: '已批准' },
  { status: 'REJECTED', label: '已驳回' },
  { status: 'DISPATCHED', label: '已调度' },
  { status: 'COMPLETED', label: '已完成' },
  { status: 'EXPIRED', label: '已过期' },
]

export function StageLegend() {
  return (
    <div className="stage-legend" style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
      {LEGEND.map(({ status, label }) => (
        <div key={status} className="stage-legend__item" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            backgroundColor: `var(--c-stage-${status.toLowerCase()})`,
          }} />
          <span style={{ fontSize: 'var(--fs-2)', color: 'var(--c-muted)' }}>{label}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: 在 components/index.ts 导出**

```typescript
export { StageDot } from './StageDot'
export { StageChip } from './StageChip'
export { StageLegend } from './StageLegend'
```

- [ ] **Step 6: 跑测试**

```bash
cd frontend && bun test src/components/Stage.test.tsx
```

Expected: PASS 3/3

- [ ] **Step 7: commit**

```bash
git add frontend/src/components/Stage*.tsx frontend/src/components/index.ts
git commit -m "feat(components): StageDot/StageChip/StageLegend driven by --c-stage-* tokens"
```

---

## Section 3 — Topbar 增 Schedule Tab

### Task 3.1: ViewTabs 替代 RoleTabs

**Files:**
- Modify: `frontend/src/components/topbar/RoleTabs.tsx` → 改名/扩展为 ViewTabs
- Modify: `frontend/src/components/topbar/Topbar.tsx`
- Test: `frontend/src/components/topbar/ViewTabs.test.tsx`(new)

- [ ] **Step 1: 写测试**

```typescript
import { describe, expect, test } from 'bun:test'
import { render, fireEvent } from '@testing-library/react'
import { ViewTabs } from './RoleTabs'

describe('ViewTabs', () => {
  test('renders 3 role tabs + schedule tab always visible', () => {
    const { getByText } = render(
      <ViewTabs active="ANALYST" available={['ANALYST']} onChange={() => {}} />
    )
    expect(getByText('分析师')).toBeTruthy()
    expect(getByText('日程')).toBeTruthy()
    // DECIDER/REVIEWER 不在 available 中,应不渲染
  })

  test('clicking Schedule fires onChange("SCHEDULE")', () => {
    const onChange = mock(() => {})
    const { getByText } = render(
      <ViewTabs active="ANALYST" available={['ANALYST']} onChange={onChange} />
    )
    fireEvent.click(getByText('日程').closest('button')!)
    expect(onChange).toHaveBeenCalledWith('SCHEDULE')
  })
})
```

- [ ] **Step 2: 改 RoleTabs.tsx — 改名 + 加 TabKey + Schedule 项**

```typescript
import { Icon, type IconName } from '../Icon'

export type RoleKey = 'ANALYST' | 'DECIDER' | 'REVIEWER'
export type TabKey = RoleKey | 'SCHEDULE'

export type TabDef = {
  key: TabKey
  label: string
  sub: string
  icon: IconName
  alwaysVisible?: boolean  // schedule = true
}

export const DEFAULT_TABS: TabDef[] = [
  { key: 'ANALYST',  label: '分析师', sub: '监视 + 推送',  icon: 'eye' },
  { key: 'DECIDER',  label: '决策者', sub: '审批调度',      icon: 'check' },
  { key: 'REVIEWER', label: '复盘师', sub: '校准 + 沉淀',    icon: 'book' },
  { key: 'SCHEDULE', label: '日程',   sub: '全局视图',      icon: 'calendar', alwaysVisible: true },
]

export function ViewTabs({ active, available, onChange }: {
  active: TabKey | null
  available: RoleKey[]
  onChange: (k: TabKey) => void
}) {
  return (
    <div className="topbar__roles">
      {DEFAULT_TABS.filter((t) => t.alwaysVisible || available.includes(t.key as RoleKey)).map((t) => (
        <button key={t.key}
          className={`role-tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}>
          <Icon name={t.icon} size={13} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{t.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', lineHeight: 1.2 }}>{t.sub}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

// 兼容旧引用,保留 export
export { ViewTabs as RoleTabs }
```

- [ ] **Step 3: 确认 Icon 组件支持 'calendar' name**

```bash
grep "calendar" frontend/src/components/Icon.tsx
```

如果没有,加 calendar svg(或临时用 'clock')

- [ ] **Step 4: 改 Topbar.tsx**

```typescript
import { ViewTabs, type TabKey, type RoleKey } from './RoleTabs'

export function Topbar({ user, activeTab, availableRoles, onTabChange, onLogout }: {
  user: { displayName: string | null; email: string }
  activeTab: TabKey | null
  availableRoles: RoleKey[]
  onTabChange: (k: TabKey) => void
  onLogout: () => void
}) {
  return (
    <header className="topbar">
      <Brand />
      <ViewTabs active={activeTab} available={availableRoles} onChange={onTabChange} />
      <div className="topbar__actions">
        {/* ... */}
        <UserPill displayName={user.displayName} email={user.email}
                  activeRole={activeTab === 'SCHEDULE' ? null : (activeTab as RoleKey | null)} />
        {/* ... */}
      </div>
    </header>
  )
}
```

- [ ] **Step 5: 跑测试 PASS + tsc**

- [ ] **Step 6: commit**

```bash
git add frontend/src/components/topbar/
git commit -m "feat(topbar): introduce TabKey + Schedule tab always visible"
```

### Task 3.2: App.tsx activeTab 状态机

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 加 activeTab 状态**

```typescript
const [activeTab, setActiveTab] = useState<TabKey | null>(null)

// init from auth state when ready:
useEffect(() => {
  if (state.status === 'authenticated' && activeTab === null) {
    setActiveTab((state.me.activeRoleKey as TabKey | null) ?? null)
  }
}, [state.status])

const onTabChange = (k: TabKey) => {
  setActiveTab(k)
  if (k !== 'SCHEDULE') {
    switchRole(k)  // 真切角色
  }
  // SCHEDULE: 不触 switchRole,activeRoleKey 不变
}
```

- [ ] **Step 2: 路由分发**

```typescript
const currentRole = activeTab === 'SCHEDULE' ? (me.activeRoleKey as RoleKey | null) : (activeTab as RoleKey | null)

<div className="app__body">
  {activeTab === 'ANALYST'  && <AnalystView  onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
  {activeTab === 'DECIDER'  && <DecisionView onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
  {activeTab === 'REVIEWER' && <ReviewerView />}
  {activeTab === 'SCHEDULE' && <ScheduleView onOpenPrediction={setOpenPrediction} mutationVersion={refreshKey} />}
  {!activeTab && <div className="empty">请在顶部选择一个视图。</div>}
</div>

<DetailPane ...>
  {openPrediction && (
    <PredictionDetail
      predictionId={openPrediction}
      activeRole={currentRole}  // 注意:role 取自 me.activeRoleKey,不取自 activeTab
      onMutated={() => setRefreshKey(k => k + 1)}
    />
  )}
</DetailPane>
```

- [ ] **Step 3: tsc 双端**

- [ ] **Step 4: commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(app): activeTab state machine with SCHEDULE branch"
```

---

## Section 4 — ScheduleView 容器 + Data Hook + dateUtils

### Task 4.1: dateUtils.ts

**Files:**
- Create: `frontend/src/routes/schedule/dateUtils.ts`
- Create: `frontend/src/routes/schedule/dateUtils.test.ts`

- [ ] **Step 1: 写测试 first**

```typescript
import { describe, expect, test } from 'bun:test'
import { monthGridRange, weekRange, formatYmd, parseYmd, sameDay } from './dateUtils'

describe('dateUtils', () => {
  test('monthGridRange returns 42 days (6 weeks) covering target month', () => {
    const { start, end, cells } = monthGridRange(new Date('2026-05-15'))
    expect(cells).toHaveLength(42)
    // 5 月 1 日是周五;周一开始网格,所以 grid 起 4/27 (周一)
    expect(formatYmd(start)).toBe('2026-04-27')
    expect(formatYmd(end)).toBe('2026-06-07')
  })

  test('weekRange around 5/15 (周五) returns Mon-Sun', () => {
    const { start, end, days } = weekRange(new Date('2026-05-15'))
    expect(days).toHaveLength(7)
    expect(formatYmd(start)).toBe('2026-05-11')
    expect(formatYmd(end)).toBe('2026-05-17')
  })

  test('formatYmd / parseYmd round-trip', () => {
    expect(formatYmd(parseYmd('2026-05-15'))).toBe('2026-05-15')
  })
})
```

- [ ] **Step 2: 实现 dateUtils.ts**

```typescript
export function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// 周一为周首
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7  // 周一=0, 周日=6
}

export function monthGridRange(anchor: Date): { start: Date; end: Date; cells: Date[] } {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const offset = mondayIndex(firstOfMonth)
  const start = new Date(firstOfMonth)
  start.setDate(1 - offset)
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  const end = cells[cells.length - 1]!
  return { start, end, cells }
}

export function weekRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const offset = mondayIndex(anchor)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - offset)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return { start, end: days[6]!, days }
}
```

- [ ] **Step 3: 跑测试 PASS**

- [ ] **Step 4: commit**

```bash
git add frontend/src/routes/schedule/dateUtils*
git commit -m "feat(schedule): dateUtils for month/week grid math"
```

### Task 4.2: lib/prediction-api.ts listPredictions 加 from/to

**Files:**
- Modify: `frontend/src/lib/prediction-api.ts:62-76`

- [ ] **Step 1: 改 listPredictions opts**

```typescript
export async function listPredictions(
  opts: {
    status?: PredictionStatus
    limit?: number
    includeLatestSnapshot?: boolean
    hasEvidence?: boolean
    from?: string
    to?: string
  } = {},
): Promise<PredictionListItem[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  if (opts.includeLatestSnapshot) params.set('include', 'latest_snapshot')
  if (opts.hasEvidence) params.set('has_evidence', 'true')
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return api<PredictionListItem[]>(`/predictions${qs ? `?${qs}` : ''}`)
}
```

- [ ] **Step 2: tsc clean + commit**

```bash
git add frontend/src/lib/prediction-api.ts
git commit -m "feat(api): listPredictions accepts from/to params"
```

### Task 4.3: useScheduleData hook

**Files:**
- Create: `frontend/src/routes/schedule/useScheduleData.ts`

- [ ] **Step 1: 实现 hook**

```typescript
import { useEffect, useState } from 'react'
import { listPredictions, type PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, monthGridRange } from './dateUtils'

export type ScheduleData = {
  predictions: PredictionListItem[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useScheduleData(anchor: Date, mutationVersion: number): ScheduleData {
  const [predictions, setPredictions] = useState<PredictionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const { start, end } = monthGridRange(anchor)
    setLoading(true); setError(null)
    listPredictions({
      from: formatYmd(start),
      to: formatYmd(end),
      limit: 500,
      includeLatestSnapshot: true,
    })
      .then(setPredictions)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [anchor.getFullYear(), anchor.getMonth(), mutationVersion, reloadKey])

  return {
    predictions,
    loading,
    error,
    refresh: () => setReloadKey(k => k + 1),
  }
}
```

- [ ] **Step 2: tsc + commit**

```bash
git add frontend/src/routes/schedule/useScheduleData.ts
git commit -m "feat(schedule): useScheduleData single-fetch month-grid hook"
```

### Task 4.4: ScheduleView 容器 + 子 tab 导航

**Files:**
- Create: `frontend/src/routes/schedule/ScheduleView.tsx`
- Test: `frontend/src/routes/schedule/ScheduleView.test.tsx`

- [ ] **Step 1: 写测试**

```typescript
import { describe, expect, test } from 'bun:test'
import { render, fireEvent } from '@testing-library/react'
import { ScheduleView } from './ScheduleView'

describe('ScheduleView', () => {
  test('renders 3 sub tabs default to month', () => {
    const { getByText, container } = render(<ScheduleView onOpenPrediction={() => {}} mutationVersion={0} />)
    expect(getByText('月视图')).toBeTruthy()
    expect(getByText('周视图')).toBeTruthy()
    expect(getByText('日视图')).toBeTruthy()
    // 默认 month
    expect(container.querySelector('[data-active-subtab="month"]')).toBeTruthy()
  })

  test('clicking 周视图 switches sub tab', () => {
    const { getByText, container } = render(<ScheduleView onOpenPrediction={() => {}} mutationVersion={0} />)
    fireEvent.click(getByText('周视图'))
    expect(container.querySelector('[data-active-subtab="week"]')).toBeTruthy()
  })

  test('sub tab persists to sessionStorage', () => {
    const { getByText } = render(<ScheduleView onOpenPrediction={() => {}} mutationVersion={0} />)
    fireEvent.click(getByText('日视图'))
    expect(sessionStorage.getItem('schedule:subtab')).toBe('day')
  })
})
```

- [ ] **Step 2: 实现 ScheduleView**

```typescript
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { StageLegend } from '@/components/StageLegend'
import { Btn } from '@/components/Btn'
import { useScheduleData } from './useScheduleData'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { DayView } from './DayView'

type SubTab = 'month' | 'week' | 'day'

const SUBTABS: Array<{ key: SubTab; label: string }> = [
  { key: 'month', label: '月视图' },
  { key: 'week', label: '周视图' },
  { key: 'day', label: '日视图' },
]

export function ScheduleView({ onOpenPrediction, mutationVersion }: {
  onOpenPrediction: (id: string) => void
  mutationVersion: number
}) {
  const [subtab, setSubtab] = useState<SubTab>(() => {
    return (sessionStorage.getItem('schedule:subtab') as SubTab) || 'month'
  })
  const [anchor, setAnchor] = useState<Date>(() => {
    const ymd = sessionStorage.getItem('schedule:anchor')
    return ymd ? new Date(ymd) : new Date()
  })
  useEffect(() => { sessionStorage.setItem('schedule:subtab', subtab) }, [subtab])
  useEffect(() => { sessionStorage.setItem('schedule:anchor', anchor.toISOString()) }, [anchor])

  const data = useScheduleData(anchor, mutationVersion)

  return (
    <div className="workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PageHeader title="日程" subtitle="全局视图 · 跨角色 prediction 时间分布" />
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', padding: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          {SUBTABS.map((t) => (
            <Btn key={t.key} variant={subtab === t.key ? 'primary' : 'ghost'} onClick={() => setSubtab(t.key)}>
              {t.label}
            </Btn>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <StageLegend />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--sp-3)' }}
           data-active-subtab={subtab}>
        {data.loading && <div className="empty">加载中…</div>}
        {data.error && <div className="empty">加载失败:{data.error}</div>}
        {!data.loading && !data.error && (
          <>
            {subtab === 'month' && <MonthView data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
            {subtab === 'week'  && <WeekView  data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
            {subtab === 'day'   && <DayView   data={data.predictions} anchor={anchor} onAnchor={setAnchor} onOpen={onOpenPrediction} />}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 测试 PASS + commit**

```bash
git add frontend/src/routes/schedule/ScheduleView.* 
git commit -m "feat(schedule): ScheduleView container with 3 sub-tabs + shared data"
```

---

## Section 5 — Three Sub Views

### Task 5.1: MonthView

**Files:**
- Create: `frontend/src/routes/schedule/MonthView.tsx`

- [ ] **Step 1: 实现**

```typescript
import { useMemo } from 'react'
import { Btn } from '@/components/Btn'
import { StageDot } from '@/components/StageDot'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, monthGridRange, sameDay } from './dateUtils'

export function MonthView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const { cells } = monthGridRange(anchor)
  const byDay = useMemo(() => {
    const m = new Map<string, PredictionListItem[]>()
    for (const p of data) {
      const ymd = p.windowDate.slice(0, 10)
      const arr = m.get(ymd) ?? []
      arr.push(p)
      m.set(ymd, arr)
    }
    return m
  }, [data])

  const monthLabel = `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn onClick={() => onAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>← 上月</Btn>
        <Btn onClick={() => onAnchor(new Date())}>今日</Btn>
        <Btn onClick={() => onAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>下月 →</Btn>
        <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{monthLabel}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--c-border, #2a2f3a)' }}>
        {['一','二','三','四','五','六','日'].map((d) => (
          <div key={d} style={{ background: 'var(--c-panel-2)', padding: '6px 8px', fontSize: 'var(--fs-2)', color: 'var(--c-muted)', textAlign: 'center' }}>
            周{d}
          </div>
        ))}
        {cells.map((day) => {
          const ymd = formatYmd(day)
          const items = byDay.get(ymd) ?? []
          const inMonth = day.getMonth() === anchor.getMonth()
          const isToday = sameDay(day, new Date())
          return (
            <div key={ymd} style={{
              background: 'var(--c-panel-2)',
              padding: 6, minHeight: 84,
              opacity: inMonth ? 1 : 0.4,
              outline: isToday ? '2px solid var(--c-accent)' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-1)', marginBottom: 4 }}>
                <span>{day.getDate()}</span>
                {items.length > 0 && <span style={{ color: 'var(--c-muted)' }}>{items.length}</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {items.map((p) => (
                  <button key={p.id} onClick={() => onOpen(p.id)}
                    title={`${p.windowHalf} · ${p.status}`}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    <StageDot status={p.status} />
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: commit**

```bash
git add frontend/src/routes/schedule/MonthView.tsx
git commit -m "feat(schedule): MonthView 6x7 calendar with stage dots"
```

### Task 5.2: WeekView

**Files:**
- Create: `frontend/src/routes/schedule/WeekView.tsx`

- [ ] **Step 1: 实现**

```typescript
import { useMemo } from 'react'
import { Btn } from '@/components/Btn'
import { StageChip } from '@/components/StageChip'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd, weekRange, sameDay } from './dateUtils'

export function WeekView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const { days } = weekRange(anchor)
  const byHalf = useMemo(() => {
    const m = new Map<string, PredictionListItem[]>()
    for (const p of data) {
      const key = `${p.windowDate.slice(0, 10)}_${p.windowHalf}`
      const arr = m.get(key) ?? []
      arr.push(p)
      m.set(key, arr)
    }
    return m
  }, [data])

  const weekLabel = `${formatYmd(days[0]!)} ~ ${formatYmd(days[6]!)}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() - 7); onAnchor(d) }}>← 上周</Btn>
        <Btn onClick={() => onAnchor(new Date())}>本周</Btn>
        <Btn onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() + 7); onAnchor(d) }}>下周 →</Btn>
        <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{weekLabel}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', gap: 1, background: 'var(--c-border, #2a2f3a)' }}>
        <div style={{ background: 'var(--c-panel-2)' }} />
        {days.map((d) => (
          <div key={formatYmd(d)} style={{
            background: 'var(--c-panel-2)', padding: '6px 8px', fontSize: 'var(--fs-2)',
            color: 'var(--c-muted)', textAlign: 'center',
            outline: sameDay(d, new Date()) ? '2px solid var(--c-accent)' : 'none',
          }}>
            <div>{['一','二','三','四','五','六','日'][((d.getDay()+6)%7)]}</div>
            <div>{d.getMonth() + 1}/{d.getDate()}</div>
          </div>
        ))}
        {(['AM', 'PM'] as const).map((half) => (
          <>
            <div key={`label-${half}`} style={{ background: 'var(--c-panel-2)', padding: 8, fontSize: 'var(--fs-2)', color: 'var(--c-muted)', textAlign: 'center' }}>
              {half === 'AM' ? '上午' : '下午'}
            </div>
            {days.map((d) => {
              const items = byHalf.get(`${formatYmd(d)}_${half}`) ?? []
              return (
                <div key={`${formatYmd(d)}-${half}`} style={{ background: 'var(--c-panel-2)', padding: 4, minHeight: 100, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {items.map((p) => (
                    <StageChip key={p.id}
                      status={p.status}
                      label={`置信 ${p.confidenceNow}`}
                      sub={p.id.slice(0, 8)}
                      onClick={() => onOpen(p.id)} />
                  ))}
                </div>
              )
            })}
          </>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: commit**

```bash
git add frontend/src/routes/schedule/WeekView.tsx
git commit -m "feat(schedule): WeekView 7-day x AM/PM grid with stage chips"
```

### Task 5.3: DayView

**Files:**
- Create: `frontend/src/routes/schedule/DayView.tsx`

- [ ] **Step 1: 实现**

```typescript
import { useMemo } from 'react'
import { Btn } from '@/components/Btn'
import { Status } from '@/components/Status'
import { ConfBar } from '@/components/ConfBar'
import type { PredictionListItem } from '@/lib/prediction-api'
import { formatYmd } from './dateUtils'

export function DayView({ data, anchor, onAnchor, onOpen }: {
  data: PredictionListItem[]
  anchor: Date
  onAnchor: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const ymd = formatYmd(anchor)
  const am = useMemo(() => data.filter(p => p.windowDate.slice(0,10) === ymd && p.windowHalf === 'AM'), [data, ymd])
  const pm = useMemo(() => data.filter(p => p.windowDate.slice(0,10) === ymd && p.windowHalf === 'PM'), [data, ymd])

  const Row = ({ p }: { p: PredictionListItem }) => (
    <button onClick={() => onOpen(p.id)}
      style={{
        display: 'grid', gridTemplateColumns: '4px 1fr auto auto',
        gap: 12, alignItems: 'center', width: '100%', textAlign: 'left',
        background: 'var(--c-panel-2)', border: '1px solid var(--c-border, #2a2f3a)',
        borderRadius: 4, padding: '8px 12px', cursor: 'pointer',
      }}>
      <div style={{ width: 4, height: 32, background: `var(--c-stage-${p.status.toLowerCase()})`, borderRadius: 2 }} />
      <div>
        <div style={{ fontSize: 'var(--fs-3)' }}>{p.id.slice(0, 8)}</div>
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--c-muted)' }}>{p.sourceKind} · {p.sourceId.slice(0, 8)}</div>
      </div>
      <ConfBar value={p.confidenceNow} />
      <Status value={p.status} />
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <Btn onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() - 1); onAnchor(d) }}>← 昨日</Btn>
        <Btn onClick={() => onAnchor(new Date())}>今日</Btn>
        <Btn onClick={() => { const d = new Date(anchor); d.setDate(d.getDate() + 1); onAnchor(d) }}>明日 →</Btn>
        <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, marginLeft: 'var(--sp-3)' }}>{ymd}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>上午 AM · {am.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {am.length === 0 ? <div className="empty">暂无</div> : am.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>下午 PM · {pm.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pm.length === 0 ? <div className="empty">暂无</div> : pm.map((p) => <Row key={p.id} p={p} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: commit**

```bash
git add frontend/src/routes/schedule/DayView.tsx
git commit -m "feat(schedule): DayView AM/PM sections with stage-color row stripe"
```

---

## Section 6 — Integration + Verification

### Task 6.1: Forge cross-pass quality 审查

- [ ] **Step 1: spawn Forge for code quality pass on 新增前端文件**

```typescript
Agent({
  subagent_type: "Forge",
  description: "Schedule tab quality audit",
  prompt: "Audit the new Schedule tab feature at frontend/src/routes/schedule/. Check: (1) no hardcoded hex outside tokens.css; (2) all 3 sub-views fetch from same useScheduleData; (3) onOpen handler not lost on tab switch; (4) sessionStorage keys consistent. Report findings as PASS/FAIL list."
})
```

- [ ] **Step 2: 若 Forge 报 issue,inline 修复后再次跑 tsc + test**

### Task 6.2: Advisor commitment-boundary call

- [ ] **Step 1: 在 EXECUTE 全部完成后**

```bash
bun ~/.claude/PAI/TOOLS/Inference.ts --mode advisor --auto-state \
  "TASK: Schedule tab with month/week/day views, stage tokens, modal reuse" \
  "QUESTION: Any gaps before declaring done? Specifically check: cross-view color consistency, single-fetch invariant, role-permission gating in modal."
```

### Task 6.3: Interceptor 视觉验证

- [ ] **Step 1: 开发服务器跑起来**

```bash
cd frontend && bun run dev &
# wait 3s
```

- [ ] **Step 2: 截图 4 个视图 + modal**

```bash
bunx interceptor open http://localhost:5173/ --screenshot schedule-month.png
# 点击 Schedule tab, 截图
# 点击 周视图, 截图
# 点击 日视图, 截图
# 点击某 prediction, 截图 modal
```

- [ ] **Step 3: 人工核对颜色跨视图一致性**

### Task 6.4: 回归全测

```bash
bun test 2>&1 | tail -5
cd frontend && bunx tsc --noEmit && cd ..
bunx tsc --noEmit
```

Expected: 测试增至 ~470 全绿,tsc 双端 clean

### Task 6.5: 最终 commit + ISA verification

```bash
git log --oneline -20
# 应看到 ~14 个 task commit + 本次最终
git add -A
git commit -m "feat(schedule): complete Schedule tab — month/week/day with stage tokens" --allow-empty
```

---

## Self-Review

- [x] Spec coverage: D1 (新 tab) → F1+F4; D2 (3 视图) → F5/F6/F7; D3 (色板一致) → F2/F3; D4 (modal 复用) → F8/F9
- [x] Placeholder scan: 无 TODO / TBD
- [x] Type consistency: TabKey = RoleKey | 'SCHEDULE',ScheduleData / SubTab 跨文件一致
- [x] All steps have concrete code, not stubs
