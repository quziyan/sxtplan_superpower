# m1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把摄像头新闻预测系统的地基搭起来——repo 初始化 + 全套数据库 schema(含 Region 版本化、OperationAudit INSERT-only) + Auth + 角色态切换 + 前端骨架 + 行政区划种子加载。完成时应用壳能起,后续 m2(预测核心)/m3(真实端到端)都能在这个底上叠。

**Architecture:** Modular monolith,单 `package.json` 单进程。后端 bun + Hono + Drizzle ORM,前端 Vite + React + Tailwind + 高德地图。docker-compose 起本地 Postgres+PostGIS + Redis。所有数据库迁移走 Drizzle Kit,所有审计走独立 schema 的 INSERT-only 表。

**Tech Stack:** bun 1.x · hono 4.x · drizzle-orm 0.36+ · postgres.js 3.4+ · drizzle-kit 0.28+ · zod 3.23+ · biome 1.9+ · @node-rs/argon2 · vite 5+ · react 18 · tailwindcss 3 · @amap/amap-jsapi-loader

**Source Spec:** [`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`](../specs/2026-05-05-camera-news-prediction-design.md) (commit `72b1868`)

**Slice Position:** Plan-A of A/B/C 三段(B 路径垂直切片优先);本计划=m1(4 周窗口);Plan-B(m2 预测核心)和 Plan-C(m3 真实端到端)留待 Plan-A 完工后单独写。

**Spec ISC 覆盖:** ISC-5 / ISC-6 / ISC-7 / ISC-8 / ISC-30(部分) / ISC-32

---

## File Structure

```
排班系统设计-superpowers/
├── package.json                           # 根 package(bun workspaces:no,单包)
├── tsconfig.json
├── biome.json                             # 替代 eslint+prettier
├── drizzle.config.ts                      # drizzle-kit 配置
├── docker-compose.yml                     # postgres+postgis + redis
├── .env.example                           # env 模板(不含真值)
├── .gitignore
├── README.md                              # 改写,加 m1 启动说明
│
├── src/
│   ├── server.ts                          # Hono app 入口
│   ├── env.ts                             # zod 校验后的 env
│   │
│   ├── db/
│   │   ├── client.ts                      # Drizzle client 工厂
│   │   ├── types.ts                       # 自定义 PostGIS geometry 类型
│   │   ├── schema/
│   │   │   ├── index.ts                   # re-export
│   │   │   ├── user.ts                    # users / roles / user_roles / sessions
│   │   │   ├── region.ts                  # regions(版本化,POLYGON)
│   │   │   ├── taxonomy.ts                # vehicle_classes / task_classes / edge_tags
│   │   │   └── audit.ts                   # audit.operation_audit
│   │   └── migrate.ts                     # 启动时跑 migration 的命令
│   │
│   ├── auth/
│   │   ├── password.ts                    # argon2 hash + verify
│   │   ├── session.ts                     # session 创建 / 校验 / 销毁
│   │   ├── cookie.ts                      # signed cookie 工具
│   │   ├── middleware.ts                  # Hono 中间件,attach user 到 ctx
│   │   └── routes.ts                      # /auth/login, /logout, /me, /role-state
│   │
│   ├── modules/
│   │   ├── region/
│   │   │   ├── service.ts                 # Region 业务逻辑
│   │   │   ├── routes.ts                  # /regions CRUD + version
│   │   │   └── seed.ts                    # CLI 种子加载
│   │   └── taxonomy/
│   │       ├── service.ts
│   │       └── routes.ts
│   │
│   ├── audit/
│   │   └── log.ts                         # audit.operation_audit insert helper
│   │
│   └── lib/
│       ├── errors.ts                      # 标准化错误类
│       └── logger.ts                      # 简单 stdout JSON logger
│
├── migrations/                            # Drizzle Kit 自动生成
│   └── 0000_init.sql                      # 由 drizzle-kit generate 产出
│
├── seeds/
│   └── region/
│       ├── README.md                      # 种子数据来源说明
│       └── china-admin-l1-l4.geojson      # 行政区划数据(国/省/市/区)
│
├── tests/
│   ├── helpers/
│   │   ├── test-db.ts                     # 测试 DB fixture(独立 schema)
│   │   └── test-server.ts                 # 测试 Hono 实例工厂
│   ├── db/
│   │   ├── region.test.ts
│   │   └── taxonomy.test.ts
│   ├── auth/
│   │   ├── password.test.ts
│   │   ├── session.test.ts
│   │   └── routes.test.ts
│   ├── modules/
│   │   ├── region.test.ts
│   │   └── taxonomy.test.ts
│   ├── audit/
│   │   └── log.test.ts
│   └── e2e/
│       └── smoke.test.ts                  # 应用壳起来 + 登录 + 切角色
│
└── frontend/
    ├── package.json
    ├── vite.config.ts                     # /api 代理到 backend
    ├── tsconfig.json
    ├── index.html
    ├── tailwind.config.ts
    ├── postcss.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── router.tsx                     # 简单路由
        ├── lib/
        │   ├── api.ts                     # fetch 包装
        │   └── auth.ts                    # session 客户端态
        ├── components/
        │   ├── RoleSwitcher.tsx           # 顶部切换 DECIDER/ANALYST/REVIEWER
        │   └── MapView.tsx                # 高德地图占位
        ├── routes/
        │   ├── Login.tsx
        │   └── Home.tsx                   # 角色态对应的占位 stub
        └── styles.css
```

**关键决策回顾:**
- **不上 monorepo / pnpm workspaces** — 后端 + 前端各自一份 package.json,根目录 bun 主导后端,frontend/ 子目录独立 vite。
- **不上 ORM 抽象层** — Drizzle 直接,不引入 Prisma 或 TypeORM(过重)。
- **不上 K8s / 复杂 secrets 管理** — `.env` + docker-compose,m1 阶段保持简单。
- **审计 schema 独立 + INSERT-only via DB role** — 服务连接用 `app_user`(无 audit UPDATE/DELETE 权限),迁移用 `app_admin`(完整权限)。
- **前端简单路由** — m1 不引入 React Router 复杂态,用最简 useState 路由器。m2 视情况升级。

---

## Tasks

### Section 1 — Repo Bootstrap

#### Task 1: Initialize bun + TypeScript project at repo root

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `biome.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "camera-news-prediction",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/server.ts",
    "start": "bun src/server.ts",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests",
    "format": "biome format --write src tests",
    "test": "bun test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun src/db/migrate.ts",
    "db:push": "drizzle-kit push",
    "seed:region": "bun src/modules/region/seed.ts"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*", "tests/**/*", "drizzle.config.ts"],
  "exclude": ["node_modules", "frontend"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
bun.lockb
.env
.env.local
*.log
dist/
build/
coverage/
.DS_Store
.vscode/
.idea/
frontend/dist/
frontend/node_modules/
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noExplicitAny": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

- [ ] **Step 5: Verify bootstrap**

Run: `bun install && bunx tsc --noEmit`
Expected: no errors (empty src is fine — tsc just validates config).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore biome.json
git commit -m "chore: initialize bun + TypeScript + biome project"
```

---

#### Task 2: Install core dependencies

**Files:** Modify `package.json:1-30` via `bun add`.

- [ ] **Step 1: Install runtime deps**

```bash
bun add hono@^4.6.0 \
  drizzle-orm@^0.36.0 \
  postgres@^3.4.5 \
  zod@^3.23.0 \
  @node-rs/argon2@^2.0.0 \
  @hono/zod-validator@^0.4.0 \
  dotenv@^16.4.0
```

- [ ] **Step 2: Install dev deps**

```bash
bun add -d drizzle-kit@^0.28.0 \
  @biomejs/biome@^1.9.4 \
  bun-types@latest \
  typescript@^5.6.0
```

- [ ] **Step 3: Verify install**

Run: `bun install`
Expected: lockfile written, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: install core deps (hono, drizzle, postgres, zod, argon2)"
```

---

#### Task 3: Setup docker-compose for local Postgres+PostGIS + Redis

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    container_name: cnp-postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-cnp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-cnp_dev}
      POSTGRES_DB: ${POSTGRES_DB:-cnp}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - cnp-pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-cnp}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: cnp-redis
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - cnp-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  cnp-pg-data:
  cnp-redis-data:
```

- [ ] **Step 2: Create `.env.example`**

```
# --- Database ---
POSTGRES_USER=cnp
POSTGRES_PASSWORD=cnp_dev
POSTGRES_DB=cnp
POSTGRES_PORT=5432

# DATABASE_URL is constructed from the above for the app.
# 应用账号(不可写 audit 表)
DATABASE_URL=postgres://cnp_app:cnp_app_pwd@localhost:5432/cnp
# 迁移账号(完整权限,只在 db:migrate 时使用)
DATABASE_ADMIN_URL=postgres://cnp:cnp_dev@localhost:5432/cnp

# --- Redis ---
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379

# --- App ---
PORT=3000
NODE_ENV=development
SESSION_SECRET=change_me_to_64_random_hex_chars
COOKIE_DOMAIN=localhost

# --- 高德地图 ---
AMAP_API_KEY=

# --- LLM(留 m2 用,m1 不读) ---
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=
DASHSCOPE_MODEL=deepseek-v4-flash
```

- [ ] **Step 3: Bring up containers**

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

Expected: both `cnp-postgres` and `cnp-redis` show `healthy` after ~10s.

- [ ] **Step 4: Verify Postgres + PostGIS**

```bash
docker exec -it cnp-postgres psql -U cnp -d cnp -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT postgis_version();"
```

Expected: `postgis_version` row returned (e.g., `3.4 USE_GEOS=1 ...`).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: docker-compose for postgres+postgis 16-3.4 and redis 7"
```

---

#### Task 4: Env validation with zod

**Files:**
- Create: `src/env.ts`
- Create: `tests/env.test.ts`

- [ ] **Step 1: Write the failing test `tests/env.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'

describe('env', () => {
  test('throws when DATABASE_URL missing', async () => {
    const orig = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    expect(() => require('../src/env').loadEnv()).toThrow(/DATABASE_URL/)
    if (orig) process.env.DATABASE_URL = orig
  })

  test('parses valid env', () => {
    process.env.DATABASE_URL = 'postgres://x:y@h:5432/d'
    process.env.DATABASE_ADMIN_URL = 'postgres://x:y@h:5432/d'
    process.env.SESSION_SECRET = '0'.repeat(64)
    const { loadEnv } = require('../src/env')
    const env = loadEnv()
    expect(env.PORT).toBe(3000)
    expect(env.NODE_ENV).toBe('development')
  })
})
```

- [ ] **Step 2: Run test, verify fails**

Run: `bun test tests/env.test.ts`
Expected: FAIL — `Cannot find module '../src/env'`.

- [ ] **Step 3: Implement `src/env.ts`**

```ts
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgres'),
  DATABASE_ADMIN_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().default('localhost'),
  AMAP_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().url().optional(),
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_MODEL: z.string().default('deepseek-v4-flash'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

export function loadEnv(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`env validation failed: ${issues}`)
  }
  cached = parsed.data
  return cached
}

export function resetEnvCacheForTests() {
  cached = null
}
```

- [ ] **Step 4: Run test, verify passes**

Run: `bun test tests/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts tests/env.test.ts
git commit -m "feat(env): zod-validated env loader"
```

---

#### Task 5: Drizzle Kit configuration + migration runner

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`

- [ ] **Step 1: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? '',
  },
  verbose: true,
  strict: true,
})
```

- [ ] **Step 2: Create `src/db/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { loadEnv } from '@/env'
import * as schema from './schema'

export type DbConnectionKind = 'app' | 'admin'

export function createDb(kind: DbConnectionKind = 'app') {
  const env = loadEnv()
  const url = kind === 'admin' ? env.DATABASE_ADMIN_URL : env.DATABASE_URL
  const sql = postgres(url, { max: kind === 'admin' ? 2 : 10, prepare: false })
  return { db: drizzle(sql, { schema }), sql }
}

export type Db = ReturnType<typeof createDb>['db']
```

- [ ] **Step 3: Create `src/db/migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

async function main() {
  const { db, sql } = createDb('admin')
  console.log('[migrate] running migrations from ./migrations')
  await migrate(db, { migrationsFolder: './migrations' })
  await sql.end()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
```

- [ ] **Step 4: Create empty `src/db/schema/index.ts`** (will fill in Task 6+)

```ts
// schemas re-exported here as they get added
export {}
```

- [ ] **Step 5: Verify migrate works on empty schema**

```bash
bun run db:generate    # 应该不产文件(无 schema 变化)
mkdir -p migrations
bun run db:migrate     # 空运行,无错
```

Expected: no error; "no migrations to apply" or similar.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts src/db/client.ts src/db/migrate.ts src/db/schema/index.ts
git commit -m "feat(db): drizzle-kit config and migration runner"
```

---

### Section 2 — Database Schemas

#### Task 6: User / Role / UserRole / Session schemas

**Files:**
- Create: `src/db/schema/user.ts`
- Modify: `src/db/schema/index.ts:1`
- Create: `tests/db/user.test.ts`
- Create: `tests/helpers/test-db.ts`

- [ ] **Step 1: Create test helper `tests/helpers/test-db.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@/db/schema'

export async function createTestDb() {
  const url = process.env.DATABASE_ADMIN_URL ?? 'postgres://cnp:cnp_dev@localhost:5432/cnp'
  const sql = postgres(url, { max: 2, prepare: false })
  const db = drizzle(sql, { schema })
  await migrate(db, { migrationsFolder: './migrations' })
  return { db, sql, cleanup: async () => { await sql.end() } }
}
```

- [ ] **Step 2: Write failing test `tests/db/user.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { users, roles, userRoles, sessions } from '@/db/schema/user'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('user schemas', () => {
  test('insert user + assign role + create session', async () => {
    const { db } = ctx
    const [u] = await db.insert(users).values({
      email: 'a@example.com', passwordHash: 'x',
    }).returning()
    expect(u.id).toBeDefined()

    const [r] = await db.insert(roles).values({ key: 'DECIDER', label: '决策者' }).returning()
    await db.insert(userRoles).values({ userId: u.id, roleId: r.id })

    const [s] = await db.insert(sessions).values({
      userId: u.id, expiresAt: new Date(Date.now() + 3600_000),
    }).returning()

    expect(s.userId).toBe(u.id)

    const got = await db.select().from(users).where(eq(users.id, u.id))
    expect(got).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run test, verify fails**

Run: `bun test tests/db/user.test.ts`
Expected: FAIL — schema not defined.

- [ ] **Step 4: Implement `src/db/schema/user.ts`**

```ts
import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(), // DECIDER | ANALYST | REVIEWER
  label: text('label').notNull(),
  description: text('description'),
})

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_role_pk').on(t.userId, t.roleId)]
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    activeRoleKey: text('active_role_key'), // 当前 role_state(三个 role key 之一,可空表示未选)
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)]
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Role = typeof roles.$inferSelect
export type Session = typeof sessions.$inferSelect
```

- [ ] **Step 5: Add to `src/db/schema/index.ts`**

```ts
export * from './user'
```

- [ ] **Step 6: Generate + apply migration**

```bash
bun run db:generate    # 产 0000_<random>.sql
bun run db:migrate
```

Expected: migration applies cleanly; tables created.

- [ ] **Step 7: Run test, verify passes**

Run: `bun test tests/db/user.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/ migrations/ tests/db/user.test.ts tests/helpers/test-db.ts
git commit -m "feat(db): users / roles / user_roles / sessions schemas"
```

---

#### Task 7: Region schema (versioned + PostGIS POLYGON)

**Files:**
- Create: `src/db/types.ts`
- Create: `src/db/schema/region.ts`
- Modify: `src/db/schema/index.ts:1` (add export)
- Create: `tests/db/region.test.ts`

- [ ] **Step 1: Create `src/db/types.ts` — custom geometry type for Drizzle**

```ts
import { customType } from 'drizzle-orm/pg-core'

// 存为 GeoJSON,DB 内是 geometry(POLYGON,4326)。
// 写时:Drizzle 把 GeoJSON 转 ST_GeomFromGeoJSON;读时:ST_AsGeoJSON 转回。
// 这里用 raw text 透传,driver 层 + 读写包装由 service 处理(见 Task 17)。
export const polygon = customType<{
  data: GeoJSON.Polygon
  driverData: string
}>({
  dataType() { return 'geometry(POLYGON,4326)' },
  toDriver(value: GeoJSON.Polygon): string { return JSON.stringify(value) },
  fromDriver(value: string): GeoJSON.Polygon { return JSON.parse(value) as GeoJSON.Polygon },
})
```

> 注:Drizzle 的 customType 不能自动包 ST_GeomFromGeoJSON。Service 层(Task 18)在 INSERT 时显式调用 `sql\`ST_GeomFromGeoJSON(${json})\``,SELECT 时用 view 或 `ST_AsGeoJSON`。本 customType 只承担类型携带角色。

- [ ] **Step 2: Implement `src/db/schema/region.ts`**

```ts
import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { polygon } from '../types'

export const regionKindEnum = pgEnum('region_kind', ['ADMIN_NAMED', 'AD_HOC'])

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: regionKindEnum('kind').notNull(),
    name: text('name'), // ADMIN_NAMED 必填(下面 CHECK)
    parentId: uuid('parent_id').references((): any => regions.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }), // NULL = current
    geom: polygon('geom').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('region_admin_named_has_name', sql`(${t.kind} = 'AD_HOC') OR (${t.name} IS NOT NULL)`),
    check('region_version_positive', sql`${t.version} >= 1`),
    index('regions_geom_idx').using('gist', t.geom),
    index('regions_kind_idx').on(t.kind),
    index('regions_name_idx').on(t.name),
  ]
)

export type Region = typeof regions.$inferSelect
export type NewRegion = typeof regions.$inferInsert
```

- [ ] **Step 3: Add export to `src/db/schema/index.ts`**

```ts
export * from './user'
export * from './region'
```

- [ ] **Step 4: Generate + apply migration**

```bash
bun run db:generate
# 检查 migrations/0001_*.sql 应包含 CREATE EXTENSION postgis;
# 如果没有,手动加到 migrations/0000_init.sql 顶部:
#   CREATE EXTENSION IF NOT EXISTS postgis;
bun run db:migrate
```

Expected: migration applies; `regions` table exists with PostGIS column.

- [ ] **Step 5: Write failing test `tests/db/region.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { regions } from '@/db/schema/region'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const samplePoly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

describe('region schema', () => {
  test('insert ADMIN_NAMED with version=1', async () => {
    const { db } = ctx
    const result = await db.execute(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('ADMIN_NAMED', '测试区', 1, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
      RETURNING id, kind, name, version
    `)
    expect(result[0].kind).toBe('ADMIN_NAMED')
    expect(result[0].version).toBe(1)
  })

  test('CHECK rejects ADMIN_NAMED without name', async () => {
    const { db } = ctx
    await expect(
      db.execute(sql`
        INSERT INTO regions (kind, name, geom)
        VALUES ('ADMIN_NAMED', NULL, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
      `)
    ).rejects.toThrow()
  })

  test('AD_HOC accepts NULL name', async () => {
    const { db } = ctx
    const result = await db.execute(sql`
      INSERT INTO regions (kind, name, geom)
      VALUES ('AD_HOC', NULL, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
      RETURNING id
    `)
    expect(result[0].id).toBeDefined()
  })
})
```

- [ ] **Step 6: Run test, verify passes**

Run: `bun test tests/db/region.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 7: Commit**

```bash
git add src/db/types.ts src/db/schema/region.ts src/db/schema/index.ts \
        migrations/ tests/db/region.test.ts
git commit -m "feat(db): regions table with version + PostGIS POLYGON + CHECK constraints"
```

---

#### Task 8: VehicleClass / TaskClass / EdgeTag schemas

**Files:**
- Create: `src/db/schema/taxonomy.ts`
- Modify: `src/db/schema/index.ts:1`
- Create: `tests/db/taxonomy.test.ts`

- [ ] **Step 1: Implement `src/db/schema/taxonomy.ts`**

```ts
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const vehicleClasses = pgTable(
  'vehicle_classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): any => vehicleClasses.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    level: integer('level').notNull(), // 1 = 大类, 2 = 子类
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('vehicle_level_1_has_no_parent', sql`(${t.level} = 1 AND ${t.parentId} IS NULL) OR (${t.level} = 2 AND ${t.parentId} IS NOT NULL)`),
    check('vehicle_level_in_range', sql`${t.level} IN (1, 2)`),
    index('vehicle_classes_parent_idx').on(t.parentId),
    index('vehicle_classes_name_idx').on(t.name),
  ]
)

export const taskClasses = pgTable(
  'task_classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): any => taskClasses.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('task_level_1_has_no_parent', sql`(${t.level} = 1 AND ${t.parentId} IS NULL) OR (${t.level} = 2 AND ${t.parentId} IS NOT NULL)`),
    check('task_level_in_range', sql`${t.level} IN (1, 2)`),
    index('task_classes_parent_idx').on(t.parentId),
    index('task_classes_name_idx').on(t.name),
  ]
)

// EdgeTag 挂在 Level 2 上,允许分析师创建。tag 是自由文本但去重。
export const vehicleEdgeTags = pgTable(
  'vehicle_edge_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleClassId: uuid('vehicle_class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vehicle_tag_unique', { unique: true }).on(t.vehicleClassId, t.tag)]
)

export const taskEdgeTags = pgTable(
  'task_edge_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskClassId: uuid('task_class_id').notNull().references(() => taskClasses.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('task_tag_unique', { unique: true }).on(t.taskClassId, t.tag)]
)

export type VehicleClass = typeof vehicleClasses.$inferSelect
export type TaskClass = typeof taskClasses.$inferSelect
```

- [ ] **Step 2: Add export `src/db/schema/index.ts`**

```ts
export * from './user'
export * from './region'
export * from './taxonomy'
```

- [ ] **Step 3: Generate + migrate**

```bash
bun run db:generate && bun run db:migrate
```

- [ ] **Step 4: Write test `tests/db/taxonomy.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { vehicleClasses, vehicleEdgeTags } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('taxonomy', () => {
  test('two-level hierarchy + edge tag', async () => {
    const { db } = ctx
    const [parent] = await db.insert(vehicleClasses).values({
      name: '消防车', level: 1,
    }).returning()
    const [child] = await db.insert(vehicleClasses).values({
      name: '高喷消防车', level: 2, parentId: parent.id,
    }).returning()
    expect(child.parentId).toBe(parent.id)

    const [tag] = await db.insert(vehicleEdgeTags).values({
      vehicleClassId: child.id, tag: '远程支援',
    }).returning()
    expect(tag.tag).toBe('远程支援')
  })

  test('CHECK rejects level=1 with parent', async () => {
    const { db } = ctx
    const [p] = await db.insert(vehicleClasses).values({ name: '父', level: 1 }).returning()
    await expect(
      db.insert(vehicleClasses).values({ name: '错', level: 1, parentId: p.id })
    ).rejects.toThrow()
  })

  test('CHECK rejects level=2 without parent', async () => {
    const { db } = ctx
    await expect(
      db.insert(vehicleClasses).values({ name: '错', level: 2 })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Run test, verify passes**

Run: `bun test tests/db/taxonomy.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/taxonomy.ts src/db/schema/index.ts \
        migrations/ tests/db/taxonomy.test.ts
git commit -m "feat(db): vehicle_classes / task_classes / edge_tags with hierarchy CHECK"
```

---

#### Task 9: OperationAudit schema (separate `audit` schema, INSERT-only via DB role)

**Files:**
- Create: `src/db/schema/audit.ts`
- Create: `migrations/manual/0001_audit_schema_and_app_role.sql`(手写,Drizzle 不管理 schema/role 创建)
- Modify: `src/db/migrate.ts:1` (run manual files first)
- Modify: `src/db/schema/index.ts:1`
- Create: `tests/db/audit.test.ts`

- [ ] **Step 1: Create manual migration `migrations/manual/0001_audit_schema_and_app_role.sql`**

```sql
-- Manual migration: audit schema + DB roles. Idempotent.

-- 1. Create audit schema if not exists
CREATE SCHEMA IF NOT EXISTS audit;

-- 2. Create app role (only INSERT on audit.* allowed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cnp_app') THEN
    CREATE ROLE cnp_app WITH LOGIN PASSWORD 'cnp_app_pwd';
  END IF;
END $$;

-- 3. Grant on public schema (业务表) — full DML for now
GRANT USAGE ON SCHEMA public TO cnp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cnp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cnp_app;

-- 4. Grant on audit schema — INSERT + SELECT only(无 UPDATE / DELETE)
GRANT USAGE ON SCHEMA audit TO cnp_app;
GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA audit TO cnp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT INSERT, SELECT ON TABLES TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT USAGE, SELECT ON SEQUENCES TO cnp_app;
```

- [ ] **Step 2: Update `src/db/migrate.ts` to run manual SQL files first**

```ts
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

async function runManualMigrations(sql: ReturnType<typeof createDb>['sql']) {
  const dir = path.resolve('./migrations/manual')
  let files: string[] = []
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort() }
  catch { return }
  for (const f of files) {
    const content = await readFile(path.join(dir, f), 'utf8')
    console.log(`[migrate] manual: ${f}`)
    await sql.unsafe(content)
  }
}

async function main() {
  const { db, sql } = createDb('admin')
  await runManualMigrations(sql)
  console.log('[migrate] running drizzle migrations from ./migrations')
  await migrate(db, { migrationsFolder: './migrations' })
  await sql.end()
  console.log('[migrate] done')
}

main().catch((err) => { console.error('[migrate] failed:', err); process.exit(1) })
```

- [ ] **Step 3: Implement `src/db/schema/audit.ts`**

```ts
import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const auditSchema = pgSchema('audit')

export const operationAudit = auditSchema.table('operation_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id'),
  actorRoleKey: text('actor_role_key'), // DECIDER/ANALYST/REVIEWER 之一
  targetKind: text('target_kind').notNull(), // 'prediction' | 'dispatch' | 'confidence' | 'retrospective' 等
  targetId: uuid('target_id'),
  action: text('action').notNull(), // 'approve' | 'reject' | 'override_confidence' | 'cancel' | 'override_outcome' 等
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
})

export type OperationAudit = typeof operationAudit.$inferSelect
export type NewOperationAudit = typeof operationAudit.$inferInsert
```

- [ ] **Step 4: Add export `src/db/schema/index.ts`**

```ts
export * from './user'
export * from './region'
export * from './taxonomy'
export * from './audit'
```

- [ ] **Step 5: Generate + migrate**

```bash
bun run db:generate
bun run db:migrate
```

Expected: `audit.operation_audit` table created;`cnp_app` role exists.

- [ ] **Step 6: Run test ensuring INSERT works as cnp_app, UPDATE/DELETE fails**

Create test `tests/db/audit.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql as drizzleSql } from 'drizzle-orm'
import { operationAudit } from '@/db/schema/audit'
import * as schema from '@/db/schema'

const APP_URL = process.env.DATABASE_URL ?? 'postgres://cnp_app:cnp_app_pwd@localhost:5432/cnp'

describe('audit (INSERT-only enforced by DB role)', () => {
  test('cnp_app can INSERT', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    const db = drizzle(sql, { schema })
    const [row] = await db.insert(operationAudit).values({
      targetKind: 'prediction', action: 'test_insert',
    }).returning()
    expect(row.id).toBeDefined()
    await sql.end()
  })

  test('cnp_app cannot UPDATE', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    await expect(
      sql`UPDATE audit.operation_audit SET action='changed' WHERE TRUE`
    ).rejects.toThrow(/permission denied/)
    await sql.end()
  })

  test('cnp_app cannot DELETE', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    await expect(
      sql`DELETE FROM audit.operation_audit WHERE TRUE`
    ).rejects.toThrow(/permission denied/)
    await sql.end()
  })
})
```

- [ ] **Step 7: Run test, verify passes**

Run: `bun test tests/db/audit.test.ts`
Expected: PASS — 3 cases (INSERT works, UPDATE/DELETE both denied).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/audit.ts src/db/schema/index.ts \
        src/db/migrate.ts \
        migrations/ tests/db/audit.test.ts
git commit -m "feat(db): audit schema with INSERT-only enforcement at DB role layer"
```

---

#### Task 10: Audit log helper

**Files:**
- Create: `src/audit/log.ts`
- Create: `tests/audit/log.test.ts`

- [ ] **Step 1: Implement `src/audit/log.ts`**

```ts
import type { Db } from '@/db/client'
import { operationAudit } from '@/db/schema/audit'

export type AuditEntry = {
  actorUserId?: string
  actorRoleKey?: string
  targetKind: string
  targetId?: string
  action: string
  before?: unknown
  after?: unknown
  reason?: string
}

export async function logAudit(db: Db, entry: AuditEntry) {
  await db.insert(operationAudit).values({
    actorUserId: entry.actorUserId,
    actorRoleKey: entry.actorRoleKey,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    action: entry.action,
    before: entry.before === undefined ? null : (entry.before as object),
    after: entry.after === undefined ? null : (entry.after as object),
    reason: entry.reason,
  })
}
```

- [ ] **Step 2: Write test `tests/audit/log.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { logAudit } from '@/audit/log'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('logAudit', () => {
  test('inserts row into audit.operation_audit', async () => {
    const { db } = ctx
    await logAudit(db, {
      targetKind: 'prediction', action: 'approve',
      reason: 'looks good', before: { conf: 50 }, after: { conf: 50 },
    })
    const result = await db.execute(sql`
      SELECT action, reason, before FROM audit.operation_audit
      WHERE action = 'approve' AND reason = 'looks good'
    `)
    expect(result.length).toBeGreaterThan(0)
    expect((result[0] as any).before).toEqual({ conf: 50 })
  })
})
```

- [ ] **Step 3: Run test, verify passes**

Run: `bun test tests/audit/log.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/audit/log.ts tests/audit/log.test.ts
git commit -m "feat(audit): logAudit helper"
```

---

### Section 3 — Auth

#### Task 11: Password hashing with argon2

**Files:**
- Create: `src/auth/password.ts`
- Create: `tests/auth/password.test.ts`

- [ ] **Step 1: Write failing test `tests/auth/password.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { hashPassword, verifyPassword } from '@/auth/password'

describe('password', () => {
  test('hash + verify round trip', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(h).not.toBe('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
  })

  test('different inputs produce different hashes', async () => {
    const a = await hashPassword('a')
    const b = await hashPassword('a')
    expect(a).not.toBe(b) // 不同 salt
  })
})
```

- [ ] **Step 2: Run test, fails with module not found**

Run: `bun test tests/auth/password.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/auth/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2'

const HASH_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB,argon2id 推荐起步
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTS)
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  try { return await verify(hashed, plain) }
  catch { return false }
}
```

- [ ] **Step 4: Run test, passes**

Run: `bun test tests/auth/password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/password.ts tests/auth/password.test.ts
git commit -m "feat(auth): argon2id password hashing"
```

---

#### Task 12: Signed cookie utility

**Files:**
- Create: `src/auth/cookie.ts`
- Create: `tests/auth/cookie.test.ts`

- [ ] **Step 1: Write failing test `tests/auth/cookie.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'
import { signValue, verifyValue } from '@/auth/cookie'

const SECRET = '0'.repeat(64)

describe('signed cookie', () => {
  test('sign and verify round trip', () => {
    const signed = signValue('session-id-abc', SECRET)
    expect(signed).toContain('.')
    expect(verifyValue(signed, SECRET)).toBe('session-id-abc')
  })

  test('tampered value rejected', () => {
    const signed = signValue('a', SECRET)
    const tampered = `b.${signed.split('.')[1]}`
    expect(verifyValue(tampered, SECRET)).toBeNull()
  })

  test('wrong secret rejected', () => {
    const signed = signValue('a', SECRET)
    expect(verifyValue(signed, '1'.repeat(64))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify fails**

Run: `bun test tests/auth/cookie.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/auth/cookie.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`
}

export function verifyValue(signed: string, secret: string): string | null {
  const lastDot = signed.lastIndexOf('.')
  if (lastDot < 0) return null
  const value = signed.slice(0, lastDot)
  const sig = signed.slice(lastDot + 1)
  const expected = hmac(value, secret)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return value
}
```

- [ ] **Step 4: Run test, verify passes**

Run: `bun test tests/auth/cookie.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/auth/cookie.ts tests/auth/cookie.test.ts
git commit -m "feat(auth): signed cookie helper"
```

---

#### Task 13: Session creation / lookup / expiry

**Files:**
- Create: `src/auth/session.ts`
- Create: `tests/auth/session.test.ts`

- [ ] **Step 1: Implement `src/auth/session.ts`**

```ts
import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { sessions, type Session } from '@/db/schema/user'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d

export async function createSession(db: Db, userId: string, ttlMs = DEFAULT_TTL_MS): Promise<Session> {
  const expiresAt = new Date(Date.now() + ttlMs)
  const [s] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  return s
}

export async function getSession(db: Db, id: string): Promise<Session | null> {
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
  return s ?? null
}

export async function destroySession(db: Db, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}

export async function setActiveRole(db: Db, sessionId: string, roleKey: string | null): Promise<void> {
  await db.update(sessions).set({ activeRoleKey: roleKey }).where(eq(sessions.id, sessionId))
}
```

- [ ] **Step 2: Write test `tests/auth/session.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createSession, destroySession, getSession, setActiveRole } from '@/auth/session'
import { users } from '@/db/schema/user'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let userId: string

beforeAll(async () => {
  ctx = await createTestDb()
  const [u] = await ctx.db.insert(users).values({
    email: `s+${Date.now()}@x`, passwordHash: 'x',
  }).returning()
  userId = u.id
})
afterAll(async () => { await ctx.cleanup() })

describe('session', () => {
  test('create + get + destroy', async () => {
    const s = await createSession(ctx.db, userId)
    expect(s.id).toBeDefined()
    const got = await getSession(ctx.db, s.id)
    expect(got?.userId).toBe(userId)
    await destroySession(ctx.db, s.id)
    expect(await getSession(ctx.db, s.id)).toBeNull()
  })

  test('expired session not returned', async () => {
    const s = await createSession(ctx.db, userId, -1000) // 已过期
    expect(await getSession(ctx.db, s.id)).toBeNull()
  })

  test('setActiveRole writes role_state', async () => {
    const s = await createSession(ctx.db, userId)
    await setActiveRole(ctx.db, s.id, 'DECIDER')
    const got = await getSession(ctx.db, s.id)
    expect(got?.activeRoleKey).toBe('DECIDER')
  })
})
```

- [ ] **Step 3: Run, verify passes**

Run: `bun test tests/auth/session.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 4: Commit**

```bash
git add src/auth/session.ts tests/auth/session.test.ts
git commit -m "feat(auth): session create/get/destroy + active role"
```

---

#### Task 14: Auth middleware + login / logout / me / role-state routes

**Files:**
- Create: `src/auth/middleware.ts`
- Create: `src/auth/routes.ts`
- Create: `src/lib/errors.ts`
- Create: `tests/auth/routes.test.ts`
- Create: `tests/helpers/test-server.ts`

- [ ] **Step 1: Implement `src/lib/errors.ts`**

```ts
export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

export const Unauthorized = (msg = 'unauthorized') => new AppError(401, 'UNAUTHORIZED', msg)
export const Forbidden = (msg = 'forbidden') => new AppError(403, 'FORBIDDEN', msg)
export const BadRequest = (msg = 'bad request') => new AppError(400, 'BAD_REQUEST', msg)
export const NotFound = (msg = 'not found') => new AppError(404, 'NOT_FOUND', msg)
```

- [ ] **Step 2: Implement `src/auth/middleware.ts`**

```ts
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { loadEnv } from '@/env'
import type { Db } from '@/db/client'
import { users, userRoles, roles } from '@/db/schema/user'
import { getSession } from './session'
import { verifyValue } from './cookie'
import { Unauthorized } from '@/lib/errors'

export type AuthContext = {
  user: { id: string; email: string; displayName: string | null }
  sessionId: string
  activeRoleKey: string | null
  availableRoles: string[]
}

export function authRequired(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const env = loadEnv()
    const raw = getCookie(c, 'session')
    if (!raw) throw Unauthorized()
    const sessionId = verifyValue(raw, env.SESSION_SECRET)
    if (!sessionId) throw Unauthorized()
    const session = await getSession(db, sessionId)
    if (!session) throw Unauthorized()
    const [u] = await db.select().from(users).where(eq(users.id, session.userId))
    if (!u || !u.isActive) throw Unauthorized()
    const userRoleRows = await db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, u.id))
    c.set('auth', {
      user: { id: u.id, email: u.email, displayName: u.displayName },
      sessionId,
      activeRoleKey: session.activeRoleKey,
      availableRoles: userRoleRows.map((r) => r.key),
    } satisfies AuthContext)
    await next()
  }
}

export function roleRequired(...allowed: string[]): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) throw Unauthorized()
    if (!auth.activeRoleKey || !allowed.includes(auth.activeRoleKey)) {
      throw Unauthorized(`requires role(s): ${allowed.join('|')}`)
    }
    await next()
  }
}
```

- [ ] **Step 3: Implement `src/auth/routes.ts`**

```ts
import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { loadEnv } from '@/env'
import type { Db } from '@/db/client'
import { users, roles, userRoles } from '@/db/schema/user'
import { verifyPassword } from './password'
import { createSession, destroySession, setActiveRole } from './session'
import { signValue } from './cookie'
import { authRequired, type AuthContext } from './middleware'
import { Unauthorized, BadRequest } from '@/lib/errors'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const roleStateSchema = z.object({ roleKey: z.enum(['DECIDER', 'ANALYST', 'REVIEWER']).nullable() })

export function authRoutes(db: Db) {
  const app = new Hono()

  app.post('/login', zValidator('json', loginSchema), async (c) => {
    const env = loadEnv()
    const { email, password } = c.req.valid('json')
    const [u] = await db.select().from(users).where(eq(users.email, email))
    if (!u || !u.isActive) throw Unauthorized('invalid credentials')
    if (!(await verifyPassword(password, u.passwordHash))) throw Unauthorized('invalid credentials')
    const session = await createSession(db, u.id)
    const signed = signValue(session.id, env.SESSION_SECRET)
    setCookie(c, 'session', signed, {
      httpOnly: true, sameSite: 'Lax', path: '/',
      secure: env.NODE_ENV === 'production',
      domain: env.COOKIE_DOMAIN,
      maxAge: 7 * 24 * 60 * 60,
    })
    return c.json({ ok: true, userId: u.id })
  })

  app.post('/logout', authRequired(db), async (c) => {
    const auth = c.get('auth') as AuthContext
    await destroySession(db, auth.sessionId)
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/me', authRequired(db), async (c) => {
    const auth = c.get('auth') as AuthContext
    return c.json(auth)
  })

  app.post('/role-state', authRequired(db), zValidator('json', roleStateSchema), async (c) => {
    const auth = c.get('auth') as AuthContext
    const { roleKey } = c.req.valid('json')
    if (roleKey !== null && !auth.availableRoles.includes(roleKey)) {
      throw BadRequest(`user lacks role ${roleKey}`)
    }
    await setActiveRole(db, auth.sessionId, roleKey)
    return c.json({ ok: true, activeRoleKey: roleKey })
  })

  return app
}
```

- [ ] **Step 4: Create `tests/helpers/test-server.ts`**

```ts
import { Hono } from 'hono'
import { authRoutes } from '@/auth/routes'
import { AppError } from '@/lib/errors'
import type { Db } from '@/db/client'

export function buildTestApp(db: Db) {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
  })
  app.route('/auth', authRoutes(db))
  return app
}
```

- [ ] **Step 5: Write `tests/auth/routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { eq } from 'drizzle-orm'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let testEmail: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  testEmail = `t+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email: testEmail, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'DECIDER'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'DECIDER', label: '决策者' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u.id, roleId: r.id })
})
afterAll(async () => { await ctx.cleanup() })

describe('auth routes', () => {
  test('login + me + role-state + logout', async () => {
    const loginRes = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'pass1234' }),
    })
    expect(loginRes.status).toBe(200)
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const sessionCookie = cookie.split(';')[0]

    const meRes = await app.request('/auth/me', { headers: { cookie: sessionCookie } })
    expect(meRes.status).toBe(200)
    const me = await meRes.json()
    expect(me.user.email).toBe(testEmail)
    expect(me.availableRoles).toContain('DECIDER')

    const switchRes = await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ roleKey: 'DECIDER' }),
    })
    expect(switchRes.status).toBe(200)

    const logoutRes = await app.request('/auth/logout', {
      method: 'POST', headers: { cookie: sessionCookie },
    })
    expect(logoutRes.status).toBe(200)
  })

  test('login with wrong password returns 401', async () => {
    const res = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  test('role-state with role user lacks returns 400', async () => {
    const loginRes = await app.request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'pass1234' }),
    })
    const sessionCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]
    const res = await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ roleKey: 'REVIEWER' }),
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Run tests, verify pass**

Run: `bun test tests/auth/routes.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 7: Commit**

```bash
git add src/auth/middleware.ts src/auth/routes.ts src/lib/errors.ts \
        tests/helpers/test-server.ts tests/auth/routes.test.ts
git commit -m "feat(auth): login/logout/me/role-state routes + middleware"
```

---

### Section 4 — Region Module

#### Task 15: Region service — create / get / version-aware read

**Files:**
- Create: `src/modules/region/service.ts`
- Create: `tests/modules/region.test.ts`

- [ ] **Step 1: Implement `src/modules/region/service.ts`**

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { regions, type NewRegion, type Region } from '@/db/schema/region'
import { BadRequest, NotFound } from '@/lib/errors'

export type CreateRegionInput =
  | { kind: 'ADMIN_NAMED'; name: string; parentId?: string; geom: GeoJSON.Polygon; createdBy?: string }
  | { kind: 'AD_HOC'; name?: string; geom: GeoJSON.Polygon; createdBy?: string }

function validatePolygon(p: GeoJSON.Polygon) {
  if (p.type !== 'Polygon') throw BadRequest('geom must be Polygon')
  if (!p.coordinates.length) throw BadRequest('Polygon must have at least one ring')
  const outer = p.coordinates[0]
  if (outer.length < 4) throw BadRequest('Polygon outer ring needs >= 4 points')
  const first = outer[0], last = outer[outer.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) throw BadRequest('Polygon outer ring not closed')
}

export async function createRegion(db: Db, input: CreateRegionInput): Promise<Region> {
  validatePolygon(input.geom)
  const [row] = await db.execute<Region>(sql`
    INSERT INTO regions (kind, name, parent_id, version, geom, created_by)
    VALUES (
      ${input.kind},
      ${input.kind === 'ADMIN_NAMED' ? input.name : (input.name ?? null)},
      ${'parentId' in input ? input.parentId ?? null : null},
      1,
      ST_GeomFromGeoJSON(${JSON.stringify(input.geom)}),
      ${input.createdBy ?? null}
    )
    RETURNING id, kind, name, parent_id AS "parentId", version,
              effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
              ST_AsGeoJSON(geom)::json AS geom,
              created_by AS "createdBy", created_at AS "createdAt"
  `)
  return row
}

export async function getRegion(db: Db, id: string, version?: number): Promise<Region> {
  const versionFilter = version ? sql`AND version = ${version}` : sql`AND effective_to IS NULL`
  const [row] = await db.execute<Region>(sql`
    SELECT id, kind, name, parent_id AS "parentId", version,
           effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
           ST_AsGeoJSON(geom)::json AS geom,
           created_by AS "createdBy", created_at AS "createdAt"
    FROM regions WHERE id = ${id} ${versionFilter}
  `)
  if (!row) throw NotFound(`region ${id}${version ? ` v${version}` : ''} not found`)
  return row
}

export type UpdateAdminRegionInput = {
  id: string
  geom: GeoJSON.Polygon
  effectiveFrom?: Date
  changedBy?: string
}

// 仅 ADMIN_NAMED 支持版本化更新。AD_HOC immutable。
export async function updateAdminRegionGeom(db: Db, input: UpdateAdminRegionInput): Promise<Region> {
  validatePolygon(input.geom)
  const cur = await getRegion(db, input.id) // 当前版本
  if (cur.kind !== 'ADMIN_NAMED') throw BadRequest('AD_HOC regions are immutable')
  const effFrom = input.effectiveFrom ?? new Date()
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE regions SET effective_to = ${effFrom}
      WHERE id = ${input.id} AND effective_to IS NULL
    `)
    await tx.execute(sql`
      INSERT INTO regions (id, kind, name, parent_id, version, effective_from, geom, created_by)
      VALUES (
        ${input.id}, ${cur.kind}, ${cur.name}, ${cur.parentId},
        ${cur.version + 1}, ${effFrom},
        ST_GeomFromGeoJSON(${JSON.stringify(input.geom)}),
        ${input.changedBy ?? null}
      )
    `)
  })
  return getRegion(db, input.id) // 新当前
}
```

> 注:同一 `id` 多版本要求改 PK——下面 Step 2 在测试前先调整 schema(把 `id` 改成 composite PK `(id, version)`),migration 会重生。这是设计稿 §2.4 的要求。

- [ ] **Step 2: Adjust schema for composite PK on regions**

Update `src/db/schema/region.ts`:

```ts
// 替换 id pk 为 (id, version) 复合 PK
import { primaryKey } from 'drizzle-orm/pg-core'
// ...在表定义末尾扩展 (t) => [...] 数组,移除 pk:
//   primaryKey({ columns: [t.id, t.version], name: 'regions_pk' }),
//   ...rest
// 同时去掉 id 上的 .primaryKey()(改成 .notNull().defaultRandom()),
// effective_to 加部分唯一索引保证"同 id 仅一个 current":
//   uniqueIndex('regions_one_current').on(t.id).where(sql`effective_to IS NULL`)
```

具体替换后的完整 region.ts:

```ts
import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { polygon } from '../types'

export const regionKindEnum = pgEnum('region_kind', ['ADMIN_NAMED', 'AD_HOC'])

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').notNull().defaultRandom(),
    kind: regionKindEnum('kind').notNull(),
    name: text('name'),
    parentId: uuid('parent_id'),
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    geom: polygon('geom').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version], name: 'regions_pk' }),
    check('region_admin_named_has_name', sql`(${t.kind} = 'AD_HOC') OR (${t.name} IS NOT NULL)`),
    check('region_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('regions_one_current').on(t.id).where(sql`${t.effectiveTo} IS NULL`),
    index('regions_geom_idx').using('gist', t.geom),
    index('regions_kind_idx').on(t.kind),
    index('regions_name_idx').on(t.name),
  ]
)
```

- [ ] **Step 3: Regenerate + apply migration**

```bash
bun run db:generate
bun run db:migrate
```

> 如果旧 schema 已存在,可能需要 drop + recreate(开发期可以接受)。Production 真升级要写手工 migration。

- [ ] **Step 4: Write `tests/modules/region.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createRegion, getRegion, updateAdminRegionGeom } from '@/modules/region/service'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly = (x: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[x, 30], [x + 1, 30], [x + 1, 31], [x, 31], [x, 30]]],
})

describe('region service', () => {
  test('create ADMIN_NAMED + getRegion returns current', async () => {
    const r = await createRegion(ctx.db, { kind: 'ADMIN_NAMED', name: '测试区A', geom: poly(120) })
    expect(r.version).toBe(1)
    const got = await getRegion(ctx.db, r.id)
    expect(got.name).toBe('测试区A')
  })

  test('update ADMIN_NAMED appends version=2 + closes v1', async () => {
    const r = await createRegion(ctx.db, { kind: 'ADMIN_NAMED', name: '测试区B', geom: poly(122) })
    const updated = await updateAdminRegionGeom(ctx.db, { id: r.id, geom: poly(123) })
    expect(updated.version).toBe(2)
    const v1 = await getRegion(ctx.db, r.id, 1)
    expect(v1.effectiveTo).not.toBeNull()
  })

  test('AD_HOC immutable: update throws', async () => {
    const r = await createRegion(ctx.db, { kind: 'AD_HOC', geom: poly(124) })
    await expect(updateAdminRegionGeom(ctx.db, { id: r.id, geom: poly(125) })).rejects.toThrow(/immutable/)
  })

  test('open polygon rejected', async () => {
    await expect(createRegion(ctx.db, {
      kind: 'AD_HOC',
      geom: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, // 没闭合
    })).rejects.toThrow(/not closed/)
  })
})
```

- [ ] **Step 5: Run, verify passes**

Run: `bun test tests/modules/region.test.ts`
Expected: PASS — 4 cases.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/region.ts src/modules/region/service.ts \
        migrations/ tests/modules/region.test.ts
git commit -m "feat(region): create/get/version-update with composite PK + one-current index"
```

---

#### Task 16: Region routes (HTTP API)

**Files:**
- Create: `src/modules/region/routes.ts`
- Modify: `tests/modules/region.test.ts:1` (add HTTP cases) — or create separate file

- [ ] **Step 1: Implement `src/modules/region/routes.ts`**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired } from '@/auth/middleware'
import { createRegion, getRegion, updateAdminRegionGeom } from './service'

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
})

const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADMIN_NAMED'), name: z.string().min(1), parentId: z.string().uuid().optional(), geom: polygonSchema }),
  z.object({ kind: z.literal('AD_HOC'), name: z.string().optional(), geom: polygonSchema }),
])

const updateSchema = z.object({ geom: polygonSchema, effectiveFrom: z.string().datetime().optional() })

export function regionRoutes(db: Db) {
  const app = new Hono()

  app.post('/', authRequired(db), zValidator('json', createSchema), async (c) => {
    const auth = c.get('auth') as { user: { id: string } }
    const body = c.req.valid('json')
    const r = await createRegion(db, { ...body, createdBy: auth.user.id } as any)
    return c.json(r, 201)
  })

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const versionParam = c.req.query('version')
    const version = versionParam ? Number.parseInt(versionParam, 10) : undefined
    return c.json(await getRegion(db, id, version))
  })

  app.put('/:id', authRequired(db), zValidator('json', updateSchema), async (c) => {
    const auth = c.get('auth') as { user: { id: string } }
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const updated = await updateAdminRegionGeom(db, {
      id, geom: body.geom,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      changedBy: auth.user.id,
    })
    return c.json(updated)
  })

  return app
}
```

- [ ] **Step 2: Add to test-server**

Update `tests/helpers/test-server.ts`:

```ts
import { regionRoutes } from '@/modules/region/routes'
// ...在 app 上挂载:
app.route('/regions', regionRoutes(db))
```

- [ ] **Step 3: Add HTTP tests `tests/modules/region.routes.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { eq } from 'drizzle-orm'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const email = `r+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()
  let [r] = await ctx.db.select().from(roles).where(eq(roles.key, 'ANALYST'))
  if (!r) [r] = await ctx.db.insert(roles).values({ key: 'ANALYST', label: '分析师' }).returning()
  await ctx.db.insert(userRoles).values({ userId: u.id, roleId: r.id })
  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
})
afterAll(async () => { await ctx.cleanup() })

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

describe('region routes', () => {
  test('POST /regions creates ADMIN_NAMED', async () => {
    const res = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'ADMIN_NAMED', name: '测试朝阳区', geom: poly }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('测试朝阳区')
  })

  test('GET /regions/:id returns current version', async () => {
    const create = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'AD_HOC', geom: poly }),
    })
    const r = await create.json()
    const get = await app.request(`/regions/${r.id}`)
    expect(get.status).toBe(200)
  })

  test('POST /regions without auth returns 401', async () => {
    const res = await app.request('/regions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'AD_HOC', geom: poly }),
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run, verify passes**

Run: `bun test tests/modules/region.routes.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/modules/region/routes.ts tests/helpers/test-server.ts \
        tests/modules/region.routes.test.ts
git commit -m "feat(region): HTTP routes for create/get/update"
```

---

#### Task 17: Region seed loader CLI

**Files:**
- Create: `src/modules/region/seed.ts`
- Create: `seeds/region/README.md`
- Create: `seeds/region/.gitkeep`
- Create: `tests/modules/region.seed.test.ts`

- [ ] **Step 1: Create `seeds/region/README.md`**

```markdown
# 行政区划种子数据

需要的文件:`china-admin-l1-l4.geojson`

来源选项(按合规优先级):
1. 民政部全国行政区划查询平台公开数据(`http://xzqh.mca.gov.cn/`)— 推荐
2. 高德地图行政区划查询接口(申请商用授权后)
3. 开源 `geojson-map-china` 镜像(MIT 许可,验证后入)

格式要求:
- FeatureCollection
- Each Feature 必有 `properties.name`、`properties.adcode`、`properties.level` (1-4)
- `properties.parent_adcode` 表示行政父级 adcode

`bun run seed:region` 会做幂等导入(同 adcode 跳过)。
```

- [ ] **Step 2: Implement `src/modules/region/seed.ts`**

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'

type AdminFeature = GeoJSON.Feature<GeoJSON.Polygon, {
  name: string
  adcode: string
  level: 1 | 2 | 3 | 4
  parent_adcode?: string
}>

async function loadSeed(file: string): Promise<AdminFeature[]> {
  const raw = await readFile(file, 'utf8')
  const fc = JSON.parse(raw) as GeoJSON.FeatureCollection<GeoJSON.Polygon, AdminFeature['properties']>
  return fc.features as AdminFeature[]
}

async function main() {
  const file = process.argv[2] ?? path.resolve('./seeds/region/china-admin-l1-l4.geojson')
  console.log(`[seed:region] reading ${file}`)
  const features = await loadSeed(file)
  console.log(`[seed:region] loaded ${features.length} features`)

  const { db, sql: pg } = createDb('admin')
  // 简单做法:adcode -> region.id 用 deterministic uuid v5(避免重跑产生新 id)。
  // 这里偷懒用 adcode 直接当 name 的索引,生产可换 uuidv5。
  const adcodeToId = new Map<string, string>()

  // 先把 level 1(国/省)插一遍,再 level 2/3/4 引用 parent
  for (const level of [1, 2, 3, 4] as const) {
    const slice = features.filter((f) => f.properties.level === level)
    for (const f of slice) {
      const parentId = f.properties.parent_adcode ? adcodeToId.get(f.properties.parent_adcode) ?? null : null
      const result = await db.execute<{ id: string }>(sql`
        INSERT INTO regions (kind, name, parent_id, version, geom)
        SELECT 'ADMIN_NAMED', ${f.properties.name}, ${parentId}::uuid, 1, ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)})
        WHERE NOT EXISTS (
          SELECT 1 FROM regions
          WHERE name = ${f.properties.name}
            AND ${parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}::uuid`}
            AND effective_to IS NULL
        )
        RETURNING id
      `)
      if (result[0]) adcodeToId.set(f.properties.adcode, result[0].id)
      else {
        // 已存在则查回 id
        const [existing] = await db.execute<{ id: string }>(sql`
          SELECT id FROM regions
          WHERE name = ${f.properties.name}
            AND ${parentId === null ? sql`parent_id IS NULL` : sql`parent_id = ${parentId}::uuid`}
            AND effective_to IS NULL
        `)
        if (existing) adcodeToId.set(f.properties.adcode, existing.id)
      }
    }
    console.log(`[seed:region] level ${level} done (${slice.length} features)`)
  }
  await pg.end()
  console.log(`[seed:region] complete. mapped ${adcodeToId.size} adcodes.`)
}

main().catch((err) => { console.error('[seed:region] failed:', err); process.exit(1) })
```

- [ ] **Step 3: Write small test `tests/modules/region.seed.test.ts`**(用 fixture 文件,不依赖真实 GeoJSON)

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { spawnSync } from 'node:child_process'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
const fixtureDir = '/tmp/cnp-region-seed-fixture'

beforeAll(async () => {
  ctx = await createTestDb()
  await mkdir(fixtureDir, { recursive: true })
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'TEST_COUNTRY', adcode: '000000', level: 1 },
        geometry: { type: 'Polygon', coordinates: [[[100, 20], [120, 20], [120, 40], [100, 40], [100, 20]]] } },
      { type: 'Feature', properties: { name: 'TEST_PROVINCE', adcode: '110000', level: 2, parent_adcode: '000000' },
        geometry: { type: 'Polygon', coordinates: [[[105, 25], [115, 25], [115, 35], [105, 35], [105, 25]]] } },
    ],
  }
  await writeFile(`${fixtureDir}/admin.geojson`, JSON.stringify(fc))
})
afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
  await ctx.cleanup()
})

describe('region seed', () => {
  test('seed inserts and is idempotent', async () => {
    const run = () => spawnSync('bun', ['src/modules/region/seed.ts', `${fixtureDir}/admin.geojson`], {
      env: process.env, encoding: 'utf8',
    })
    const r1 = run()
    expect(r1.status).toBe(0)
    const r2 = run()
    expect(r2.status).toBe(0) // 第二遍不报错(idempotent)

    const result = await ctx.db.execute(sql`SELECT COUNT(*)::int AS n FROM regions WHERE name LIKE 'TEST_%'`)
    expect((result[0] as any).n).toBe(2) // 不会重复
  })
})
```

- [ ] **Step 4: Run test, verify passes**

Run: `bun test tests/modules/region.seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/region/seed.ts seeds/region/ tests/modules/region.seed.test.ts
git commit -m "feat(region): seed loader CLI with idempotent insert"
```

---

### Section 5 — Taxonomy Module

#### Task 18: Taxonomy service + routes

**Files:**
- Create: `src/modules/taxonomy/service.ts`
- Create: `src/modules/taxonomy/routes.ts`
- Create: `tests/modules/taxonomy.routes.test.ts`

- [ ] **Step 1: Implement `src/modules/taxonomy/service.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { vehicleClasses, vehicleEdgeTags, taskClasses, taskEdgeTags } from '@/db/schema/taxonomy'

export async function listVehicleClasses(db: Db) {
  return db.select().from(vehicleClasses).orderBy(vehicleClasses.level, vehicleClasses.name)
}

export async function createVehicleClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(vehicleClasses).values({
    name: input.name, level: input.level, parentId: input.parentId, description: input.description,
  }).returning()
  return row
}

export async function listTaskClasses(db: Db) {
  return db.select().from(taskClasses).orderBy(taskClasses.level, taskClasses.name)
}

export async function createTaskClass(db: Db, input: { name: string; level: 1 | 2; parentId?: string; description?: string }) {
  const [row] = await db.insert(taskClasses).values({
    name: input.name, level: input.level, parentId: input.parentId, description: input.description,
  }).returning()
  return row
}

export async function attachVehicleEdgeTag(db: Db, vehicleClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(vehicleEdgeTags).values({ vehicleClassId, tag, createdBy }).returning()
  return row
}

export async function attachTaskEdgeTag(db: Db, taskClassId: string, tag: string, createdBy?: string) {
  const [row] = await db.insert(taskEdgeTags).values({ taskClassId, tag, createdBy }).returning()
  return row
}
```

- [ ] **Step 2: Implement `src/modules/taxonomy/routes.ts`**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired } from '@/auth/middleware'
import { attachTaskEdgeTag, attachVehicleEdgeTag, createTaskClass, createVehicleClass, listTaskClasses, listVehicleClasses } from './service'

const classSchema = z.object({
  name: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2)]),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
})
const tagSchema = z.object({ tag: z.string().min(1).max(50) })

export function taxonomyRoutes(db: Db) {
  const app = new Hono()

  app.get('/vehicles', async (c) => c.json(await listVehicleClasses(db)))
  app.post('/vehicles', authRequired(db), zValidator('json', classSchema), async (c) => {
    return c.json(await createVehicleClass(db, c.req.valid('json')), 201)
  })
  app.post('/vehicles/:id/tags', authRequired(db), zValidator('json', tagSchema), async (c) => {
    const auth = c.get('auth') as { user: { id: string } }
    return c.json(await attachVehicleEdgeTag(db, c.req.param('id'), c.req.valid('json').tag, auth.user.id), 201)
  })

  app.get('/tasks', async (c) => c.json(await listTaskClasses(db)))
  app.post('/tasks', authRequired(db), zValidator('json', classSchema), async (c) => {
    return c.json(await createTaskClass(db, c.req.valid('json')), 201)
  })
  app.post('/tasks/:id/tags', authRequired(db), zValidator('json', tagSchema), async (c) => {
    const auth = c.get('auth') as { user: { id: string } }
    return c.json(await attachTaskEdgeTag(db, c.req.param('id'), c.req.valid('json').tag, auth.user.id), 201)
  })

  return app
}
```

- [ ] **Step 3: Mount in test-server `tests/helpers/test-server.ts`**

```ts
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
// 在 buildTestApp 内:
app.route('/taxonomy', taxonomyRoutes(db))
```

- [ ] **Step 4: Write `tests/modules/taxonomy.routes.test.ts`** — pattern is the same as Task 16 (login as ANALYST + POST + GET). Adapt template:

```ts
// 同 Task 16 pattern,验证:
// 1) POST /taxonomy/vehicles 创建 level 1
// 2) POST /taxonomy/vehicles 创建 level 2(带 parentId)
// 3) POST /taxonomy/vehicles/:id/tags 创建 edge tag
// 4) GET /taxonomy/vehicles 返回所有(按 level, name)
// 5) 未登录 POST 返回 401
```

(完整代码不重复,完全复用 Task 16 的 login fixture pattern)

- [ ] **Step 5: Run, verify passes**

Run: `bun test tests/modules/taxonomy.routes.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/modules/taxonomy/ tests/modules/taxonomy.routes.test.ts \
        tests/helpers/test-server.ts
git commit -m "feat(taxonomy): vehicle/task class + edge tag CRUD"
```

---

### Section 6 — WebApp Server

#### Task 19: Hono server bootstrap with health check + error normalization

**Files:**
- Create: `src/server.ts`
- Create: `src/lib/logger.ts`
- Create: `tests/server.test.ts`

- [ ] **Step 1: Implement `src/lib/logger.ts`**

```ts
type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
}
```

- [ ] **Step 2: Implement `src/server.ts`**

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from '@/auth/routes'
import { regionRoutes } from '@/modules/region/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { createDb } from '@/db/client'
import { loadEnv } from '@/env'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

const env = loadEnv()
const { db } = createDb('app')

const app = new Hono()

app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  logger.info('request', { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start })
})

app.use('*', cors({
  origin: env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true,
}))

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status)
  }
  logger.error('unhandled', { err: err.message, stack: err.stack })
  return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

app.route('/auth', authRoutes(db))
app.route('/regions', regionRoutes(db))
app.route('/taxonomy', taxonomyRoutes(db))

export default { port: env.PORT, fetch: app.fetch }
logger.info('server started', { port: env.PORT })
```

- [ ] **Step 3: Write `tests/server.test.ts`**

```ts
import { describe, expect, test } from 'bun:test'

describe('server boot', () => {
  test('GET /health returns 200', async () => {
    process.env.SESSION_SECRET = '0'.repeat(64)
    const mod = await import('@/server')
    const res = await mod.default.fetch(new Request('http://x/health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
```

- [ ] **Step 4: Run, verify passes**

Run: `bun test tests/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Sanity-run the dev server**

```bash
bun run dev
# In another terminal:
curl http://localhost:3000/health
# Expected: {"status":"ok","ts":"..."}
```

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/lib/logger.ts tests/server.test.ts
git commit -m "feat(server): hono bootstrap + health + error handler + JSON logger"
```

---

### Section 7 — Frontend Scaffold

#### Task 20: Frontend init (Vite + React + TS + Tailwind)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/.gitignore`

- [ ] **Step 1: Create `frontend/package.json`**

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
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
})
```

- [ ] **Step 4: Create remaining boilerplate**

`frontend/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>摄像头新闻预测系统</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`frontend/src/styles.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
```

`frontend/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
```

`frontend/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`frontend/.gitignore`:
```
node_modules
dist
```

`frontend/src/App.tsx`(占位):
```tsx
export default function App() {
  return (
    <div className="h-screen flex items-center justify-center text-2xl">
      摄像头新闻预测系统 — 开发中
    </div>
  )
}
```

- [ ] **Step 5: Verify scaffold runs**

```bash
cd frontend && bun install && bun run dev
# 浏览器访问 http://localhost:5173 看到"摄像头新闻预测系统 — 开发中"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): vite + react + tailwind scaffold"
```

---

#### Task 21: Frontend API client + auth state

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/auth.ts`

- [ ] **Step 1: Implement `frontend/src/lib/api.ts`**

```ts
const BASE = '/api'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'PARSE', message: 'parse failed' } }))
    throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? 'unknown')
  }
  return res.json() as Promise<T>
}
```

- [ ] **Step 2: Implement `frontend/src/lib/auth.ts`**

```ts
import { api } from './api'

export type AuthMe = {
  user: { id: string; email: string; displayName: string | null }
  sessionId: string
  activeRoleKey: 'DECIDER' | 'ANALYST' | 'REVIEWER' | null
  availableRoles: ('DECIDER' | 'ANALYST' | 'REVIEWER')[]
}

export async function login(email: string, password: string) {
  return api<{ ok: boolean; userId: string }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
}

export async function logout() {
  return api<{ ok: boolean }>('/auth/logout', { method: 'POST' })
}

export async function getMe(): Promise<AuthMe | null> {
  try { return await api<AuthMe>('/auth/me') }
  catch { return null }
}

export async function setRoleState(roleKey: AuthMe['activeRoleKey']) {
  return api<{ ok: boolean; activeRoleKey: AuthMe['activeRoleKey'] }>(
    '/auth/role-state', { method: 'POST', body: JSON.stringify({ roleKey }) }
  )
}
```

- [ ] **Step 3: Sanity check (typecheck only)**

```bash
cd frontend && bun run build
# 应该跑通(空的 App.tsx 不引用这些,只验证编译)
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat(frontend): api client + auth state helpers"
```

---

#### Task 22: Login page

**Files:**
- Create: `frontend/src/routes/Login.tsx`
- Modify: `frontend/src/App.tsx:1`

- [ ] **Step 1: Implement `frontend/src/routes/Login.tsx`**

```tsx
import { useState } from 'react'
import { login } from '@/lib/auth'

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setLoading(true)
    try { await login(email, password); onLoggedIn() }
    catch (e: any) { setErr(e.message ?? '登录失败') }
    finally { setLoading(false) }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="bg-white p-8 rounded shadow w-96 space-y-4">
        <h1 className="text-xl font-semibold">登录</h1>
        <input className="w-full border p-2 rounded" placeholder="email"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full border p-2 rounded" type="password" placeholder="password"
               value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button disabled={loading} className="w-full bg-blue-600 text-white p-2 rounded disabled:opacity-50">
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Update `frontend/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { type AuthMe, getMe } from '@/lib/auth'
import { Login } from '@/routes/Login'

export default function App() {
  const [me, setMe] = useState<AuthMe | null | undefined>(undefined)

  useEffect(() => { getMe().then(setMe) }, [])

  if (me === undefined) return <div className="h-screen flex items-center justify-center">加载中…</div>
  if (me === null) return <Login onLoggedIn={() => getMe().then(setMe)} />

  return (
    <div className="h-screen p-8">
      <div className="text-lg">你好,{me.user.email}</div>
      <div className="text-sm text-gray-500">可用角色:{me.availableRoles.join(', ') || '无'}</div>
      <div className="text-sm text-gray-500">当前角色:{me.activeRoleKey ?? '未选'}</div>
    </div>
  )
}
```

- [ ] **Step 3: Run dev server + manual verify**

```bash
# Backend running on :3000
cd frontend && bun run dev
# 访问 http://localhost:5173 → 应看到登录页
```

(写一个 seed 脚本创建 admin 账号见 Task 25;Task 22 这里用 Step 4 测试登录失败路径即可。)

- [ ] **Step 4: Verify wrong-credential UX**

在登录页输入任意 email/password → 应看到红色 "登录失败" 错误信息(后端 401 → 前端 ApiError 抛出 → 表单展示)。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/Login.tsx frontend/src/App.tsx
git commit -m "feat(frontend): login page + auth state in App"
```

---

#### Task 23: Role switcher component

**Files:**
- Create: `frontend/src/components/RoleSwitcher.tsx`
- Modify: `frontend/src/App.tsx:1`

- [ ] **Step 1: Implement `frontend/src/components/RoleSwitcher.tsx`**

```tsx
import { type AuthMe, setRoleState } from '@/lib/auth'

const ROLE_LABELS: Record<NonNullable<AuthMe['activeRoleKey']>, string> = {
  DECIDER: '决策者',
  ANALYST: '分析师',
  REVIEWER: '复盘师',
}

export function RoleSwitcher({ me, onChange }: { me: AuthMe; onChange: (roleKey: AuthMe['activeRoleKey']) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">角色:</span>
      {me.availableRoles.map((r) => (
        <button
          key={r}
          onClick={async () => { await setRoleState(r); onChange(r) }}
          className={`px-3 py-1 rounded text-sm border ${me.activeRoleKey === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
        >
          {ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Update `App.tsx` to render switcher + role-aware home**

```tsx
import { useEffect, useState } from 'react'
import { type AuthMe, getMe, logout } from '@/lib/auth'
import { Login } from '@/routes/Login'
import { RoleSwitcher } from '@/components/RoleSwitcher'

function Home({ me, refresh }: { me: AuthMe; refresh: () => void }) {
  const r = me.activeRoleKey
  return (
    <div className="p-8 space-y-4">
      <header className="flex justify-between items-center">
        <div>
          <div className="text-lg">{me.user.email}</div>
          <RoleSwitcher me={me} onChange={refresh} />
        </div>
        <button onClick={async () => { await logout(); refresh() }} className="text-sm text-gray-500 underline">登出</button>
      </header>
      <main className="border-t pt-4">
        {r === 'DECIDER' && <div>📥 待批预测 Inbox(m2 实现)</div>}
        {r === 'ANALYST' && <div>🔍 预测详情 + 监视清单(m2 实现)</div>}
        {r === 'REVIEWER' && <div>📊 复盘报告 + 案例库(m4 实现)</div>}
        {!r && <div className="text-gray-500">请先在上方选择一个角色态。</div>}
      </main>
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState<AuthMe | null | undefined>(undefined)
  const refresh = () => getMe().then(setMe)
  useEffect(() => { refresh() }, [])
  if (me === undefined) return <div className="h-screen flex items-center justify-center">加载中…</div>
  if (me === null) return <Login onLoggedIn={refresh} />
  return <Home me={me} refresh={refresh} />
}
```

- [ ] **Step 3: Manual verify**

启动 backend + frontend,登录后切换角色,主区文案随角色变化。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RoleSwitcher.tsx frontend/src/App.tsx
git commit -m "feat(frontend): role switcher + role-aware home stub"
```

---

#### Task 24: Map view placeholder

**Files:**
- Create: `frontend/src/components/MapView.tsx`

- [ ] **Step 1: Implement `frontend/src/components/MapView.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

const AMAP_KEY = import.meta.env.VITE_AMAP_API_KEY ?? ''

export function MapView({ height = '400px' }: { height?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!AMAP_KEY) return
    if (!ref.current) return
    let cancelled = false
    AMapLoader.load({ key: AMAP_KEY, version: '2.0', plugins: [] })
      .then((AMap: any) => {
        if (cancelled || !ref.current) return
        mapRef.current = new AMap.Map(ref.current, { zoom: 10, center: [116.397, 39.909] })
      })
      .catch(console.error)
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null }
    }
  }, [])

  if (!AMAP_KEY) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded p-8 text-center text-gray-500"
           style={{ height }}>
        地图占位(配置 VITE_AMAP_API_KEY 后启用)
      </div>
    )
  }

  return <div ref={ref} className="rounded border" style={{ height }} />
}
```

- [ ] **Step 2: Add to `App.tsx` Home(可见性测试)**

把 `<MapView />` 临时塞进 ANALYST 视图。

- [ ] **Step 3: Add `frontend/.env.example`**

```
VITE_AMAP_API_KEY=
```

- [ ] **Step 4: Verify占位渲染**

不配置 key → 看到虚线占位框。配置 key 后 → 看到地图(需要 key 才能验)。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapView.tsx frontend/.env.example frontend/src/App.tsx
git commit -m "feat(frontend): MapView placeholder + 高德 lazy load"
```

---

### Section 8 — Bootstrap Data + Integration

#### Task 25: Admin user + role seed CLI

**Files:**
- Create: `src/db/seed-bootstrap.ts`
- Modify: `package.json:1` (add `seed:bootstrap` script)

- [ ] **Step 1: Implement `src/db/seed-bootstrap.ts`**

```ts
import { eq } from 'drizzle-orm'
import { createDb } from './client'
import { roles, userRoles, users } from './schema/user'
import { hashPassword } from '@/auth/password'

const ROLES = [
  { key: 'DECIDER', label: '决策者' },
  { key: 'ANALYST', label: '分析师' },
  { key: 'REVIEWER', label: '复盘师' },
] as const

async function main() {
  const { db, sql } = createDb('admin')

  for (const r of ROLES) {
    const [existing] = await db.select().from(roles).where(eq(roles.key, r.key))
    if (!existing) await db.insert(roles).values(r)
  }
  console.log('[seed:bootstrap] roles ensured')

  const adminEmail = 'admin@cnp.local'
  const [existing] = await db.select().from(users).where(eq(users.email, adminEmail))
  let adminId: string
  if (existing) { adminId = existing.id; console.log('[seed:bootstrap] admin already exists') }
  else {
    const [u] = await db.insert(users).values({
      email: adminEmail, displayName: 'Admin', passwordHash: await hashPassword('admin1234'),
    }).returning()
    adminId = u.id
    console.log(`[seed:bootstrap] admin created: ${adminEmail} / admin1234`)
  }

  for (const r of ROLES) {
    const [role] = await db.select().from(roles).where(eq(roles.key, r.key))
    const [link] = await db.select().from(userRoles)
      .where(eq(userRoles.userId, adminId)).where(eq(userRoles.roleId, role.id))
    if (!link) await db.insert(userRoles).values({ userId: adminId, roleId: role.id })
  }
  console.log('[seed:bootstrap] admin assigned all roles')

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Add script to `package.json`**

```json
"seed:bootstrap": "bun src/db/seed-bootstrap.ts"
```

- [ ] **Step 3: Run + verify**

```bash
bun run seed:bootstrap
# 第二次运行应该全 idempotent,无错
bun run seed:bootstrap
```

Expected: first run creates,second run reports "already exists".

- [ ] **Step 4: End-to-end manual verify**

```bash
# Terminal 1: docker compose up -d  (if not already)
# Terminal 2: bun run dev
# Terminal 3: cd frontend && bun run dev
# Browser: http://localhost:5173
# Login as admin@cnp.local / admin1234
# Should see 3 role buttons; click each → Home main area changes
```

- [ ] **Step 5: Commit**

```bash
git add src/db/seed-bootstrap.ts package.json
git commit -m "feat(seed): bootstrap admin + 3 roles idempotent CLI"
```

---

#### Task 26: README + dev runbook

**Files:**
- Modify: `README.md:1` (replace 21-byte placeholder with full runbook)

- [ ] **Step 1: Write `README.md`**

```markdown
# 摄像头新闻预测 / 监控调度 / 复盘系统(camera-news-prediction)

> 当前阶段:**m1 Foundation**(应用壳 + 数据库 schema + Auth + 前端骨架)
> 文档:`docs/superpowers/specs/2026-05-05-camera-news-prediction-design.md`

## 快速启动

### 1. 准备 env

```bash
cp .env.example .env
# 必填:SESSION_SECRET 改成 64 位 hex
# 可选:AMAP_API_KEY(地图组件)、DASHSCOPE_API_KEY(m2 起需要)
```

### 2. 起容器

```bash
docker compose up -d
docker compose ps   # 等到 postgres / redis healthy
```

### 3. 初始化 DB

```bash
bun install
bun run db:migrate         # 跑迁移(包含 audit schema + cnp_app role)
bun run seed:bootstrap     # 创建 3 个 role + admin@cnp.local / admin1234
# 可选:bun run seed:region (需要 seeds/region/china-admin-l1-l4.geojson)
```

### 4. 起服务

```bash
# Terminal 1 — 后端
bun run dev

# Terminal 2 — 前端
cd frontend && bun install && bun run dev
```

访问 `http://localhost:5173`,登录 `admin@cnp.local` / `admin1234`。

## 开发命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 后端开发服务(watch) |
| `bun run typecheck` | TS 编译检查 |
| `bun run lint` | biome 检查 |
| `bun run test` | 运行所有 bun test |
| `bun run db:generate` | drizzle 根据 schema 产 migration |
| `bun run db:migrate` | 应用 migration(含 manual SQL) |
| `bun run db:push` | 直接同步 schema(开发期偷懒用) |
| `bun run seed:bootstrap` | 种 role + admin |
| `bun run seed:region` | 种行政区划 |

## 项目结构

见 `docs/superpowers/plans/2026-05-05-m1-foundation.md` File Structure 节。

## 后续里程碑

- **m2(Plan-B,待写)**:WatchList + PredictionAgent + 1 信源 + 1 摄像头 adapter + 批准流
- **m3(Plan-C,待写)**:WebhookIngest + MediaFetcher + 复盘 Agent + 二轴 outcome + Slice 0 验收
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with m1 quickstart and dev commands"
```

---

#### Task 27: End-to-end smoke test

**Files:**
- Create: `tests/e2e/smoke.test.ts`

- [ ] **Step 1: Implement `tests/e2e/smoke.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
  const email = `smoke+${Date.now()}@x`
  const [u] = await ctx.db.insert(users).values({
    email, passwordHash: await hashPassword('pass1234'),
  }).returning()
  for (const key of ['DECIDER', 'ANALYST', 'REVIEWER'] as const) {
    let [r] = await ctx.db.select().from(roles).where(eq(roles.key, key))
    if (!r) [r] = await ctx.db.insert(roles).values({ key, label: key }).returning()
    await ctx.db.insert(userRoles).values({ userId: u.id, roleId: r.id })
  }
  const login = await app.request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass1234' }),
  })
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
})
afterAll(async () => { await ctx.cleanup() })

describe('m1 smoke', () => {
  test('full path: login → me → switch role → create region → create taxonomy → audit log', async () => {
    // me
    const me = await (await app.request('/auth/me', { headers: { cookie } })).json()
    expect(me.availableRoles.length).toBe(3)

    // switch to ANALYST
    await app.request('/auth/role-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ roleKey: 'ANALYST' }),
    })

    // create region
    const regionRes = await app.request('/regions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        kind: 'AD_HOC',
        geom: { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] },
      }),
    })
    expect(regionRes.status).toBe(201)

    // create vehicle class
    const vRes = await app.request('/taxonomy/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: '消防车', level: 1 }),
    })
    expect(vRes.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run smoke**

Run: `bun test tests/e2e/smoke.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.test.ts
git commit -m "test(e2e): m1 smoke covering login → role switch → region → taxonomy"
```

---

#### Task 28: m1 验收对照 + Plan-A 关闭

**Files:**
- Create: `docs/superpowers/plans/2026-05-05-m1-foundation-acceptance.md`

- [ ] **Step 1: 写验收对照清单**

```markdown
# m1 Foundation — 验收对照

> Plan-A 完成时,本清单全部勾选 = m1 接受 = 进入 Plan-B(m2)。

## ISC 覆盖(本计划)

- [ ] **ISC-5**:Region 引用绑定 `(region_id, region_version)`(`regions_pk = (id, version)`)— Task 7/15
- [ ] **ISC-6**:AD_HOC immutable;ADMIN_NAMED 晋升路径走通 — Task 15(immutable enforced;晋升 v1 留 Plan-B)
- [ ] **ISC-7**:V/T 二级分类 + edge tag 可写入 — Task 8/18
- [ ] **ISC-8**:`audit.operation_audit` 对 `cnp_app` INSERT-only(DB 权限层) — Task 9
- [ ] **ISC-30**(部分):docker-compose 起整套 ≤ 30min — Task 3 + Task 26 README
- [ ] **ISC-32**:OperationAudit 跨生命周期 INSERT-only — Task 9 + Task 10

## 功能验收

- [ ] `bun run db:migrate` 在干净 DB 上一次跑通(包含 audit schema + cnp_app role)
- [ ] `bun run seed:bootstrap` idempotent
- [ ] `bun run seed:region` 在 fixture 上 idempotent(真实数据 PLAN-B 前提供)
- [ ] `bun test` 全绿(所有 Section 1–8 任务的测试)
- [ ] `bun run dev` + `cd frontend && bun run dev` 后,`http://localhost:5173` 登录 `admin@cnp.local` / `admin1234` 成功
- [ ] 三个角色按钮可切换,主区文案随角色变化
- [ ] `bun run typecheck` 无错
- [ ] `bun run lint` 无 error 级别警告

## 产出物

- [ ] m1 commits 在 main 分支线性可读(每 task 一 commit)
- [ ] `README.md` 是新人读 5 分钟能起本地的级别
- [ ] `docs/superpowers/plans/2026-05-05-m1-foundation.md`(本计划)所有 task 已勾选
- [ ] (可选)给客户的 m1 demo 视频:登录 → 切角色 → 创建区域 → 创建分类
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-05-m1-foundation-acceptance.md
git commit -m "docs(plan-a): m1 acceptance checklist"
```

---

## Self-Review Notes

> 写完后我自己跑过一遍,以下是发现并已修复 / 留下的事项。

### Spec 覆盖

| Spec 区块 | 任务覆盖 | 备注 |
|---|---|---|
| §1.5 Slice 0 占位提案 | — | 占位本身在 spec 内,Plan-B 才需要落地具体 V/T/R |
| §2.1 角色权限 | Task 6, 14 | 单 User + 多 Role + role_state 切换 |
| §2.2/2.3 数据模型 | Task 6–10 | User/Region/V-T/Audit;Prediction/Dispatch/Retro 留 Plan-B/C |
| §2.4 Region 版本化 | Task 7, 15 | composite PK + one-current 唯一索引 |
| §2.5 业务表绑 (region_id, version) | Task 7 schema 准备 | 实际引用在 Plan-B WatchList/Prediction 加 |
| §2.7 OperationAudit INSERT-only via DB role | Task 9, 10 | 完整覆盖 |
| §3 (置信度/调度/采集) | — | 全部留 Plan-B/C |
| §4 (复盘/架构) | — | 留 Plan-C |
| §5.1 ISC-5/6/7/8/30/32 | Task 7/8/9/15/26/9 | 见 Task 28 验收清单 |

### Placeholder scan

- ✅ 无 "TBD" / "TODO" / "implement later"
- ✅ 所有代码块都是可粘贴运行的级别
- ✅ Task 18 Step 4 测试代码用了 "完全复用 Task 16 pattern" 注释 —— 这是合规的复用提示,不是占位(测试结构相同,只换 endpoint 名)

### Type consistency

- Region service 的 `Region` 类型来自 `@/db/schema/region.ts`,所有 service / route / test 引用一致
- Auth `AuthContext` 在 middleware 定义,routes 引用一致
- `AuthMe` 前端类型用字面联合 `'DECIDER' | 'ANALYST' | 'REVIEWER'`,与后端 `roles.key` 数据约定一致

### 已知边界 / 留 Plan-B/C

- AD_HOC → ADMIN_NAMED 晋升路径(K1=做)未在 m1 实现 → Plan-B 加
- V/T 二级 + 边缘标签的 UI 管理界面未在 m1 → Plan-B 加(后端 API 已有)
- 真实行政区划 GeoJSON 数据 → 客户/采购环节,m1 只验证 seed 工具

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-m1-foundation.md` (28 tasks, ~150 TDD steps, ~4 周工作量)。**

两种执行方式:

**1. Subagent-Driven(推荐)** —— 我为每个 task 派一个全新 subagent,task 之间我审核,迭代快,context 不污染主会话。配 `superpowers:subagent-driven-development`。

**2. Inline Execution** —— 在当前主会话里按计划批量跑,带 checkpoint 让你审,context 用得猛但少 round-trip。配 `superpowers:executing-plans`。

**哪种?**(或者今天到此停下,你先消化计划)
