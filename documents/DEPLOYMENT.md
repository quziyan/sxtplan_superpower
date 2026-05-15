# 新机器 Docker 部署指南

> 项目:**CNP — 新闻驱动的车辆调度预测系统**  
> 目标:在一台**新 Mac (Apple Silicon)** 或 **Linux/amd64** 服务器上,从零拉起完整运行的 4 容器栈(app + scheduler + postgres + redis),浏览器访问 `http://<host>:3000` 即用。  
> 部署耗时:首次约 8 分钟(含镜像拉取 / build / migrate / seed)。

---

## 1. 前置环境

| 项 | 要求 | 验证命令 |
|---|---|---|
| 操作系统 | macOS 12+ Apple Silicon(M1/M2/M3/M4)/ Linux x86_64 / Linux arm64 | `uname -sm` |
| Docker | Docker Desktop 4.30+ 或 OrbStack / Colima | `docker --version` ≥ 24.0 |
| Docker Compose | v2(`docker compose` 子命令,不是 `docker-compose`) | `docker compose version` |
| Git | 任意版本 | `git --version` |
| 空闲端口 | **3000 / 5432 / 6379** 必须未被占用 | `lsof -i:3000 -i:5432 -i:6379` 应无输出 |
| 磁盘 | ≥ 4 GB 可用(镜像约 600 MB + 数据持久卷) | `df -h` |
| 内存 | ≥ 4 GB 可用给 Docker(scheduler + LLM 调用) | Docker Desktop → Resources |

> **Apple Silicon 备注**:`docker-compose.yml` 已指定 ARM 多架构镜像(`imresamu/postgis:16-3.4-alpine`、`oven/bun:1.3-alpine`、`redis:7-alpine`),无需 Rosetta。

---

## 2. 获取代码

```bash
# 拉项目(假设已在 GitHub / 内部 Git 上)
git clone <repo-url> cnp
cd cnp

# 项目根应该有这几个关键文件
ls -1 Dockerfile docker-compose.yml .env.docker.example scripts/docker-entrypoint.sh
```

如果上面 5 个文件全在,环境就是干净的。

---

## 3. 配置环境变量(关键一步)

```bash
cp .env.docker.example .env.docker
```

打开 `.env.docker`,把下表里 **必填** 的 key 全部填上。

### 3.1 必填项

| 变量 | 用途 | 不填的后果 | 获取方式 |
|---|---|---|---|
| `SESSION_SECRET` | Cookie 加密 | 服务可启动但生产不安全 | 任意 ≥ 32 字节随机串,如 `openssl rand -hex 32` |
| `YUNWU_API_KEY` | 搜索新闻(Yunwu 代理调 Gemini Search Grounding) | 搜索阶段空召回,流水线全 0 | 见 §5.1 |
| `LLM_API_KEY` | LLM 精排 + 抽取预测(dashscope deepseek) | rerank / extract 全部 `llmDegraded`,生成 0 条预测 | 见 §5.2 |
| `AMAP_GEOCODE_KEY` | 后端地名 → 坐标(预测区域真实定位) | 区域字段都是默认"通用区域",无 polygon | 见 §5.3 |
| `VITE_AMAP_API_KEY` | 前端浏览器地图底图(JS API) | 区域弹窗只显 SVG 草图,无高德底图 | 见 §5.4(**build-time** 烤入 bundle,改完必须 `docker compose build`) |

### 3.2 推荐保留默认

| 变量 | 默认 | 说明 |
|---|---|---|
| `SEARCH_API_KIND` | `yunwu-dr` | 当前最优,中文新闻召回质量好 |
| `YUNWU_MODEL` | `gemini-2.5-flash-all` | `-all` 后缀启用 Google Search Grounding |
| `YUNWU_TIMEOUT_MS` | `180000` | DeepResearch 较慢,180s 给足余量 |
| `LLM_MODEL` | `deepseek-v4-flash` | 阿里云 dashscope 默认 |
| `LLM_TIMEOUT_MS` | `30000` | 30s 够用 |
| `NEWS_FRESHNESS_DAYS` | `30` | 新闻保留最近 30 天 |
| `RELEVANCE_THRESHOLD` | `50` | LLM 精排阈值;前端面板可改 |

### 3.3 可选(demo 阶段 mock 即可)

`TAVILY_API_KEY` / `BING_NEWS_API_KEY` / `OSS_*` 全留空走 mock,不影响主流程。

---

## 4. 启动栈

```bash
# 1) 构建镜像(首次约 2-3 min,后续 layer 缓存 ~30s)
docker compose --env-file .env.docker build app

# 2) 拉起 4 容器
docker compose --env-file .env.docker up -d

# 3) 等 healthy(约 30-60s 含 migrations + seed)
watch -n 2 'docker compose ps'
# 看到 cnp-app / cnp-postgres / cnp-redis 都是 (healthy) 就 OK
# 按 Ctrl+C 退出 watch
```

### 启动会自动做什么

`scripts/docker-entrypoint.sh` 在 app 容器内串行执行:

1. `pg_isready` 轮询等数据库就绪(最多 60s,每秒一次)
2. 跑 `bun src/db/migrate.ts`(先 `migrations/manual/*.sql`,再 drizzle `migrations/*.sql`,60+ 表 schema 创建)
3. `bun src/db/seed-bootstrap.ts` 创建 admin 用户 `admin@cnp.local` / `admin1234`(幂等,失败 continue)
4. `bun scripts/seed-vehicle-taxonomy.ts` 灌车辆类型库(10 个 L1 大类 + 59 个 L2 子类,中文,幂等,失败 continue)
5. `exec bun src/server.ts` 启动 Hono on port 3000

`cnp-scheduler` 容器额外启动 BullMQ workers:`refresh / news-ingest / news-extract / news-triage / dispatch / media-fetch / retrospective` + 5 个 tick(`cadence / retrospective / auto-cancel / news-ingest / lifecycle`)。

---

## 5. 三把 Key 详细申请步骤

### 5.1 Yunwu API key(搜索)

1. 注册账号:`https://yunwu.ai`(支付宝/手机号登录,可能需要支付一点 demo 额度)
2. 控制台 → API Keys → 新建 → 复制 `sk-...` 开头的 key
3. 填到 `.env.docker`:
   ```
   YUNWU_API_KEY=sk-你的key
   ```

> 也可改用 Tavily(`SEARCH_API_KIND=tavily` + `TAVILY_API_KEY=tvly-...`),但实测 Yunwu+Gemini 召回质量更高。

### 5.2 阿里云 dashscope key(LLM 精排 + 抽取)

1. 注册:`https://dashscope.aliyuncs.com` → 实名认证
2. 控制台 → API-KEY 管理 → 创建新 Key
3. 复制 `sk-...` 开头的 key
4. 模型开通:控制台 → 模型广场 → 找 **`deepseek-v4-flash`** → 一键开通(免费试用额度)
5. `.env.docker` **填两份**(代码两处分别读):
   ```
   DASHSCOPE_API_KEY=sk-你的key
   LLM_API_KEY=sk-你的key
   LLM_MODEL=deepseek-v4-flash
   LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
   ```

### 5.3 高德 Web 服务 key(后端 geocoder)

1. 注册:`https://console.amap.com` → 实名认证
2. 控制台 → 应用管理 → **创建新应用**(随便起名 cnp)
3. 应用列表里点 **「添加 Key」** → 服务平台选 **「Web 服务」** → 创建
4. 复制 32 位 key:
   ```
   AMAP_GEOCODE_KEY=32位key
   ```

### 5.4 高德 JS API key(前端地图底图)

1. **同一个应用下**点 **「添加 Key」** → 服务平台选 **「Web 端(JS API)」**(不是 Web 服务!)
2. 白名单域名:填 `localhost` + 部署域名(开发期留空亦可)
3. 复制 32 位 key:
   ```
   VITE_AMAP_API_KEY=32位JSAPI_key
   ```
4. ⚠ **关键**:VITE_* 是 build-time 变量,填完必须 **重新 build** 镜像:
   ```bash
   docker compose --env-file .env.docker build app
   docker compose --env-file .env.docker up -d --force-recreate --no-deps app
   ```

> 配额:个人开发者 geocode 5000 次/日,JS API 加载 ~30k 次/日。Demo 完全够用。

---

## 6. 验证

### 6.1 容器状态

```bash
docker compose ps
```

期望输出(都是 `Up (healthy)`,`cnp-scheduler` 没有 healthcheck 显示 `Up`):

```
cnp-app         cnp:latest                       Up XX min (healthy)   0.0.0.0:3000->3000/tcp
cnp-scheduler   cnp:latest                       Up XX min
cnp-postgres    imresamu/postgis:16-3.4-alpine   Up XX min (healthy)   0.0.0.0:5432->5432/tcp
cnp-redis       redis:7-alpine                   Up XX min (healthy)   0.0.0.0:6379->6379/tcp
```

### 6.2 API 健康

```bash
curl -s http://localhost:3000/api/health
# 期望:{"status":"ok","ts":"2026-..."}
```

### 6.3 浏览器登录

打开 `http://localhost:3000`,用 `admin@cnp.local` / `admin1234` 登录,应看到「分析师工作台」。

### 6.4 端到端预测生成

1. 工作台左侧建一个监视清单(车类 + 任务 + 区域),加几个中文关键词如 `广州 重要活动`
2. 顶部点 **「📡 生成预测」**
3. 进度条结束后看流水线漏斗,每阶段保留数应 > 0
4. 等待一两分钟,「待审」表格出现条目
5. 点任意行 → 详情面板 → 区域字段是高德定位的真实地点 → 点击弹出地图浮窗 + polygon

任一步异常,见 §7 故障排查。

---

## 7. 故障排查

| 现象 | 排查 | 修复 |
|---|---|---|
| `docker compose build` 卡住或网络错误 | npm registry 网络抖动 | 重试 `docker compose --env-file .env.docker build app`,通常二次就过 |
| app 容器 unhealthy | `docker compose logs app` 看 migration 失败 | 检查 `DATABASE_URL` 是否正确;若数据脏可 `docker compose down -v` 全清重启 |
| `pg_isready` 超时 60s | postgres 容器还在初始化 | `docker compose logs postgres`;若 init 失败重启 postgres 容器 |
| 浏览器登录页 404 | 前端 dist 没构建到镜像 | 进 `docker exec cnp-app ls /app/frontend/dist`,有 `index.html` 即正常;否则 `--no-cache` 重建 |
| 「生成预测」搜索阶段 0 召回 | `YUNWU_API_KEY` 未配或错误 | `docker logs cnp-scheduler 2>&1 \| grep yunwu-dr` 看错误;改 `.env.docker` 重启 `app + scheduler` |
| 抽取阶段 `attempted=N llmDegraded=N` 全失败 | `LLM_API_KEY` 未配 | 加上 `LLM_API_KEY` + `LLM_MODEL` 重启 |
| 流水线显示 `LLM degraded — filter-only fallback` | 同上,精排走 fallback | 同上 |
| 预测详情区域永远是「通用区域」 | `AMAP_GEOCODE_KEY` 未配 或 prompt 没抽到地名 | 检查 key + scheduler logs `grep location resolved` |
| 区域弹窗只显 SVG 草图 | `VITE_AMAP_API_KEY` 未配或没 rebuild | 填 key + `docker compose build app && up -d --force-recreate --no-deps app` |
| 浏览器看到老版前端 | 浏览器缓存了旧 HTML | `Cmd+Shift+R` 硬刷新;或私密窗口 |
| 端口冲突 `bind 0.0.0.0:3000` 失败 | 已被其他服务占用 | `lsof -i:3000` 找进程 kill,或改 `docker-compose.yml` 把 `"3000:3000"` 改为 `"3001:3000"` |
| Apple Silicon 上 postgis 启动失败 | 用错镜像 | 检查 `docker-compose.yml` 是 `imresamu/postgis:16-3.4-alpine`(已配置好,通常无需改) |

---

## 8. 日常操作命令

```bash
# 实时看 app + scheduler 日志
docker compose logs -f app scheduler

# 只看 scheduler(worker)日志
docker compose logs -f scheduler

# 重启 app + scheduler(env 改完用这个,数据保留)
docker compose --env-file .env.docker up -d --force-recreate --no-deps app scheduler

# 改了代码,重新 build 镜像并重启
docker compose --env-file .env.docker build app
docker compose --env-file .env.docker up -d --force-recreate --no-deps app scheduler

# 进 app 容器 debug
docker exec -it cnp-app sh

# 进 psql
docker exec -it cnp-postgres psql -U cnp -d cnp

# 完全停止(数据保留在 volume)
docker compose down

# **彻底清空(包括数据 volume)**(慎用!)
docker compose down -v
```

---

## 9. 数据持久化

数据存在 Docker named volumes:

| Volume | 内容 |
|---|---|
| `cnp-pg-data` | Postgres 数据库(预测/新闻/快照/证据/车辆类型/区域 polygon 等所有业务数据) |
| `cnp-redis-data` | Redis(BullMQ 队列 + cache) |

```bash
# 查看 volumes
docker volume ls | grep cnp

# 备份 Postgres(在 host 上跑)
docker exec cnp-postgres pg_dump -U cnp cnp > backup-$(date +%Y%m%d).sql

# 恢复
cat backup-20260514.sql | docker exec -i cnp-postgres psql -U cnp -d cnp
```

---

## 10. 端口与网络

| 端口 | 暴露到 host | 容器内服务 |
|---|---|---|
| 3000 | ✅ | Hono(API + SPA) |
| 5432 | ✅ | Postgres(仅本机调试) |
| 6379 | ✅ | Redis(仅本机调试) |

容器间走 Docker 网络,hostname 是 service 名:`cnp-app` / `cnp-postgres` / `cnp-redis`。生产部署只暴露 3000,5432/6379 应只对 docker 内网开放。

---

## 11. 升级流程(已部署的机器)

```bash
cd cnp
git pull

# schema 改了 → 重新 build app 并重启,entrypoint 会自动跑新 migrations
docker compose --env-file .env.docker build app
docker compose --env-file .env.docker up -d --force-recreate --no-deps app scheduler

# 仅前端改了(VITE_*) → 也要重新 build
docker compose --env-file .env.docker build app
docker compose --env-file .env.docker up -d --force-recreate --no-deps app
```

> Postgres / Redis 容器除非升级镜像 tag 否则不动,数据自动保留。

---

## 12. 默认账号 & 凭据汇总

| 项 | 默认值 | 何时改 |
|---|---|---|
| 管理员账号 | `admin@cnp.local` | 永远 |
| 管理员密码 | `admin1234` | **生产必须改**(进入后台 → 改密) |
| `POSTGRES_PASSWORD` | `cnp_dev` | **生产必须改** |
| `SESSION_SECRET` | demo 占位串 | **生产必须改** |
| `WEBHOOK_HMAC_SECRET` | demo 占位串 | 生产必须改 |

---

**完毕。** 第一次走完整个流程预计 15-20 分钟(含申请 3 把 API key)。所有 key 都拿到后,纯部署 ~5 分钟。
