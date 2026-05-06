# 摄像头新闻预测 / 监控调度 / 复盘系统(camera-news-prediction)

> 当前阶段:**m1 Foundation**(应用壳 + 数据库 schema + Auth + 前端骨架)
> 设计稿:`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`
> Plan-A:`docs/superpowers/plans/2026-05-05-m1-foundation.md`(主)+ `2026-05-06-m1-foundation-frontend-addendum.md`(前端覆写)

## 快速启动

### 1. 准备 env

```bash
cp .env.example .env
# 必填:SESSION_SECRET 改成 64 位 hex(可用 `openssl rand -hex 32`)
# 端口冲突:若主机已有 Postgres 占用 5432,改 .env 中 POSTGRES_PORT=5433 + 同步改 DATABASE_URL/DATABASE_ADMIN_URL 端口
# 可选:AMAP_API_KEY(地图组件,无 key 走 .map-stub fallback)、DASHSCOPE_API_KEY(m2 起需要)
```

### 2. 起容器

```bash
docker compose up -d
docker compose ps   # 等到 cnp-postgres / cnp-redis 都 (healthy)
```

### 3. 初始化 DB

```bash
bun install
bun run db:migrate         # 跑 manual SQL(audit schema + cnp_app role)+ drizzle migrations
bun run seed:bootstrap     # 创建 3 个 role + admin@cnp.local / admin1234
# 可选:bun run seed:region <fixture.geojson>  (需要外部行政区划 GeoJSON,m1 阶段不必跑)
```

### 4. 起服务

```bash
# Terminal 1 — 后端
bun run dev              # http://localhost:3000

# Terminal 2 — 前端
cd frontend && bun install && bun run dev   # http://localhost:5173 (代理 /api → :3000)
```

打开 `http://localhost:5173`,登录 `admin@cnp.local` / `admin1234`,选择角色态后看到对应工作台占位骨架。

## 开发命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 后端开发服务(watch) |
| `bun run typecheck` | TS 编译检查 |
| `bun run lint` | biome 检查 |
| `bun run format` | biome 格式化 |
| `bun run test` | 运行所有 bun test |
| `bun run db:generate` | drizzle 根据 schema 产生 migration SQL |
| `bun run db:migrate` | 应用 migration(含 manual SQL) |
| `bun run db:push` | 直接同步 schema 到 DB(开发偷懒用) |
| `bun run seed:bootstrap` | 种 role + admin |
| `bun run seed:region` | 种行政区划(需外部 GeoJSON) |
| `cd frontend && bun run dev` | 前端开发服务 |
| `cd frontend && bun run build` | 前端 production 打包 |

## 项目结构

后端核心:
- `src/db/` — Drizzle ORM(schemas + client + migrate runner)
- `src/auth/` — argon2 + signed cookie + session + middleware + routes
- `src/audit/` — OperationAudit 写入 helper
- `src/modules/region/` — Region service + HTTP routes + seed CLI
- `src/modules/taxonomy/` — V/T 分类 service + routes
- `src/server.ts` — Hono app 入口
- `src/env.ts` — zod env 验证

前端核心(`frontend/`):
- `src/styles/` — 政务深色 design tokens + globals + components.css(从 Claude Design 原型移植)
- `src/components/` — Icon/Btn/IconBtn/Tag/Card/PageHeader/Status/Tabs/MapView/DetailPane + topbar
- `src/lib/` — api client + auth + useAuth hook
- `src/routes/` — Login + 三视图占位骨架(Analyst/Decision/Reviewer)
- `src/App.tsx` — 根:auth gate + role 路由

## 后续里程碑

- **m2(Plan-B,待写)**:WatchList + PredictionAgent + 1 信源 + 1 摄像头 adapter + 批准流
- **m3(Plan-C,待写)**:WebhookIngest + MediaFetcher + 复盘 Agent + 二轴 outcome + Slice 0 验收

## 端口约定

| 服务 | 端口 | 备注 |
|---|---|---|
| Postgres(docker) | **5433**(host) → 5432(container) | 因主机有 native Postgres 占用 5432 |
| Redis(docker) | 6379 | |
| 后端 Hono | 3000 | |
| 前端 Vite | 5173 | `/api` 代理到 :3000 |
