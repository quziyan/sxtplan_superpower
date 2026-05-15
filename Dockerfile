# syntax=docker/dockerfile:1.7
# Plan-PP docker:multi-stage,frontend build → bun runtime,目标 linux/arm64(M 系列)
# 也支持 linux/amd64(image 多架构)

# ─── Stage 1: 前端构建 ────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS frontend-build

WORKDIR /app/frontend

# Plan-PP fix10:Vite VITE_* env 是 build-time 烤进 bundle 的,需 ARG → ENV 透传
ARG VITE_AMAP_API_KEY=""
ENV VITE_AMAP_API_KEY=${VITE_AMAP_API_KEY}

# 仅拷贝 lockfile + package.json 先装依赖,利用 layer 缓存
COPY frontend/package.json frontend/bun.lock* frontend/bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

# 拷源码并 build(frontend/public 在本项目里不存在,跳过)
COPY frontend/tsconfig*.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src

# 直接调 vite build,跳过 tsc -b(类型检查在 CI 跑;镜像内只做产物)
RUN bunx vite build
# 产物在 /app/frontend/dist


# ─── Stage 2: 后端 runtime ────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS runtime

WORKDIR /app

# 安装运行时依赖:libpq(pg_isready 用)+ bash
RUN apk add --no-cache postgresql-client bash

# 后端依赖
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production || bun install --production

# 后端源码
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

# 前端 dist 从 stage 1 拷过来
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# entrypoint 脚本
COPY scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh
RUN chmod +x /app/scripts/docker-entrypoint.sh

EXPOSE 3000

# 默认 app 命令(scheduler 容器在 compose 里覆盖)
CMD ["sh", "/app/scripts/docker-entrypoint.sh"]
