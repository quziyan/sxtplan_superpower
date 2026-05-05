---
title: 摄像头新闻预测 / 监控调度 / 复盘闭环系统 — 设计稿(v1)
slug: camera-news-prediction
date: 2026-05-05
phase: design
basis: prds/系统逻辑.md(2026-05-05 15:11),与既有 ISA.md 解耦
delivery_path: B(垂直切片优先)
v1_scope: P(全开,无功能后挪到 v2)
deployment: 阿里云公有云,等保二级,modular monolith
---

# 摄像头新闻预测 / 监控调度 / 复盘闭环系统 — 设计稿(v1)

> 本文档是 brainstorming 阶段的最终输出,对应 9 轮问答 + 25 项决策。除 §7 列出的"占位 / 待 PLAN 精修"项外,所有内容已在对话中获得确认。下一步进入 PLAN(实现计划)阶段。

---

## §1 问题 · 愿景 · 范围

### 1.1 问题
在 T 日,业务方需要预测 T+K 时间范围内,**某区域 / 某时段 / 某类车 / 某任务**这一四元组的出动情况。当前缺少:
- (a) 把新闻情报自动转成可操作预测的 Agent 回路
- (b) 按置信度选择性调度有限摄像头资源的决策回路
- (c) 把"事前预测 → 事中跟进 → 事后复盘"三段链路闭合并累积成长期规律的回路

### 1.2 愿景
业务用户在浏览器里看一份"待批预测队列"——每条预测都带置信度 + 四维证据。批准后系统自动通知外部摄像头平台,平台监控完成后回传 metadata + 媒体到我们的对象存储。T+K+M 后,复盘 Agent 自动产出**二元判定 + 量化匹配 + 因果归因 + 简报**四件套。所有预测/调度/复盘沉淀成案例库,作为下一轮预测的 few-shot 上下文,让置信度随时间**自我校准**。

### 1.3 范围(In Scope)

- **核心闭环**:监视清单 + 任务卡 → Agent 预测 → 每日增量 + 周期性全量重算 + 分析师可调 → 一键批/驳 → 外部调度通知 + webhook 回传 → 拉取媒体 → 4 件套复盘 → 案例库反哺
- **信源**:中文主流 + 政府公告 + 社交媒体 + 外文/外媒;3 通道(搜索 API + RSS + 自管爬虫);乙方扛合规
- **部署**:阿里云公有云,等保二级;Postgres+PostGIS / Redis / OSS;modular monolith,单实例可起
- **角色**:决策者(A)+ 分析师(B)+ 复盘师(D)+ 混合岗(E)
- **能力**:撤单 / 一对多调度 / 命名区域 + 地图 polygon / 多后端摄像头适配器(适配器模式)
- **跨境数据**:Q9.D=2,境外原文允许落 OSS,所有处理在境内

### 1.4 Out of Scope(明确不做)

- 实时视频内容理解(只存 metadata + 媒体)
- 自然人面部识别 / 个人身份关联
- 摄像头硬件层(只调用 API)
- **v1 不允许把外文/社交媒体后挪到 v2**(Q5 红线)
- 训练定制 LLM / 微调置信度模型(Q8.C=II,只 few-shot)
- WORM / hash chain / 国密(商业级而非政务涉密)
- 多账号体系(单点登录 + 角色态切换)
- 24×7 实时调度运维岗(C 角色不存在)
- 跨境数据原文回流境外(只入境,不出境)

### 1.5 Slice 0 占位提案(B 路径最小垂直切片,m1–m3)

| 维度 | 占位 | 备注 |
|---|---|---|
| V(车类) | 1 类(占位:"应急救援车") | 进 PLAN 和客户精修 |
| T(任务) | 1 类(占位:"抢险救援") | 同上 |
| R(区域) | 1 个 ADMIN_NAMED 区域(客户给) | 不做地图 polygon |
| 信源 | 中文主流新闻 only | 政务/社交/外文留 m4 加宽 |
| K | 1–14 天 | M = 1 周 |
| 摄像头 adapter | 1 个(客户既有 API) | 多 adapter 留 m5 |
| 复盘 4 件套 | 全做 | 切片小,功能完整 |
| 案例库 few-shot | 简化(BM25 关键词检索) | 向量化留 m7 |
| 前端视图 | A + B 两套(D 视图 m4 加) | 复盘报告 m4 |

**Slice 0 验收**:见 §5.1 ISC-S0-1..4。

---

## §2 角色 · 预测原子单位 · 数据模型

### 2.1 角色与日常工作流

| 角色 | 主入口视图 | 高频动作 | 节奏 | 权限边界 |
|---|---|---|---|---|
| **A 决策者** | 待批预测 Inbox | 一键批/驳 | 日,5–10 min | 看汇总 + 批/驳 + 撤单;不见原始证据细节 |
| **B 分析师** | 预测详情 + 监视清单管理 + 任务卡 | 审证据 / 微调置信度 / 写备注 / 提交建议给 A | 日,1–4 h | 全证据可见 + 可修改 confidence(必填备注) |
| **D 复盘师** | 复盘报告 + 案例库 + 规律统计 | 读 4 件套 / 加事实纠正备注 / 看跨预测规律 | 周/月 | 只读历史 + 可写复盘备注;不能影响在跑预测 |
| **E 混合岗** | 顶部"角色态"切换 | 上面任一 | 视情况 | 一登录承载多 Role,UI + 权限随切换 |

**权限模型简版**:单 `User` 账户 → `User_Role` 多对多到 `Role ∈ {DECIDER, ANALYST, REVIEWER}` → UI 顶部切换 `active_role_state`。所有"批/驳 / 调 confidence / 撤单 / 复盘备注"进 `OperationAudit`(独立 schema,不混业务日志)。

### 2.2 预测原子单位

```
Prediction = ( Region R, TimeWindow W, VehicleClass V, TaskClass T )
           + confidence ∈ [0, 100]
           + K_days = (W.date − today)         自适应刷新频率
           + W = (date, AM | PM)               半天粒度
           + source ∈ { watchlist, taskcard }
           + status ∈ { PROPOSED, APPROVED, REJECTED,
                        DISPATCHED, EXPIRED, COMPLETED }
```

**关键约束**:
- `Prediction` ↔ `DispatchTask` 是 **1 : N**(一对多)
- `Prediction` ↔ `Retrospective` 是 **1 : 0..1**(过期未调度的也可反向复盘)
- 同一 `WatchList` 可在不同时间产出多条 `Prediction`(不同 R/W 组合)
- 撤单不会**删**记录,只改 `cancellation_state`

### 2.3 数据模型主图

```
                         ┌──────────┐
                         │   User   │ 单点登录,多 Role
                         └────┬─────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌───────────┐    ┌───────────┐     ┌──────────────┐
      │ WatchList │    │ TaskCard  │     │OperationAudit│
      │ (V,T 锁)  │    │(R,W,V,T 全)│    │  独立 schema │
      └─────┬─────┘    └─────┬─────┘     │  INSERT-only │
            └──────┬─────────┘           └──────────────┘
                   ▼
              ┌──────────┐                   ┌──────────────┐
              │Prediction│◄──────────────────│  NewsEvidence│
              │(R,W,V,T) │   1:N             │ url/snippet/ │
              └─┬─┬──┬───┘                   │ source/score │
                │ │  │                       └──────────────┘
                │ │  │
                │ │  └────► ConfidenceSnapshot(不可变,追加式)
                │ │         (ts, conf, kind∈{INCR,FULL,MANUAL},
                │ │          evidence_ids[], reasoning, operator_id)
                │ │
                │ └────► DispatchTask  ───►  DispatchResult ───► MediaAsset
                │        (adapter_id,         (payload_json,        (oss_uri,
                │         status,             media_urls[],          type,
                │         cancellation)       tracking_path GEOM)    retention)
                │
                └────► Retrospective ───► CaseLibraryEntry
                       (二轴 outcome,         (BM25 索引,
                        dim_scores{V,R,W,T},   retrieval_features)
                        causal_md, summary_md,
                        reviewer_notes)

      ┌─────────────────────────────┐         ┌────────────┐         ┌────────┐
      │           Region            │         │VehicleClass│         │TaskClass│
      │  kind∈{ADMIN_NAMED,AD_HOC}, │         │ 二级 + tag │         │二级 +tag│
      │  version, effective_from/to,│         └────────────┘         └────────┘
      │  geom POLYGON               │
      └─────────────────────────────┘

      ┌──────────────────┐
      │     Adapter      │  kind∈{gov, saas, custom}, config_json
      └──────────────────┘
```

### 2.4 Region 模型(关键)

```
Region (
  id            uuid
  kind          enum { ADMIN_NAMED, AD_HOC }
  name          text  -- ADMIN_NAMED 必填,AD_HOC 可空
  parent_id     uuid  -- ADMIN_NAMED 行政层级父级(国/省/市/区/...)
  version       int   -- ADMIN_NAMED 版本号,从 1 起
  effective_from timestamptz
  effective_to   timestamptz  -- NULL = 当前版本
  geom          geometry(POLYGON, 4326)
  created_by    uuid
  created_at    timestamptz
)
```

- **`ADMIN_NAMED`**:稳定命名行政区域(例:"X 市朝阳区")。**当前默认 polygon** = `effective_to IS NULL` 的版本。行政区划重组 → 追加新版本 + 把旧版本 `effective_to` 写满,**同名实体跨版本一脉相承**。
- **`AD_HOC`**:用户在地图上即时框选,immutable,可有临时名也可无名。
- **AD_HOC → ADMIN_NAMED 晋升**(K1=做):分析师可把常用 AD_HOC 提升为 ADMIN_NAMED,起 version=1,后续可版本化更新。
- **种子数据**(K2):乙方负责,系统初始化时自动跑一次,导入民政部公开行政区划 GeoJSON 至少四级(国/省/地市/区县)。

### 2.5 业务表对 Region 的引用规则

`WatchList` / `TaskCard` / `Prediction` 引用 Region 时,绑定 `(region_id, region_version)` 元组——**历史预测的几何边界不会被后续行政区划变更追溯改写**。

### 2.6 复盘 / 规律统计的双视图

D 角色统计时可选:
- "按当前行政边界"(归并所有版本到 latest)
- "按当时引用边界"(尊重历史版本)

两套语义并存,适应不同分析需求。

### 2.7 几个非显然的数据模型决策

1. **`VehicleClass / TaskClass` 三层结构**:Level 1 父类 → Level 2 子类 → `EdgeTag`(自由标签,通过外键挂 Level 2 上,允许分析师创建)。Q6=4 的具体落地。
2. **`ConfidenceSnapshot` 不可变**——每次刷新追加一行;`Prediction.confidence_now` 为派生字段(可由触发器维护)。漂移检测查询:取最近 N 个 INCR 累计 vs 最近一次 FULL 的差。
3. **`OperationAudit` 独立 schema + INSERT-only** 数据库权限——服务账号无 UPDATE/DELETE。这是 Q4.E + Q9.C 的折中落地。
4. **`MediaAsset.retention_until`**——v1 不做复杂保留策略,默认 = `created_at + 365d`。
5. **二轴 outcome 完整性约束**——见 §4.1,DB CHECK 约束拦截 2 个不可能格。

---

## §3 置信度回路 · 调度网关 · 新闻采集

### 3.1 置信度回路

#### 三类更新事件

| 类型 | 触发 | LLM 调用形态 | ConfidenceSnapshot.kind |
|---|---|---|---|
| **agent_incr** | 自适应 cadence(按 K 算)+ 新证据到达阈值 | 只把"新证据 + 当前 confidence"喂 LLM | `INCR` |
| **agent_full** | 见触发表 | 全部历史证据喂 LLM,产**新锚点** | `FULL` |
| **manual** | B 分析师在证据页改值 | 不调 LLM,必填备注 | `MANUAL` |

#### agent_full 触发表

| 优先级 | 条件 | 阈值占位(进 PLAN 调) |
|---|---|---|
| P1 | 距上次 FULL 经过 N 次 INCR | `N = 5` |
| P2 | 距上次 FULL 经过 D 天 | `D = 7` |
| P3 | 距上次 FULL 累计新增证据 ≥ M 条 | `M = 10` |
| P4 | 漂移检测:`|sum(Δ_incr from last FULL)| > X pp` | `X = 25` |
| P5 | 分析师手动触发"立即重算" | — |

#### 自适应刷新 cadence

```
K_days       cadence
─────────────────────
K ≤ 3        每 6 小时刷一次 (4×/d)
3 < K ≤ 14   每天刷一次 (1×/d)
14 < K ≤ 60  每 2 天刷一次
K > 60       每周刷一次
```

阈值占位,进 PLAN 调。

#### B 分析师手动覆盖

- B 改 `confidence_now` → 写一行 `MANUAL` snapshot + 必填 `reason`
- 同时进 `OperationAudit` 表,带 before/after
- **不重置** INCR 基底——下次 INCR 在改后值上滑;但下次 FULL 时,LLM 会把人工备注作额外上下文输入

### 3.2 调度网关(DispatchGateway)

#### 三块组件

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│ DispatchService │ ──► │     Adapter      │ ──► │ External Cam │
│  (业务编排)     │     │ (gov/saas/cust)  │     │   Backend    │
└─────────────────┘     └──────────────────┘     └──────────────┘
                                ▲
                                │ webhook callback
                                │
                        ┌───────┴────────┐
                        │ WebhookIngest  │ ◄── External Cam Backend POST
                        │  (公网入口)    │
                        └───────┬────────┘
                                │
                                ▼
                       ┌────────────────┐
                       │ MediaFetcher   │ ──► OSS
                       └────────────────┘
```

#### Adapter 接口契约

```ts
interface CameraAdapter {
  kind: 'gov' | 'saas' | 'custom'

  dispatch(req: DispatchRequest): Promise<DispatchAck>
  cancel(externalId: string, idempotencyKey: string): Promise<CancelAck>
  pollStatus(externalId: string): Promise<DispatchStatus>
  verifyCallback(req: WebhookRequest): boolean
  normalizeResult(rawPayload: unknown): DispatchResult
}
```

#### DispatchTask 状态机

```
  QUEUED ──► SENT ──► IN_PROGRESS ──► COMPLETED
    │         │              │
    │         │              └─► FAILED
    │         │              │
    │         └─── CANCEL ───┴─► CANCEL_PENDING ──► CANCELLED
    │                                                  │
    └─────────► REJECTED_BY_ADAPTER                    │
                                                       │
       (timeout watchdog) ──► TIMED_OUT ◄──────────────┘
```

#### WebhookIngest 安全/可靠性

- **公网入口**:阿里云 SLB → API gateway,固定域名 + HTTPS。客户出网白名单 = 我们的固定 IP/域名。
- **签名验证**:每个 adapter 自定签名规则,统一在 `verifyCallback` 实现
- **幂等**:每条 callback 带 `idempotency_key`,重复投递只更新一次
- **重试与持久化**:adapter 主动 retry 3 次,我方 ingest 失败也不丢(写 `WebhookEnvelope` 持久队列)
- **乱序**:状态机推进只接受单调向前

#### MediaFetcher

- 接到 callback 里的 `media_urls[]` → 投递到本地拉取队列
- 拉取并写 OSS,失败重试 ≤ 3 次
- 计算 sha256 + size + mime
- `MediaAsset.scan_status` 留 v2 病毒/敏感扫描钩子

### 3.3 新闻采集子系统(NewsIngest)

#### 三通道并行

```
┌──────────────────┐
│  SearchAdapter   │   即时搜索 API(Bing/百度/Google)
│  - 关键词由小    │   触发:WatchList/TaskCard 创建/修改、Prediction 增量刷新
│    LLM 生成      │
└─────────┬────────┘
          │
┌─────────▼────────┐
│   RssIngestor    │   订阅式拉取
│  - 周期性轮询    │   触发:cron 5 min/15 min(按源)
└─────────┬────────┘
          │
┌─────────▼────────┐
│ ScraperPool      │   自管爬虫(无 API/RSS 的源)
│  - 反爬 / 限速  │   触发:cron + jitter
│  - 代理出境(外文)│
└─────────┬────────┘
          │
          ▼
   ┌────────────────────────┐
   │   NewsNormalizer       │   去重 / 翻译(外文 → 中文摘要) /
   │                        │   实体抽取 / 地名地理化 / 关键词标注
   └──────────┬─────────────┘
              ▼
   ┌────────────────────────┐
   │   NewsStore            │   raw_url / fetched_at / source_kind /
   │                        │   summary_zh / extracted_entities / geom_points /
   │                        │   content_origin∈{domestic,cross_border}
   └──────────┬─────────────┘
              ▼
   ┌────────────────────────┐
   │   PredictionMatcher    │   按 (R, V, T) 匹配候选预测,挂 NewsEvidence
   └────────────────────────┘
```

#### 跨境处理(Q9.D=2)

- 外文/外媒采集走**境内代理出境**(阿里云国际网关或自管 proxy)
- 境外原文允许落 OSS,带 `content_origin = 'cross_border'` 标记
- 所有处理(翻译、实体抽取、Agent 调用)在**境内 region**

#### 信源健康度

```
status ∈ { ACTIVE, DEGRADED, DEAD }
```

- 错误率 > 30% 持续 1h → DEGRADED
- 错误率 > 80% 持续 6h → DEAD(自动停拉,告警分析师)
- DEGRADED/DEAD 不影响其他源

#### 地理化

- 实体抽取出地名 → 调地理编码服务(高德/百度地图)→ 拿到点坐标 / 行政区划 ID
- 一篇新闻可命中多个 Region
- 命中规则:`ST_Intersects(news_geom, region_geom)` 或 `news_admin_id matches region_id`
- 命中结果写 `NewsEvidence.matched_regions[]`,Agent 再筛

### 3.4 几个非显然决策

1. **Agent 调用走 PAI Inference**——不直连 SDK。案例库 few-shot 检索结果作为 system prompt 的 evidence-block 传入,统一接口。
2. **三类 Agent 职责分明**:`PredictionAgent`(产 confidence)/ `NewsTriageAgent`(判信息增量)/ `RetrospectiveAgent`(产 4 件套)。三者都走阿里云 dashscope deepseek-v4-flash,但 prompt 模板独立版本化。
3. **WebhookIngest 是公网入口,其他服务全部内网**——典型 DMZ 架构。
4. **NewsStore 不做 vector index in v1**——Slice 0 用 Postgres 全文检索 + BM25 (`ts_vector` + `pg_bigm` 中文分词)。向量化留 m7。
5. **SearchAdapter 关键词生成由小 LLM 负责**——给 (V, T, R, K) 元组,产关键词 + 同义词扩展。

---

## §4 复盘子系统 · 架构总图

### 4.1 复盘子系统(M-loop)

#### 触发与输入聚合

| 维度 | 实现 |
|---|---|
| 触发 | `Scheduler` 在 `T+K+M` 投递 retrospective job;M 默认 7 天,可由分析师改 |
| 弹性延后 | 若 T+K+M 之后 D 天内**仍无可判定证据**(news + capture 全空) → 推迟 D 天再做(D 可关闭) |
| 输入 1 — News | 取 `T+K ± Δ`(默认 ±2 天)内、(R, V, T) 匹配的 NewsEvidence + 同期主动二次抓取(更宽关键词) |
| 输入 2 — Capture | 该 Prediction 关联的所有 DispatchTask + DispatchResult + MediaAsset metadata |
| 输入 3 — Notes | OperationAudit 中该 Prediction 的人工介入记录 + 已写的 reviewer_notes |

#### 4 件套输出

```
Retrospective {
  // 轴 1:预测对错
  prediction_outcome ∈ {
    HIT,         // 新闻或实拍至少一方证实预测的出动确实发生
    MISS,        // 新闻反证 / 全无证据且经 D 角色判定未发生
    NO_DATA      // 证据不足判定 → 待 D 裁决
  }

  // 轴 2:调度/采集成功度
  capture_outcome ∈ {
    CAPTURED,        // dispatch 成功且摄像头回传有目标 metadata
    NOT_CAPTURED,    // dispatch 完成但没拍到目标(机位/时段/缺位)
    NOT_DISPATCHED,  // 该 Prediction 从未被批准
    UNKNOWN          // adapter 失败 / 状态不明
  }

  dim_scores: {
    score_V: 0..100   // 车类
    score_R: 0..100   // 区域
    score_W: 0..100   // 时段(半天粒度)
    score_T: 0..100   // 任务
  }
  composite: avg(dim_scores)   // 仅展示,不影响 outcome

  causal_md: string  // Agent 输出 markdown:关键证据 + 误判信源 + 漏读信号
  summary_md: string // 给 D 角色 30 秒读

  evidence_news_ids: uuid[]
  capture_dispatch_ids: uuid[]
  generated_at: timestamptz
  reviewer_notes: text   // D 加事实纠正
  outcome_overridden: boolean
}
```

#### 二轴矩阵(8 个有效格 + 2 个不可能格)

|                  | CAPTURED | NOT_CAPTURED | NOT_DISPATCHED | UNKNOWN |
|------------------|----------|--------------|----------------|---------|
| **HIT**          | ✅ 完美命中 | 🟠 命中但漏拍 | 🔵 命中但没批 | ⚪ 命中,调度状态未知 |
| **MISS**         | (不可能,DB CHECK 拦截) | 🔴 误报+空拍 | 🟢 误报但未浪费资源 | ⚪ 误报,调度状态未知 |
| **NO_DATA**      | (不可能,DB CHECK 拦截) | NO_DATA | NO_DATA | NO_DATA |

> "不可能"格:摄像头**真的拍到目标** ⇒ 预测一定 HIT。CHECK constraint 兜底。

#### 案例库与 few-shot 反哺(Q8.C=II)

```
CaseLibraryEntry {
  retrospective_id, prediction_snapshot,
  retrieval_keys: { V_path, T_path, R_admin_chain, K_bucket, source_mix },
  bm25_blob: text   // V 二级 + T 二级 + R 行政链 + K 区间 + outcome + 关键 causal 短语
}
```

下次 PredictionAgent 调用前:
1. 用 `(V, T, R, K)` 去 BM25 检索 top-k = 5 案例
2. 压成"过去 5 个相似案例:3 HIT / 1 MISS / 1 FP,关键差异是 …" 注入 prompt
3. v2 加 embedding,v1 关键词足够

#### D 角色"事实纠正"

- D 可分别覆盖 `prediction_outcome` 和 `capture_outcome`,各自必填 reason
- 不删 Agent 4 件套,而是**追加** reviewer_notes + 设置 `outcome_overridden`
- CaseLibrary 用**人工修正后**的 outcome 反哺,但保留**原始 Agent outcome** 做 calibration

#### 反向复盘(过期未调度)

`Prediction.status = EXPIRED` 且未调度的也跑复盘(简化版):仅 outcome 判定 + summary,不做调度比对。属于 `capture_outcome=NOT_DISPATCHED` 子集 → 矩阵 🔵 / 🟢 两格。提供"覆盖率"价值。

### 4.2 架构总图

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Aliyun Public Cloud — 境内 region                    │
│                                                                       │
│  ┌─────────────┐      WebSocket / HTTP                                │
│  │  Frontend   │ ──────────────────┐                                  │
│  │ React + 高德 │                   │                                 │
│  └─────────────┘                   ▼                                  │
│                          ┌─────────────────┐                          │
│                          │  API Gateway     │ Aliyun ALB / Nginx     │
│                          │  (TLS, RateLimit)│                         │
│                          └────────┬─────────┘                         │
│                                   │                                    │
│      ┌────────────────────────────┼─────────────────────────────┐     │
│      ▼                            ▼                             ▼     │
│ ┌──────────┐              ┌────────────────┐        ┌─────────────┐  │
│ │  WebApp  │              │ AgentGateway   │        │ DispatchSvc │  │
│ │ Auth/    │              │ (Prediction/   │        │ State machine│ │
│ │ Inbox/   │              │  NewsTriage/   │        │ + Adapter pool│ │
│ │ Roles/   │              │  Retrospective)│        │              │ │
│ │ Maps     │              │                │        │  ┌─────────┐ │ │
│ └────┬─────┘              └───────┬────────┘        │  │ Adapter │ │ │
│      │                            │                  │  │ gov/saas│ │ │
│      │                    ┌───────▼────────┐        │  │ /custom │ │ │
│      │                    │ PAI Inference  │        │  └─────────┘ │ │
│      │                    │ → dashscope    │        └──────┬───────┘ │
│      │                    │   deepseek-v4- │               │         │
│      │                    │   flash        │               │         │
│      │                    └────────────────┘               │         │
│      │                                                     │         │
│ ┌────▼────────────────────────────────────┐               │         │
│ │  Workers(后台)                          │               │         │
│ │  - Scheduler(BullMQ + cron)              │               │         │
│ │    · adaptive cadence per K              │               │         │
│ │    · retrospective trigger T+K+M         │               │         │
│ │    · agent_full 触发表轮询              │               │         │
│ │  - NewsIngest(SearchAdapter / Rss /     │               │         │
│ │    ScraperPool / NewsNormalizer /        │               │         │
│ │    Geocoder / PredictionMatcher)         │               │         │
│ │  - MediaFetcher                          │               │         │
│ │  - RetrospectiveRunner                   │               │         │
│ └──────────────────┬───────────────────────┘               │         │
│                    │                                        │         │
│ ┌──────────────────▼─────────────────────────────────────────▼──┐    │
│ │      Postgres(主从)+ PostGIS                                 │    │
│ │  Predictions / ConfidenceSnapshot / NewsEvidence /             │    │
│ │  DispatchTask / DispatchResult / MediaAsset / Retrospective /  │    │
│ │  CaseLibraryEntry / Region(versioned)/ V/T 分类 /            │    │
│ │  OperationAudit(独立 schema, INSERT-only)                     │    │
│ └────────────────────────┬───────────────────────────────────────┘    │
│                          │                                             │
│ ┌────────────────────────▼──────────────────────────────────────┐    │
│ │  Redis  — cache + BullMQ 队列 + adapter idempotency keys      │    │
│ └───────────────────────────────────────────────────────────────┘    │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │  OSS                                                            │   │
│ │  ├─ news-raw/        新闻原文(含跨境 cached)                 │   │
│ │  ├─ media-capture/   摄像头回传 metadata + 媒体                │   │
│ │  └─ region-seed/     行政区划 GeoJSON 种子                    │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
└─────────────┬──────────────────────────────────────────────────────────┘
              │ DMZ — 唯一公网入口
              │
        ┌─────▼─────────────────────────────┐
        │  WebhookIngest                    │
        │  - 固定域名 + HTTPS               │
        │  - 各 adapter 自定签名校验        │
        │  - 持久化 WebhookEnvelope         │
        │  - idempotency by callback key    │
        └─────────────────┬─────────────────┘
                          │
              ┌───────────▼──────────┐
              │ External Camera      │
              │ Backends (gov/saas/  │
              │           custom)    │
              └──────────────────────┘

         ┌──────────────────────────────────┐
         │  境外新闻源(via 阿里云国际网关 / │
         │  proxy)— 仅 egress              │
         └──────────────────────────────────┘
```

### 4.3 部署单元(modular monolith)

| 单元 | 职责 | 实例数(中量级) |
|---|---|---|
| **WebApp** | 前端 + REST/WS + 业务编排 | 1–2 |
| **AgentGateway** | 三类 Agent + PAI Inference 包装 | 1(可独立扩) |
| **DispatchService** | adapter pool + 状态机 | 1 |
| **Workers** | Scheduler + NewsIngest + MediaFetcher + RetrospectiveRunner | 1–2 |
| **WebhookIngest** | DMZ 公网入口 | 1–2(高可用) |

### 4.4 v1 不要做的事

- 不上 K8s,docker-compose 起单宿主机就够中量级
- 不上独立 vector DB,Postgres 全文检索 + BM25 顶到 m7
- 不上独立消息队列(Kafka),BullMQ + Redis 顶到月度调度量 < 5000

### 4.5 关键数据流

**预测产生**:WatchList 命中 News → NewsTriage 判增量 → PredictionAgent 拉案例库 + 当前证据 → 输出 confidence → 写 Prediction(PROPOSED) + ConfidenceSnapshot(FULL,锚点) → 推 A 角色 Inbox

**置信度更新**:Scheduler 按 K 推算 → 拉新证据 + 当前 conf → INCR 调用 → 命中触发表 → 升级 FULL + 漂移检测;B 介入 → manual override + audit + reason

**调度**:A 一键批准 → APPROVED → DispatchService 选 adapter → 派单 → SENT → backend 处理 → callback to WebhookIngest → IN_PROGRESS / COMPLETED → MediaFetcher 拉媒体 → MediaAsset 入 OSS

**撤单**:触发(自动 conf 跌破阈值 / 手动 A/B 取消) → CANCEL_PENDING + adapter.cancel(idempotency_key) → ack 后 CANCELLED;ack 失败持续重试 + 告警

**复盘**:T+K+M Scheduler 投 retrospective job → 聚合 news + capture + audit → RetrospectiveAgent 出 4 件套 → Retrospective 入库 → 写 CaseLibraryEntry → 下次相似预测可检索

---

## §5 ISC · 风险 · 交付排程

### 5.1 ISC 草案(32 + 4 = 36 条)

#### 预测核心(8)

- **ISC-1** PredictionAgent 给定 (V,T,R,K),返回 `confidence ∈ [0,100]` + `reasoning_chain[]` + `evidence_news_ids[]`,p95 响应 ≤ 30s
- **ISC-2** `evidence_news_ids` 中每条都能从 NewsStore 取出且原文 URL HTTP 200(或带"原文已删"flag)
- **ISC-3** WatchList 自动产出新预测前,NewsTriageAgent 必先过滤(命中阈值才创建)
- **ISC-4** TaskCard 手动创建路径走通 → Prediction.source=`TASKCARD`
- **ISC-5** Region 引用绑定 `(region_id, region_version)`,事后行政区划版本变更不追溯改写
- **ISC-6** AD_HOC region 创建后 immutable;ADMIN_NAMED 晋升路径走通
- **ISC-7** V/T 二级分类 + 边缘标签均可被分析师写入并被 Agent 引用
- **ISC-8** ConfidenceSnapshot 表对所有非超管账号 INSERT-only(数据库级权限)

#### 置信度回路(5)

- **ISC-9** agent_incr 按 K-自适应表准时投递(误差 ≤ 5 分钟)
- **ISC-10** agent_full 触发表 P1–P5 五条都有单测覆盖,任一命中即升级 FULL
- **ISC-11** 漂移检测 P4:`|sum(Δ_incr since last FULL)| > 25pp` 触发 FULL,全链路日志可追
- **ISC-12** B 角色 manual override 必填 reason → 写 ConfidenceSnapshot(MANUAL) + OperationAudit
- **ISC-13** 案例库 BM25 检索 top-5 在 ≤ 200ms 返回(中量级数据)

#### 调度网关(6)

- **ISC-14** Adapter 接口 5 方法有契约测试,至少 1 个真实 backend 实现
- **ISC-15** webhook 重复投递(同 idempotency_key)只前进状态机一次
- **ISC-16** 撤单状态机:CANCEL_PENDING → CANCELLED 路径在所有 adapter 实现中通过
- **ISC-17** WebhookIngest 签名校验失败直接 4xx,不进状态机;失败信封持久化
- **ISC-18** MediaFetcher 拉取失败重试 ≤ 3 次,3 次失败告警 + MediaAsset.scan_status=FETCH_FAILED
- **ISC-19** DispatchTask 与 MediaAsset 全链路均关联到具体 Prediction(无孤儿)

#### 新闻采集(6)

- **ISC-20** SearchAdapter / RssIngestor / ScraperPool 三通道每条都有 ≥ 1 个真实源跑 7 天无中断
- **ISC-21** NewsNormalizer 对中文 + 英文均能产出去重 hash + 摘要 + 实体列表
- **ISC-22** 跨境采集走阿里云国际网关代理,OSS 中标 `content_origin='cross_border'`
- **ISC-23** SourceHealth 错误率 > 30% 1h 自动 DEGRADED;> 80% 6h 自动 DEAD + 告警
- **ISC-24** NewsGeocoder 抽样 100 条人评地名定位准确率 ≥ 80%
- **ISC-25** PredictionMatcher 把每条入库新闻映射到 0–N 个候选预测,延迟 ≤ 1 分钟

#### 复盘子系统(4)

- **ISC-26** RetrospectiveRunner 在 T+K+M 时刻投递 job(误差 ≤ 1 小时)
- **ISC-27** Retrospective 输出 4 件套完整:`prediction_outcome × capture_outcome` 二轴 + dim_scores(4 维)+ causal_md + summary_md
- **ISC-28** 二轴矩阵 2 个不可能格(MISS/CAPTURED, NO_DATA/CAPTURED)在数据层 CHECK 约束拦截
- **ISC-29** D 角色可分别覆盖 prediction_outcome 和 capture_outcome,各自必填 reason → 写 OperationAudit + Retrospective.outcome_overridden=true

#### 部署 / 运维 / 合规(3)

- **ISC-30** docker-compose up 在干净阿里云 ECS 上 ≤ 30 分钟跑起整套(Postgres + Redis + OSS 客户端 + 5 个服务单元 + 行政区划种子已导入)
- **ISC-31** 在中量级 24h 压测下(10 新预测/天,5 调度,40 incr,8 full)无任务堆积、P95 抖动 < 2×
- **ISC-32** OperationAudit 表跨整个生命周期 INSERT-only;关键操作 100% 进表

#### Slice 0 验收(4,B 路径专用)

- **ISC-S0-1** m3 在客户提供的真实场景下跑 ≥ 5 条 Prediction
- **ISC-S0-2** ≥ 3 条进入 DispatchTask
- **ISC-S0-3** 至少跑出 ≥ 1 条 `HIT/CAPTURED` + ≥ 1 条 `HIT/NOT_CAPTURED` 或 `MISS/NOT_CAPTURED`
- **ISC-S0-4** Slice 0 周期内全链路无人工救火

### 5.2 风险登记

| ID | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| **R1** | LLM 自评 + 增量 → confidence 漂移 | 🔴 高 | 周期性 FULL + 漂移检测 P4 + B 手动覆盖 |
| **R2** | v1=P 全开 → 工期超 9 个月 | 🔴 高 | B 路径 Slice 0 m3 demo + Out-of-Scope 红线条款 |
| **R3** | 跨境数据采集 / 外媒访问合规 | 🟠 中 | 阿里云国际网关 + 标记 cross_border + 处理在境内 |
| **R4** | 多 backend adapter 依赖客户配合 | 🟠 中 | 抽象 adapter 接口 + Slice 0 只打通 1 个 |
| **R5** | 4 维等权 → 漏检 ≠ 误检 但权重相同 | 🟠 中 | 等权写入 v1 合同;v2 评估加权(留钩子) |
| **R6** | M=1–3 天复盘太早,新闻没沉淀 | 🟠 中 | 弹性延后机制 + D 角色可手动重跑 |
| **R7** | webhook 公网入口被撞 / DoS | 🟠 中 | DMZ + 签名 + 持久信封队列 + 速率限制 |
| **R8** | NewsTriageAgent 误过滤 → 漏证据 | 🟠 中 | 抽样人评 + 阴性样本审计 |
| **R9** | 行政区划种子过期 / 客户期望最新 | 🟢 低 | 乙方负责 + 系统初始化 + 半年级版本更新 |
| **R10** | 中文分词 / BM25 准确率 | 🟢 低 | pg_bigm + 同义词词典 |
| **R11** | 单实例 modular monolith 单点 | 🟢 低 | 中量级可接受 + 主从 Postgres + OSS 异地备份 |
| **R12** | 摄像头回传 payload 各家不同 | 🟠 中 | adapter.normalizeResult,合同要求 backend 给契约 |

### 5.3 交付排程(B 路径,9 个月)

```
M1 ───┬─── M2 ───┬─── M3  Slice 0 完工 / 演示 / 客户验收 ◄── 关键里程碑
      │           │
      │           ├── PredictionAgent + NewsTriage + 1 信源(主流中文)
      │           ├── 1 个真实 adapter
      │           └── 一键批准 + 撤单基础
      ├── 数据模型 + Region 种子 + WebApp 骨架 + Auth/Roles + 顶部切换
      └── 三类 Agent 桩 + Inference 包装

M4 ───┬─── M5 ───┬─── M6  横向加宽 / 中量级压测
      │           │
      │           ├── adapter pool + 撤单完整链路
      │           ├── AD_HOC → ADMIN_NAMED 晋升
      │           └── 案例库 BM25 反哺
      ├── RSS 通道 + 政府公告 + 社交媒体
      └── D 角色视图 + 复盘报告页

M7 ───┬─── M8 ───┬─── M9  加深 / 验收上线
      │           │
      │           ├── 复盘 4 件套打磨 + 二轴矩阵展示
      │           ├── D 角色规律统计页
      │           ├── few-shot prompt 调优
      │           └── 集成测试 + 文档 + 上线
      ├── 外文 / 外媒采集
      ├── 翻译 + 多语言实体抽取
      └── 跨境合规审查
```

**节奏要点:**
- m3 是**信心里程碑**:必须有可演示的真实端到端
- m6 是**规模里程碑**:中量级压测过 → 能进真实生产数据
- m9 是**完整里程碑**:v1=P 红线全交付

**并行启动项**(不占主线工时):
- V/T 分类法草案(Q6.C=ii):合同附件,m1 内交客户审 → 不签字不动数据模型
- 行政区划种子(K2):乙方导入,m1 启动,系统初始化跑一次
- adapter 接口契约(Q7):合同附件,与客户 backend 团队 m1 起对齐

---

## §6 决策日志(brainstorming 9 轮 / 25 项)

| # | 决策点 | 选择 |
|---|---|---|
| Q1 | 主要使用者 | A 决策者 + B 分析师 + D 复盘师 + E 混合岗(无 C 实时调度员) |
| Q2 | 预测发现模式 | D = 监视清单驱动 Agent 主动产出 + 任务卡手动单点查询(混合) |
| Q2-补 | 区域形态 | 命名区域(ADMIN_NAMED) + 地图框选(AD_HOC),底层均为 polygon |
| Q3 | K 尺度 | D = 每条预测自带 K,系统自适应刷新频率 |
| Q3.附 | 时段粒度 | (ii) 半天(AM/PM) |
| Q3.附 2 | M 尺度 | (d) 1–14 天可手动定,默认 7 |
| Q4.A | 置信度算法 | (1) Agent 自评(LLM 直接输出 0–100) |
| Q4.B | 多次更新合并 | (β) 增量更新 |
| Q4.C | 调度决策权 | (II) 建议 + 一键批准(默认不调度) |
| Q4.D | 周期性全量重算 | Y(锚定漂移) |
| Q4.E | 分析师手动微调 | Y(必填备注 + 审计) |
| Q5.A | 信源主范围 | (d) 主流 + 政务 + 社交 + 外媒 |
| Q5.B | 接入方式 | (ε) 搜索 API + RSS + 自管爬虫 |
| Q5.C | 合规兜底 | (i) 乙方负责 |
| v1 范围 | P = 全开,无功能后挪 v2(红线) | |
| Q6.A | 车类 V 分类 | 4 = 核心两级固定 + 边缘自由标签 |
| Q6.B | 任务 T 分类 | 4 = 同上 |
| Q6.C | 分类法初版 | (ii) 乙方草案 + 客户审 |
| Q7.A | 摄像头后端关系 | (d) 多家共存,适配器模式 |
| Q7.B | 调度通知机制 | (2) 异步 + webhook 回调 |
| Q7.C | 结果回传形态 | (β) JSON metadata + 我们主动拉取媒体到 OSS |
| Q7.D | 撤单 | Y(双向 idempotent) |
| Q8.A | 复盘 Agent 输出 | 4 = 二元 + 量化 + 因果 + 简报 全套 |
| Q8.A-修 | 二元 outcome 升级为二轴(prediction_outcome × capture_outcome) | |
| Q8.B | 对错判定 | (β) 四维分解(V/R/W/T 各打分),无严重度权重 |
| Q8.C | 自学习 | (II) few-shot 反哺,不训练模型 |
| Q8.D | 复盘 Agent 输入 | (c) 新闻 + 实拍 metadata + 分析师备注 |
| Q8.附 | 预测↔调度比 | Q = 一对多 |
| Q9.A | 部署 | (c) 公有云,等保二级 |
| Q9.B | 数据规模 | 中(50–500 监视清单 / 500–5000 月预测 / 20–500 月调度 / 5–20 分析师) |
| Q9.C | 审计等级 | (I) 标准日志 + 关键操作单独 OperationAudit 表 INSERT-only |
| Q9.D | 数据跨境 | (2) 境外原文允许落 OSS,处理在境内 |
| K1 | AD_HOC → ADMIN_NAMED 晋升 v1 即做 | |
| K2 | 行政区划种子由乙方导入 + 系统初始化跑一版 | |
| 路径 | B = 垂直切片优先 | |

---

## §7 开放问题 / 待 PLAN 阶段精修

1. **Slice 0 的 (V, T, R) 三元组**:占位"应急救援车 / 抢险救援 / 客户给的命名区域",入 PLAN 与客户精修
2. **触发表阈值**:N=5 / D=7d / M=10 / X=25pp 全为占位
3. **K-cadence 阈值**:(3, 14, 60) 边界为占位
4. **M 弹性延后的 D 天**:占位
5. **adapter 第一个真实 backend**:由客户在 PLAN 阶段确认
6. **行政区划种子数据源**:民政部公开 vs 商业 GIS 数据,选哪个,m1 启动前定
7. **R5 风险**:漏检 ≠ 误检的加权问题,v1 接受等权,v2 评估;具体加权方案 PLAN 不必给
8. **前端框架**:React/Vue,未在 brainstorming 中决定,PLAN 阶段定
9. **地图组件**:高德/百度/MapTiler,未定,PLAN 阶段定
10. **审计表保留期 + OSS 默认 retention 365d**:是否符合客户合规,PLAN 阶段确认

---

## §8 下一步

进入 PLAN 阶段(superpowers:writing-plans),把本设计转换成具体实现计划:
- 任务拆解 → m1 起手 4 周可执行级
- 依赖关系图
- 关键路径风险点
- 测试策略(契约测试 / 集成测试 / Slice 0 端到端)
