# Docker 部署 — Mac ARM(Apple Silicon)

一条命令把前后端 + Postgres+PostGIS + Redis 全部拉起。

## 前置

- macOS 12+,M1/M2/M3/M4 芯片
- Docker Desktop 4.30+(或 OrbStack / Colima)
- 端口 3000 / 5432 / 6379 空闲

## 启动

```bash
# 1. 拷一份 docker env(只需做一次)
cp .env.docker.example .env.docker
#   生产部署请改 SESSION_SECRET + DASHSCOPE_API_KEY / TAVILY_API_KEY

# 2. 构建镜像(首次 ~2 min,frontend build ~30s + bun install ~60s)
bun run docker:build

# 3. 启动
bun run docker:up

# 4. 看日志确认 4 容器都 healthy
bun run docker:ps
bun run docker:logs
```

打开浏览器 → **http://localhost:3000**

默认管理员账号:`admin@cnp.local` / `admin1234`

## 容器拓扑

| 服务 | 镜像 | 端口 |
|---|---|---|
| `cnp-app` | `cnp:latest`(本地 Dockerfile) | 3000(API + 前端 SPA) |
| `cnp-scheduler` | `cnp:latest`(同 image,bullmq workers) | — |
| `cnp-postgres` | `imresamu/postgis:16-3.4-alpine`(ARM 多架构) | 5432 |
| `cnp-redis` | `redis:7-alpine` | 6379 |

## 数据持久化

Postgres 数据挂在 named volume `cnp-pg-data`。

- 保留数据重启:`bun run docker:down && bun run docker:up`
- 彻底清空:`docker compose --env-file .env.docker down -v`(`-v` 删 volumes,小心!)

## 首次启动会做什么

`scripts/docker-entrypoint.sh` 自动:
1. `pg_isready` 等数据库
2. 跑 drizzle migrations
3. 创建 admin 用户(idempotent)
4. 种 10 L1 + 59 L2 中文车辆类型库(idempotent)
5. 启动 Hono on port 3000

之后 `cnp-scheduler` 容器启动,跑 BullMQ workers(news-ingest tick、retrospective tick 等)。

## 路由

- `GET /` → 前端 SPA(index.html)
- `GET /assets/*` → 前端打包后的 JS/CSS
- `GET /api/health` → `{"status":"ok"}`
- `GET /api/auth/*`、`/api/predictions/*`、`/api/admin/*` 等 — 后端 API

## 故障排查

| 现象 | 排查 |
|---|---|
| app 容器 unhealthy | `docker compose logs app` 看 migration 是否失败 |
| `pg_isready` 超时 | postgres 容器还在初始化,等 30s 重试 `bun run docker:up` |
| 前端 404 | 进 `cnp-app` 容器 `ls /app/frontend/dist`,有 index.html 就是 OK |
| LLM degraded 提示 | `DASHSCOPE_API_KEY` 没配,extract 会返空 — demo 行为正确 |
| `搜索` 阶段 0 hit | `SEARCH_API_KIND=mock` 默认无新闻,改为 `tavily` 并填 `TAVILY_API_KEY` |

## 推送到 registry(可选)

```bash
docker tag cnp:latest your-registry/cnp:v1.0
docker push your-registry/cnp:v1.0
```

镜像本身是 `linux/arm64`(在 M 系列构建)。如需 amd64,Docker Desktop 启用 buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/cnp:v1.0 --push .
```
