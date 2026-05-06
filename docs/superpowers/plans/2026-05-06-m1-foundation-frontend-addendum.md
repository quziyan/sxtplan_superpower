# m1 Foundation — Frontend Prototype Alignment Addendum

> **Supersedes:** [`2026-05-05-m1-foundation.md`](./2026-05-05-m1-foundation.md) **§7 Frontend Scaffold**(Tasks 20–24)
> **Reason:** 用户提供了 Claude Design 原型(`./sxt-superpower-claudedesign/`),后续前端实现按此原型延续。原 §7 的 Tailwind + 简单 RoleSwitcher 方案与原型(纯 CSS + 设计 tokens + 富 role tabs)不兼容,本 addendum 重写。
> **Unchanged:** 后端 §1–§6(数据模型已与原型 `data.js` 完美对齐)、§8 整合验证(替换前端 task 引用即可)。

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans。Steps 用 `- [ ]` 跟踪。

---

## 1. 原型资产清单

```
sxt-superpower-claudedesign/project/
├── index.html              247 行  — 顶层 App + 路由 + topbar + 模态框管理
├── styles.css              627 行  — 完整设计 tokens + 组件 class
├── data.js                 318 行  — Slice 0 占位 + 完整数据形态(可作 m2/m3 mock)
├── components.jsx          151 行  — Icon(50+ paths) / ConfBar / Status / SourceMix /
│                                     Card / PageHeader / Tag / periodLabel / formatK
├── view-analyst.jsx        215 行  — B 角色:sidebar(监视清单/任务卡/区域)+ KPI + 表
├── view-decision-reviewer.jsx 678 行 — A 角色:Inbox 卡 + 一键批/驳;D 角色:复盘报告 + 二轴矩阵 + patterns + 案例库
├── view-prediction-detail.jsx 770 行 — 详情滑入面板:置信度时间线 + 证据链 + 调度信息 + 复盘
├── view-new-task.jsx       725 行  — 新建任务卡 modal
└── tweaks-panel.jsx        568 行  — 调试面板(主色/密度/CI 显示等)
```

**与设计稿(`docs/superpowers/specs/...`)的对齐验证:**
- ✓ `data.js` 中 prediction 字段(`confidence/ci/status/source/sourcesMix/lastFullAt/driftPp/...`)= 设计稿 §2.2 + §3.1
- ✓ `data.js` 中 retrospective 二轴(`predictionOutcome × captureOutcome`)+ dim_scores + composite = 设计稿 §4.1
- ✓ `data.js` 中 confidenceTimeline `kind ∈ {INCR, FULL, MANUAL}` = 设计稿 §3.1
- ✓ `data.js` 中 region `kind ∈ {ADMIN_NAMED, AD_HOC}` + version + adminChain = 设计稿 §2.4 + Plan-A Task 7
- ✓ `index.html` 中 ROLES 定义 = 设计稿 §2.1(A/B/D + E 混合岗)
- ✓ `data.js` 顶部注释 "Slice 0 placeholders: V=应急救援车, T=抢险救援, R=广东沿海" = 设计稿 §1.5

**结论:原型设计与设计稿语义无冲突,可以直接作为前端实现基线。**

---

## 2. m1/m2/m3 三阶段拆分(原型组件维度)

| 原型资产 | m1(本计划) | m2 Plan-B(预测核心) | m3 Plan-C(真端到端) |
|---|---|---|---|
| `styles.css` 全套 tokens | ✅ 全量移植 | — | — |
| Layout shell(`.app`/`.app__body`) | ✅ | — | — |
| Topbar + role tabs + user-pill | ✅ 完整 | — | — |
| Icon 组件(50+ paths) | ✅ 全量移植 | — | — |
| Btn / Tag / Card / PageHeader / Tabs | ✅ 移植 | — | — |
| Status pill | ✅ 移植(显示用,m1 无数据) | 接 prediction.status | — |
| ConfBar | ⏸️ skeleton + tests,但**无数据** | ✅ 接 prediction.confidence | — |
| SourceMix | ⏸️ skeleton | ✅ 接 prediction.sourcesMix | — |
| KPI / Table / InboxCard / EvidenceRow | — | ✅ AnalystView + DecisionView | — |
| ConfidenceTimeline 图(自定义 SVG) | — | ✅ PredictionDetail 内 | — |
| Outcome Matrix(二轴 3×4) | — | — | ✅ ReviewerView |
| Pattern heatmap | — | — | ✅ ReviewerView |
| MapStub / 高德实组件 | ✅ 占位 + lazy load | ✅ Region polygon 框选 | — |
| DetailPane skeleton(滑入动画) | ✅ skeleton | ✅ PredictionDetail 接入 | ✅ Retrospective 接入 |
| NewTaskCard modal | — | ✅ AnalystView 入口 | — |
| Tweaks panel | — | — | 可选(开发态) |

**m1 前端 = 完整视觉外壳 + 三视图占位骨架 + 全部 tokens。** m2/m3 在这个外壳上**只填内容,不重构布局**。

---

## 3. Frontend Tech Stack(替代 Plan-A §7)

| 维度 | 选型 | 替换说明 |
|---|---|---|
| 框架 | Vite + React 18 + TS | ✓ 不变 |
| 样式 | **纯 CSS + 原型 tokens**,**不用 Tailwind** | ❌ 原 Plan-A 选了 Tailwind,撤掉 |
| 图标 | 内联 SVG,从原型 components.jsx 移植 Icon | 不引入 lucide/heroicons |
| 状态 | useState / useEffect(m1 不上 zustand/jotai) | 同 |
| 路由 | 简单 useState 路由(role-state 驱动 + 模态框 boolean) | 同 |
| 地图 | `@amap/amap-jsapi-loader` lazy 加载 + `.map-stub` fallback | ✓ 不变 |
| 构建 | `bun --cwd frontend` | ✓ 不变 |

---

## 4. New File Structure(替代 Plan-A §7 中的 frontend 树)

```
frontend/
├── package.json              (调整:删除 tailwind/postcss/autoprefixer,加 @amap/amap-jsapi-loader 已有)
├── vite.config.ts            (不变)
├── tsconfig.json             (不变)
├── index.html                (不变)
├── .env.example              (不变,VITE_AMAP_API_KEY)
└── src/
    ├── main.tsx              (不变)
    ├── App.tsx               (重写:Topbar + role-state 路由 + DetailPane slot)
    │
    ├── styles/
    │   ├── tokens.css        ⭐ 从原型 styles.css 提取 :root + .theme-light 块
    │   ├── globals.css       ⭐ 从原型 styles.css 提取 reset + body + scrollbar
    │   └── components.css    ⭐ 从原型 styles.css 提取所有 .btn/.card/.table/.kpi 等 class
    │
    ├── components/
    │   ├── Icon.tsx          ⭐ 从原型 components.jsx 移植(50+ paths,改 TS)
    │   ├── Btn.tsx           ⭐ 移植 .btn + 变体
    │   ├── IconBtn.tsx       ⭐ 新:topbar 用的方形图标按钮
    │   ├── Tag.tsx           ⭐ 移植
    │   ├── Card.tsx          ⭐ 移植(title/sub/action/children)
    │   ├── PageHeader.tsx    ⭐ 移植(title/sub/breadcrumbs/actions)
    │   ├── Status.tsx        ⭐ 移植
    │   ├── Tabs.tsx          ⭐ 移植 .tabs
    │   ├── DetailPane.tsx    ⭐ 新:.detail-pane 骨架,empty content slot
    │   ├── MapView.tsx       (重写:用 .map-stub fallback,不用 Tailwind)
    │   └── topbar/
    │       ├── Topbar.tsx    ⭐ 新:整个 .topbar 容器
    │       ├── Brand.tsx     ⭐ 新:logo + title + sub
    │       ├── RoleTabs.tsx  ⭐ 新:富 role tabs(图标 + label + sub)
    │       └── UserPill.tsx  ⭐ 新:头像 + 名字 + 当前角色
    │
    ├── lib/
    │   ├── api.ts            (不变,§7 Task 21 内容)
    │   ├── auth.ts           (不变,§7 Task 21 内容)
    │   └── useAuth.ts        ⭐ 新:hook 封装 me + role-state switch
    │
    ├── routes/
    │   ├── Login.tsx         (重写:用 Card + Btn 原型样式)
    │   ├── analyst/
    │   │   └── AnalystView.tsx     ⭐ 占位:sidebar 框架 + workspace + "m2 实现" empty
    │   ├── decision/
    │   │   └── DecisionView.tsx    ⭐ 占位:workspace + inbox empty state
    │   └── reviewer/
    │       └── ReviewerView.tsx    ⭐ 占位:workspace + tabs + empty
    │
    └── types/
        └── prototype.ts      ⭐ 新:从 data.js 抽出的 TS 类型(Region/Prediction/Retrospective/...),m2 用
```

⭐ = 本 addendum 新增/重写。其余沿用 Plan-A 原 §7。

---

## 5. Tasks(替代 Plan-A Tasks 20–24)

> 编号沿用 20–28(扩展了 4 个):**20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28**(原 25–28 的 admin seed / README / smoke / acceptance 不动)。

### Task 20': Frontend init(Vite + React + TS,**不带 Tailwind**)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`(临时占位)
- Create: `frontend/.gitignore`
- Create: `frontend/.env.example`

- [ ] **Step 1: `frontend/package.json`(无 tailwind/postcss/autoprefixer)**

```json
{
  "name": "cnp-frontend",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@amap/amap-jsapi-loader": "^1.0.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: `frontend/vite.config.ts`** — 与 Plan-A Task 20 同(`/api` 代理到 `:3000`)

- [ ] **Step 3: `frontend/tsconfig.json`** — 与 Plan-A Task 20 同(strict, paths `@/*`)

- [ ] **Step 4: `frontend/index.html`** — 设置 `<html lang="zh-CN" data-theme="dark">` 默认深色

```html
<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CNP · 新闻驱动决策预测</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 临时 `frontend/src/App.tsx`**(后面 Task 23 重写)

```tsx
export default function App() {
  return <div>booting...</div>
}
```

- [ ] **Step 6: `frontend/src/main.tsx`** — 引入 styles(占位,Task 21 创建)

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
```

- [ ] **Step 7: `.env.example`**

```
VITE_AMAP_API_KEY=
```

- [ ] **Step 8: 安装 + 启动验证**

```bash
cd frontend && bun install && bun run dev
# 访问 :5173 应见 "booting..."
```

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): vite + react + ts scaffold (no tailwind, prototype-aligned)"
```

---

### Task 21': 移植设计 tokens + globals + components.css

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/globals.css`
- Create: `frontend/src/styles/components.css`

**做法:** 把原型 `sxt-superpower-claudedesign/project/styles.css` 拆三段。

- [ ] **Step 1: `frontend/src/styles/tokens.css`**

从原型 styles.css 复制 `:root { ... }`(行 3–54)和 `.theme-light { ... }`(行 56–80)。**原样保留 var 名,后续业务代码全引用这套**。

```css
:root {
  /* Brand: 政务沉稳蓝灰 */
  --c-bg: #0e131a;
  --c-bg-1: #131a23;
  /* ... 完整复制原型 :root 块 ... */
  --shadow-2: 0 1px 0 rgba(255,255,255,0.04), 0 18px 40px -16px rgba(0,0,0,0.7);
}

[data-theme="light"] {
  /* 完整复制原型 .theme-light 块,改成 [data-theme="light"] selector */
}
```

- [ ] **Step 2: `frontend/src/styles/globals.css`**

```css
@import './tokens.css';
@import './components.css';

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: var(--ff-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--c-text);
  background: var(--c-bg);
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "tnum" 1, "ss01" 1;
}

button { font-family: inherit; cursor: pointer; border: 0; background: transparent; color: inherit; }
input, select, textarea { font-family: inherit; font-size: inherit; }
::selection { background: var(--c-accent-soft); color: var(--c-text); }

@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--c-line); border-radius: 6px; border: 2px solid var(--c-bg); }
::-webkit-scrollbar-thumb:hover { background: var(--c-line-strong); }

[data-density="compact"] .table th,
[data-density="compact"] .table td { padding: 6px var(--sp-4); }
[data-density="compact"] .inbox-card { padding: var(--sp-4); }
[data-density="compact"] .kpi { padding: var(--sp-3); }
```

- [ ] **Step 3: `frontend/src/styles/components.css`**

把原型 styles.css 行 100–627(所有 `.btn` / `.card` / `.table` / `.kpi` / `.tag` / `.status` / `.cbar` / `.matrix` / `.smix` / `.ctl` / `.inbox-card` / `.evidence-row` / `.detail-pane` / `.tabs` / `.app` / `.topbar` / `.role-tab` / `.iconbtn` / `.user-pill` / `.sidebar` / `.workspace` / `.map-stub` / `.section-h` / `.split` 等)**原样复制**。

```bash
# 复制方式建议:
cp /Users/quzhi/Desktop/排班系统设计-superpowers/sxt-superpower-claudedesign/project/styles.css \
   /tmp/proto-styles.css
# 然后手工拆分:
#   行 3-80   → tokens.css(:root + .theme-light)
#   行 82-101 → globals.css(reset + body + 滚动条)
#   行 102-627 → components.css(所有具名 class)
```

- [ ] **Step 4: 视觉验证**

修改 `frontend/src/App.tsx` 临时:
```tsx
export default function App() {
  return (
    <div className="app">
      <div className="topbar">CNP · 新闻驱动决策预测</div>
      <div className="app__body" style={{ padding: 'var(--sp-5)' }}>
        <div className="card">
          <div className="card__header">
            <div className="card__title">tokens 验证</div>
          </div>
          <div className="card__body">
            <button className="btn btn--primary">Primary</button>
            <button className="btn btn--ghost">Ghost</button>
            <span className="tag tag--accent">accent</span>
            <span className="status status--proposed">PROPOSED</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

启动 `bun run dev`,访问 :5173 → 应该看到深色主题 + 政务蓝按钮 + 标签 + status pill 全部就位(和原型一致)。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/
git commit -m "feat(frontend): port design tokens + globals + components.css from prototype"
```

---

### Task 22': 移植 Icon 组件 + UI 原子组件

**Files:**
- Create: `frontend/src/components/Icon.tsx`
- Create: `frontend/src/components/Btn.tsx`
- Create: `frontend/src/components/IconBtn.tsx`
- Create: `frontend/src/components/Tag.tsx`
- Create: `frontend/src/components/Card.tsx`
- Create: `frontend/src/components/PageHeader.tsx`
- Create: `frontend/src/components/Status.tsx`
- Create: `frontend/src/components/Tabs.tsx`

- [ ] **Step 1: `frontend/src/components/Icon.tsx`**(从原型 components.jsx Icon 移植,改 TS)

```tsx
import type { CSSProperties } from 'react'

export type IconName =
  | 'inbox' | 'eye' | 'chart' | 'book' | 'map' | 'settings' | 'plus' | 'search'
  | 'check' | 'x' | 'chevronRight' | 'chevronDown' | 'arrowRight' | 'arrowUpRight'
  | 'clock' | 'file' | 'link' | 'layers' | 'flag' | 'cam' | 'upload' | 'edit'
  | 'refresh' | 'bell' | 'history' | 'info' | 'alertTri' | 'list' | 'grid'
  | 'target' | 'play' | 'pause' | 'stop' | 'trend' | 'zap' | 'user' | 'pin'
  | 'polygon' | 'filter' | 'download' | 'moreH' | 'expand' | 'shield'

const PATHS: Record<IconName, JSX.Element> = {
  inbox: <><path d="M3 12l3-9h12l3 9M3 12v8h18v-8M3 12h5l1 2h6l1-2h5"/></>,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></>,
  // ... 完整复制原型 components.jsx 中 paths 对象的所有 50+ 条 ...
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
}

export function Icon({ name, size = 14, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`i-svg ${className}`} width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {PATHS[name]}
    </svg>
  )
}
```

> **完整 PATHS 来自原型** `sxt-superpower-claudedesign/project/components.jsx` 行 4–49。50+ 条,直接复制。

- [ ] **Step 2: `frontend/src/components/Btn.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'primary' | 'ghost' | 'danger' | 'ok'
type Size = 'sm' | 'md' | 'lg'

export function Btn({ variant = 'default', size = 'md', children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
  const cls = [
    'btn',
    variant !== 'default' && `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    className,
  ].filter(Boolean).join(' ')
  return <button className={cls} {...rest}>{children}</button>
}
```

- [ ] **Step 3: `frontend/src/components/IconBtn.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export function IconBtn({ icon, dot, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; dot?: boolean }) {
  return (
    <button className="iconbtn" {...rest}>
      <Icon name={icon} size={14} />
      {dot && <span className="iconbtn__dot" />}
    </button>
  )
}
```

- [ ] **Step 4: `frontend/src/components/Tag.tsx`**

```tsx
import type { ReactNode } from 'react'

type TagKind = 'default' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'ghost'

export function Tag({ children, kind = 'default' }: { children: ReactNode; kind?: TagKind }) {
  return <span className={`tag${kind !== 'default' ? ` tag--${kind}` : ''}`}>{children}</span>
}
```

- [ ] **Step 5: `frontend/src/components/Card.tsx`**

```tsx
import type { ReactNode } from 'react'

export function Card({ title, sub, action, children }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="card__header">
          <div>
            {title && <div className="card__title">{title}</div>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className="card__body">{children}</div>
    </div>
  )
}
```

- [ ] **Step 6: `frontend/src/components/PageHeader.tsx`**

```tsx
import type { ReactNode } from 'react'

export function PageHeader({ title, sub, actions, breadcrumbs }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode[]
}) {
  return (
    <div className="workspace__header">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 4 }}>
            {breadcrumbs.map((b, i) => (
              <span key={i}>{i > 0 && <span style={{ margin: '0 6px' }}>/</span>}{b}</span>
            ))}
          </div>
        )}
        <div className="workspace__title">{title}</div>
        {sub && <div className="workspace__sub">{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  )
}
```

- [ ] **Step 7: `frontend/src/components/Status.tsx`**

```tsx
export type PredictionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'COMPLETED' | 'EXPIRED'

const LABELS: Record<PredictionStatus, string> = {
  PROPOSED: '待批', APPROVED: '已批准', REJECTED: '已驳回',
  DISPATCHED: '已调度', COMPLETED: '已完成', EXPIRED: '已过期',
}

export function Status({ value }: { value: PredictionStatus }) {
  return <span className={`status status--${value.toLowerCase()}`}>{LABELS[value]}</span>
}
```

- [ ] **Step 8: `frontend/src/components/Tabs.tsx`**

```tsx
import type { ReactNode } from 'react'

export function Tabs<K extends string>({ active, onChange, items }: {
  active: K; onChange: (k: K) => void; items: { key: K; label: ReactNode }[]
}) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button key={it.key} className={`tabs__btn${active === it.key ? ' active' : ''}`} onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 9: 视觉验证 — 在 App.tsx 暂时显示一组**

```tsx
import { Btn, Tag, Card, Status, Icon } from './components'  // 通过 index.ts 聚合 export
// 渲染所有变体,目测和原型一致
```

(`frontend/src/components/index.ts` 加上 `export * from './Btn'` etc.)

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): port Icon + Btn/IconBtn/Tag/Card/PageHeader/Status/Tabs primitives"
```

---

### Task 23': Layout shell + Topbar(brand + role tabs + actions + user-pill)

**Files:**
- Create: `frontend/src/components/topbar/Brand.tsx`
- Create: `frontend/src/components/topbar/RoleTabs.tsx`
- Create: `frontend/src/components/topbar/UserPill.tsx`
- Create: `frontend/src/components/topbar/Topbar.tsx`
- Create: `frontend/src/components/topbar/index.ts`

- [ ] **Step 1: `Brand.tsx`** — logo SVG + title + sub

```tsx
export function Brand({ version = 'v0.4.2' }: { version?: string }) {
  return (
    <div className="topbar__brand">
      <div className="topbar__logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="var(--c-accent)" opacity="0.12" />
          <path d="M6 16 L10 9 L13 13 L18 6" stroke="var(--c-accent)" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="18" cy="6" r="1.6" fill="var(--c-accent)" />
        </svg>
      </div>
      <div>
        <div className="topbar__title">
          CNP <span style={{ color: 'var(--c-text-3)', fontWeight: 400 }}>· 新闻驱动决策预测</span>
        </div>
        <div className="topbar__sub">{version} · {new Date().toLocaleDateString('zh-CN')}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `RoleTabs.tsx`** — 富 role tabs(图标 + label + sub)

```tsx
import { Icon, type IconName } from '../Icon'

export type RoleKey = 'ANALYST' | 'DECIDER' | 'REVIEWER'

export type RoleDef = { key: RoleKey; label: string; sub: string; icon: IconName }

export const DEFAULT_ROLES: RoleDef[] = [
  { key: 'ANALYST',  label: '分析师', sub: '监视 + 推送',     icon: 'eye' },
  { key: 'DECIDER',  label: '决策者', sub: '审批调度',         icon: 'check' },
  { key: 'REVIEWER', label: '复盘师', sub: '校准 + 沉淀',       icon: 'book' },
]

export function RoleTabs({ active, available, onChange }: {
  active: RoleKey | null
  available: RoleKey[]
  onChange: (k: RoleKey) => void
}) {
  return (
    <div className="topbar__roles">
      {DEFAULT_ROLES.filter((r) => available.includes(r.key)).map((r) => (
        <button key={r.key}
          className={`role-tab${active === r.key ? ' active' : ''}`}
          onClick={() => onChange(r.key)}>
          <Icon name={r.icon} size={13} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{r.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', lineHeight: 1.2 }}>{r.sub}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: `UserPill.tsx`**

```tsx
import { DEFAULT_ROLES, type RoleKey } from './RoleTabs'

export function UserPill({ displayName, email, activeRole }: {
  displayName: string | null; email: string; activeRole: RoleKey | null
}) {
  const roleDef = DEFAULT_ROLES.find((r) => r.key === activeRole)
  const accent = activeRole === 'DECIDER' ? 'var(--c-warn)'
              : activeRole === 'REVIEWER' ? 'var(--c-info)'
              : 'var(--c-accent)'
  return (
    <div className="user-pill">
      <span className="user-pill__avatar" style={{ background: accent }}>
        {(displayName ?? email)[0].toUpperCase()}
      </span>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 500 }}>{displayName ?? email}</div>
        <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{roleDef ? `${roleDef.label}态` : '未选角色'}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `Topbar.tsx`** — 整合

```tsx
import { IconBtn } from '../IconBtn'
import { Brand } from './Brand'
import { RoleTabs, type RoleKey } from './RoleTabs'
import { UserPill } from './UserPill'

export function Topbar({ user, activeRole, availableRoles, onRoleChange, onLogout }: {
  user: { displayName: string | null; email: string }
  activeRole: RoleKey | null
  availableRoles: RoleKey[]
  onRoleChange: (k: RoleKey) => void
  onLogout: () => void
}) {
  return (
    <header className="topbar">
      <Brand />
      <RoleTabs active={activeRole} available={availableRoles} onChange={onRoleChange} />
      <div className="topbar__actions">
        <IconBtn icon="search" title="搜索 ⌘K" />
        <IconBtn icon="bell" title="通知" dot />
        <IconBtn icon="info" title="模式信息" />
        <UserPill displayName={user.displayName} email={user.email} activeRole={activeRole} />
        <IconBtn icon="x" title="登出" onClick={onLogout} />
      </div>
    </header>
  )
}
```

- [ ] **Step 5: `topbar/index.ts`**

```ts
export * from './Brand'
export * from './RoleTabs'
export * from './UserPill'
export * from './Topbar'
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/topbar/
git commit -m "feat(frontend): topbar with brand + rich role tabs + actions + user pill"
```

---

### Task 24': API client + auth state hook(替代 Plan-A Task 21,基本不变)

**Files:**
- Create: `frontend/src/lib/api.ts`(同 Plan-A Task 21 Step 1)
- Create: `frontend/src/lib/auth.ts`(同 Plan-A Task 21 Step 2)
- Create: `frontend/src/lib/useAuth.ts` ⭐ 新增

- [ ] **Step 1: `api.ts` 和 `auth.ts`** — 完整复制 Plan-A Task 21 内容,**不变**(函数签名、字段名都和后端一致)。

- [ ] **Step 2: 新增 `frontend/src/lib/useAuth.ts`** — hook 形式

```tsx
import { useCallback, useEffect, useState } from 'react'
import { type AuthMe, getMe, logout, setRoleState } from './auth'
import type { RoleKey } from '../components/topbar/RoleTabs'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authed'; me: AuthMe }

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    const me = await getMe()
    setState(me ? { status: 'authed', me } : { status: 'anonymous' })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const switchRole = useCallback(async (k: RoleKey | null) => {
    await setRoleState(k as AuthMe['activeRoleKey'])
    await refresh()
  }, [refresh])

  const doLogout = useCallback(async () => {
    await logout()
    await refresh()
  }, [refresh])

  return { state, refresh, switchRole, logout: doLogout }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat(frontend): api + auth + useAuth hook"
```

---

### Task 25': Login page(用原型 Card + Btn 样式)

**Files:**
- Create: `frontend/src/routes/Login.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useState, type FormEvent } from 'react'
import { Btn } from '../components/Btn'
import { Card } from '../components/Card'
import { login } from '../lib/auth'

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setLoading(true)
    try { await login(email, password); onLoggedIn() }
    catch (e: any) { setErr(e.message ?? '登录失败') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c-bg)' }}>
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--sp-5)' }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>CNP · 新闻驱动决策预测</div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-3)', marginTop: 4 }}>登录后选择你的角色态</div>
        </div>
        <Card>
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <label style={{ fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>邮箱</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              style={inputStyle()} autoComplete="email" autoFocus />
            <label style={{ fontSize: 11, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              style={inputStyle()} autoComplete="current-password" />
            {err && <div style={{ color: 'var(--c-bad)', fontSize: 12 }}>{err}</div>}
            <Btn variant="primary" disabled={loading} style={{ marginTop: 'var(--sp-2)', justifyContent: 'center' }}>
              {loading ? '登录中…' : '登录'}
            </Btn>
          </form>
        </Card>
      </div>
    </div>
  )
}

function inputStyle(): React.CSSProperties {
  return {
    background: 'var(--c-bg-1)', color: 'var(--c-text)',
    border: '1px solid var(--c-line)', borderRadius: 'var(--rad-2)',
    padding: '8px 10px', fontSize: 13, outline: 'none',
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/routes/Login.tsx
git commit -m "feat(frontend): login page using Card + Btn primitives"
```

---

### Task 26': 三视图占位骨架(原型布局结构)

**Files:**
- Create: `frontend/src/routes/analyst/AnalystView.tsx`
- Create: `frontend/src/routes/decision/DecisionView.tsx`
- Create: `frontend/src/routes/reviewer/ReviewerView.tsx`

- [ ] **Step 1: `AnalystView.tsx`** — sidebar + workspace 骨架

```tsx
import { Btn } from '../../components/Btn'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'

export function AnalystView() {
  return (
    <div className="page">
      <aside className="sidebar">
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>监视清单</span>
            <button title="新建监视清单"><Icon name="plus" size={12} /></button>
          </div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(m2 实现:监视清单 CRUD)</div>
        </div>
        <div className="sidebar__group">
          <div className="sidebar__heading">
            <span>任务卡(即时查询)</span>
            <button title="新建任务卡" disabled><Icon name="plus" size={12} /></button>
          </div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(m2 实现)</div>
        </div>
        <div className="sidebar__group">
          <div className="sidebar__heading">区域</div>
          <div className="empty" style={{ padding: 'var(--sp-4) 0' }}>(已具备 API,UI 列表 m2 实现)</div>
        </div>
      </aside>

      <main className="workspace">
        <PageHeader
          title="分析师工作台"
          sub="监视新闻信号 → 审证据 → 调置信度 → 推送给决策者"
          actions={<>
            <Btn disabled><Icon name="refresh" size={12} />立即重算</Btn>
            <Btn variant="primary" disabled><Icon name="plus" size={12} />新建任务卡</Btn>
          </>}
        />
        <div className="workspace__body">
          <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>m1 视觉外壳就绪</div>
            <div>预测列表 / KPI / 监视清单交互在 m2(Plan-B)实装。</div>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: `DecisionView.tsx`** — workspace + Inbox empty

```tsx
import { PageHeader } from '../../components/PageHeader'

export function DecisionView() {
  return (
    <main className="workspace">
      <PageHeader title="决策者工作台" sub="批 / 驳 / 撤单 — 一键审批" />
      <div className="workspace__body">
        <div className="empty" style={{ marginTop: 'var(--sp-7)' }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>📥 待批预测 Inbox(m2 实现)</div>
          <div>每条预测带置信度 + 一句话理由 + 一键批/驳。</div>
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: `ReviewerView.tsx`** — workspace + tabs empty

```tsx
import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { Tabs } from '../../components/Tabs'

export function ReviewerView() {
  const [tab, setTab] = useState<'reports' | 'matrix' | 'cases' | 'patterns'>('reports')
  return (
    <main className="workspace">
      <PageHeader title="复盘师工作台" sub="单条复盘 → 二轴矩阵 → 规律 → 案例库" />
      <div className="workspace__body">
        <Tabs active={tab} onChange={setTab} items={[
          { key: 'reports', label: '复盘报告' },
          { key: 'matrix', label: '二轴矩阵' },
          { key: 'patterns', label: '规律' },
          { key: 'cases', label: '案例库' },
        ]} />
        <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
          (m3 Plan-C 实装具体内容)
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/
git commit -m "feat(frontend): three role view stubs (Analyst/Decision/Reviewer) with prototype layout"
```

---

### Task 27': MapView placeholder(原型 .map-stub fallback)

**Files:**
- Create: `frontend/src/components/MapView.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, useRef } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

const AMAP_KEY = import.meta.env.VITE_AMAP_API_KEY ?? ''

export function MapView({ height = 280 }: { height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!AMAP_KEY || !ref.current) return
    let cancelled = false
    AMapLoader.load({ key: AMAP_KEY, version: '2.0', plugins: [] })
      .then((AMap: any) => {
        if (cancelled || !ref.current) return
        mapRef.current = new AMap.Map(ref.current, { zoom: 10, center: [113.27, 23.13] })
      }).catch((e) => console.error('amap load failed', e))
    return () => { cancelled = true; mapRef.current?.destroy() }
  }, [])

  if (!AMAP_KEY) {
    return (
      <div className="map-stub" style={{ height }}>
        <div className="map-stub__grid" />
        <div className="map-stub__attribution">地图占位 · 配置 VITE_AMAP_API_KEY 后启用</div>
      </div>
    )
  }
  return <div ref={ref} style={{ height }} className="map-stub" />
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MapView.tsx
git commit -m "feat(frontend): MapView with .map-stub fallback + 高德 lazy load"
```

---

### Task 28': DetailPane skeleton(滑入面板基础设施)

**Files:**
- Create: `frontend/src/components/DetailPane.tsx`

- [ ] **Step 1: 实现**

```tsx
import { useEffect, type ReactNode } from 'react'
import { IconBtn } from './IconBtn'

export function DetailPane({ open, onClose, title, sub, children }: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  sub?: ReactNode
  children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="detail-pane" onClick={onClose}>
      <div className="detail-pane__panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 'var(--sp-5) var(--sp-6) var(--sp-3)', borderBottom: '1px solid var(--c-line)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {title && <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>}
            {sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-3)', marginTop: 4 }}>{sub}</div>}
          </div>
          <IconBtn icon="x" onClick={onClose} />
        </div>
        <div style={{ padding: 'var(--sp-5) var(--sp-6)', overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/DetailPane.tsx
git commit -m "feat(frontend): DetailPane skeleton with slide-in + ESC + click-outside"
```

---

### Task 29': App 整合 — Topbar + role 路由 + DetailPane slot

**Files:**
- Modify: `frontend/src/App.tsx:1`(整体重写)

- [ ] **Step 1: 实现**

```tsx
import { Login } from './routes/Login'
import { AnalystView } from './routes/analyst/AnalystView'
import { DecisionView } from './routes/decision/DecisionView'
import { ReviewerView } from './routes/reviewer/ReviewerView'
import { Topbar } from './components/topbar/Topbar'
import type { RoleKey } from './components/topbar/RoleTabs'
import { useAuth } from './lib/useAuth'

export default function App() {
  const { state, refresh, switchRole, logout } = useAuth()

  if (state.status === 'loading') {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--c-text-3)' }}>加载中…</div>
  }
  if (state.status === 'anonymous') return <Login onLoggedIn={refresh} />

  const { me } = state
  const role = me.activeRoleKey as RoleKey | null

  return (
    <div className="app">
      <Topbar
        user={me.user}
        activeRole={role}
        availableRoles={me.availableRoles as RoleKey[]}
        onRoleChange={switchRole}
        onLogout={logout}
      />
      <div className="app__body">
        {role === 'ANALYST'  && <AnalystView />}
        {role === 'DECIDER'  && <DecisionView />}
        {role === 'REVIEWER' && <ReviewerView />}
        {!role && (
          <div className="empty" style={{ marginTop: 'var(--sp-8)' }}>
            请在顶部选择一个角色态。可用角色:{me.availableRoles.join(', ') || '无'}。
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 整体手动验收(端到端)**

1. `bun run dev`(后端) + `cd frontend && bun run dev`(前端)
2. 访问 :5173 → 登录页(深色 + Card 样式)
3. 登录 admin/admin1234 → 顶部出现 Brand + 三个 role tabs + 通知按钮 + UserPill
4. 切到分析师 → sidebar(三组占位)+ workspace(两按钮 disabled + empty state)
5. 切到决策者 → 简洁 workspace + Inbox 占位
6. 切到复盘师 → 4 tabs + empty
7. 登出 → 回到登录页

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): App integration — topbar + role routing + auth gate"
```

---

## 6. 对 Plan-A 其他章节的影响

| Plan-A 节 | 是否变 | 说明 |
|---|---|---|
| §1–§6(Repo / DB Schemas / Auth / Region / Taxonomy / WebApp Server) | ❌ 不变 | 后端实现完全不受原型影响 |
| §7 Frontend Scaffold(Tasks 20–24) | **被本 addendum 替代为 Tasks 20'–29'** | 5 任务变 10 任务,预计前端工程量从 ~20 步增到 ~50 步 |
| §8 Section 8 — Bootstrap Data + Integration | 仅引用更新 | Task 25 admin seed 不变;Task 26 README 增一段"前端按 prototype 风格";Task 27 smoke 不变(API 不变);Task 28 验收清单加 1 条"视觉外壳与 prototype 对齐" |

**新增验收标准(并入 Plan-A Task 28 acceptance):**
- [ ] **ISC-A1**:`frontend/src/styles/tokens.css` 与原型 `styles.css` :root 块**逐字段一致**(可 diff 验证)
- [ ] **ISC-A2**:Topbar 渲染后视觉与原型 index.html 渲染等价(brand + role tabs + actions + user-pill 五大块齐全)
- [ ] **ISC-A3**:三视图均使用 `.page` / `.sidebar` / `.workspace` / `.workspace__header` / `.workspace__body` / `.empty` class,m2 可直接填内容
- [ ] **ISC-A4**:Icon 组件至少 30 个 path 已移植(实际 50+);Btn 五变体齐全;Status pill 6 状态齐全

---

## 7. m2 / m3 前向参考(给 Plan-B / Plan-C 起手)

**写 Plan-B 时直接复用原型的:**
- `view-analyst.jsx`(215 行)→ AnalystView 内容(KPI / 表格 / 过滤)
- `view-decision-reviewer.jsx`(678 行,decision 部分)→ DecisionView 的 InboxCard
- `view-prediction-detail.jsx`(770 行)→ PredictionDetail(置信度时间线 SVG + 证据链)
- `view-new-task.jsx`(725 行)→ NewTaskCard modal
- `data.js` 里 prediction / confidenceTimeline / evidence 字段 → API 响应形态(后端 m2 实现时按此 shape 返回)

**写 Plan-C 时直接复用原型的:**
- `view-decision-reviewer.jsx`(678 行,reviewer 部分)→ ReviewerView 内容(reports / matrix / patterns / cases)
- `data.js` 里 retrospective / patterns / matrixPoints / cases 字段
- `styles.css` 中 `.matrix` / `.heatmap-cell` / `.ctl` class

**这意味着 Plan-B/C 的前端 task 主要是"接 API + 把 prototype 视图落地",而不是设计**——大幅缩短了 m2/m3 前端工时估算。

---

## 8. Self-Review

### Spec / Prototype 覆盖

| 主题 | 在哪 | 备注 |
|---|---|---|
| Token 移植完整性 | Task 21' | 三段切分,无遗漏 class |
| Icon 完整性 | Task 22' Step 1 | 提示需复制全 50+ paths |
| Topbar 与原型视觉对齐 | Task 23' | brand+tabs+actions+pill 全对齐 |
| 三视图骨架可被 m2 直接填内容 | Task 26' | 用了原型 class 而不是自创 |
| DetailPane(m2 接 PredictionDetail) | Task 28' | 滑入 + ESC + click-outside 都到位 |
| MapStub fallback(无 key 时) | Task 27' | `.map-stub` + `.map-stub__grid` 复用 |
| Auth 状态机 | Task 24' useAuth | 三态(loading/anonymous/authed)清晰 |

### Placeholder scan

- ⚠️ Task 22' Step 1 注释 "完整复制原型 components.jsx 中 paths 对象的所有 50+ 条" — **不是占位**,是显式的"拷贝指令";执行者按指令拷贝
- ⚠️ Task 21' Step 3 类似 — `cp` 命令 + 行号切分指令,可执行
- ✅ 无散落 TODO / TBD

### Type consistency

- `RoleKey` 在 `RoleTabs.tsx` 定义,被 `Topbar` / `useAuth` / `App` 一致引用
- `AuthMe.activeRoleKey` 类型用 `string | null`(后端定义为 `'DECIDER' | 'ANALYST' | 'REVIEWER' | null`),前端 `RoleKey` 联合一致
- `PredictionStatus` 在 `Status.tsx` 定义,m2 接入时直接复用

---

## 9. Execution Handoff

**Addendum complete and saved to `docs/superpowers/plans/2026-05-06-m1-foundation-frontend-addendum.md`。** 与 Plan-A 配合使用:**Plan-A §1–§6 + 本 addendum §5 Tasks 20'–29' + Plan-A §8(Tasks 25–28)**。

执行节奏选项与 Plan-A 同:**SUBAGENT-DRIVEN** / **INLINE EXECUTION** / **STOP**(等客户/外部依赖确认再开干)。
