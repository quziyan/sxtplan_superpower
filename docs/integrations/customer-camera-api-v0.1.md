# Customer Camera Backend API — v0.1

> **Version:** v0.1
> **Status:** DRAFT — pending customer review
> **Date:** 2026-05-08
> **Authors:** CNP backend team
> **Contact for feedback:** backend-team@cnp.example (placeholder — replace before sending)
> **Reviewer (customer side):** TBD — please fill in name + email of API owner on customer side

本文件是我们(CNP)与客户摄像头 backend 之间双向接口契约的初稿,基于 m3 阶段
`SimulatedGuangzhouPoliceCamAdapter` 反推得到,**未经客户审核**。客户审过后会按反馈
迭代到 v0.x,客户最终确认后冻结到 v1.0,作为生产对接基线。

v0.1 对应 `CAMERA_BACKEND_KIND=real-gzp`(env enum,见 `src/env.ts`)。同一份契约
模板未来可派生出其他客户的 v0.1(每家客户独立版本线)。

---

## 1. Versioning Policy

| 版本 | 含义 |
|---|---|
| `v0.1` | 我方起草,送客户审核前的内部版本(本文件) |
| `v0.x` | 客户审核期间的迭代版本(每轮 review 一个 minor) |
| `v1.0` | 客户确认 + 生产对接首次冻结 |
| `v1.x` | 向下兼容增量(新增可选字段、扩展 enum) |
| `v2.0` | 不向下兼容变更(URL 重命名、必填字段调整、auth 换方式) |

**Backward compatibility:** v1.x 不得删字段、改必填、缩小响应 enum。破坏式变更需升 major + ≥ 4 周 grace period。

---

## 2. Authentication

**我方 → 客户:** `X-API-Key: <opaque>` per request。客户分配 token,带外信道交付,
不入 git。90 天滚动 rotation,新旧 key 7 天 grace period 共存。

**客户 → 我方(webhook):** `X-Signature: hmac-sha256=<hex>` + `X-Adapter-Key: real-gzp`。
我方分配 shared secret,客户对 raw body 签 HMAC-SHA256。
Verify(我方侧):`hmac_sha256_hex(secret, raw_request_body) === provided_hex`。
同样 90 天滚动 + 7 天 grace period。

---

## 3. Endpoints

### 3.1 POST /dispatch — 我方 → 客户

派发一次预测任务到客户 backend。

**Headers (all required):** `X-API-Key`, `X-Idempotency-Key` (UUID/ULID), `Content-Type: application/json`

**Body:**

| Field | Required | Type |
|---|---|---|
| `predictionId` | yes | string |
| `regionPolygon` | yes | GeoJSON `Polygon` |
| `timeWindow.start` / `timeWindow.end` | yes | ISO 8601 |
| `vehicleClass` | no | string(如 `"truck"`) |
| `priority` | no | `"normal" \| "high"`,默认 `"normal"` |
| `metadata` | no | object,自由 KV |

**Response codes:**

| Code | Body | 含义 |
|---|---|---|
| 200 | `{ externalId: string, acceptedAt: ISO8601 }` | accepted,后续 webhook 跟踪 |
| 400 | `{ error, code, retryable: false }` | 参数错;不重试 |
| 401 | `{ error: "unauthorized" }` | API key 错 |
| 429 | `{ error, retryable: true }` + `Retry-After: <s>` | rate-limited |
| 503 | `{ error, retryable: true }` | 暂不可用,指数退避重试 |

**Worked example — happy path:**

```bash
curl -X POST https://customer-camera.example.com/dispatch \
  -H "X-API-Key: $CUSTOMER_API_KEY" \
  -H "X-Idempotency-Key: 01H5K3...ULID" \
  -H "Content-Type: application/json" \
  -d '{"predictionId":"pred-2026-05-08-0042","regionPolygon":{"type":"Polygon","coordinates":[[[113.27,23.13],[113.28,23.13],[113.28,23.14],[113.27,23.14],[113.27,23.13]]]},"timeWindow":{"start":"2026-05-08T09:00:00Z","end":"2026-05-08T11:00:00Z"},"vehicleClass":"truck","priority":"normal"}'
# → 200 { "externalId": "gzp-9c1...", "acceptedAt": "2026-05-08T08:59:51Z" }
```

**Worked example — error path:**

```json
HTTP/1.1 400 Bad Request
{ "error": "regionPolygon must be closed ring", "code": "INVALID_POLYGON", "retryable": false }
```

---

### 3.2 POST `<our-webhook-url>` — 客户 → 我方

通知一次 dispatch 的状态变更。我方公开 URL + 共享 signing secret,客户对所有状态变更推送。

**Headers (all required):** `X-Signature: hmac-sha256=<hex>`, `X-Adapter-Key: real-gzp`,
`X-Idempotency-Key`, `Content-Type: application/json`

**Body:**

| Field | Required | Type |
|---|---|---|
| `externalId` | yes | string,与 /dispatch ack 一致 |
| `state` | yes | `"IN_PROGRESS" \| "COMPLETED" \| "CANCELLED" \| "FAILED"` |
| `mediaUrls` | conditional | string[],`COMPLETED` 时必填 |
| `meta.vehicleSpotted` / `plateNumber` / `capturedAt` | no | boolean / string / ISO 8601 |
| `meta.*` | no | 其他自由字段(透传 audit) |

**Response codes:**

| Code | Body | 含义 |
|---|---|---|
| 200 | `{ ok: true }` | 已接收,落库 |
| 401 | `{ error: "signature mismatch" }` | 签名验证失败 |
| 409 | `{ ok: true, dedup: true }` | 已处理过此 idempotency-key,no-op |

**Worked example — webhook + signature(客户侧伪代码):**

```bash
BODY='{"externalId":"gzp-9c1...","state":"COMPLETED","mediaUrls":["https://...jpg"],"meta":{"vehicleSpotted":true,"capturedAt":"2026-05-08T09:42:01Z"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SHARED_SECRET" -hex | awk '{print $2}')
curl -X POST https://our-app.example.com/webhooks/camera \
  -H "X-Signature: hmac-sha256=$SIG" -H "X-Adapter-Key: real-gzp" \
  -H "X-Idempotency-Key: completed-gzp-9c1..." -H "Content-Type: application/json" \
  -d "$BODY"
# → 200 { "ok": true }
```

**签名 payload = raw body 字节序列**(不含 header / URL / query)。任何 prettify /
re-serialize 都会破坏签名 — 务必传输原始字节。

---

### 3.3 POST /cancel — 我方 → 客户

撤销一次进行中的 dispatch。

**Headers (all required):** `X-API-Key`, `X-Idempotency-Key`, `Content-Type: application/json`

**Body:** `{ externalId: string (yes), reason?: string (审计用) }`

**Response codes:**

| Code | Body | 含义 |
|---|---|---|
| 200 | `{ externalId, cancelledAt: ISO8601 }` | 接受,客户端后续 webhook 推 `CANCELLED` |
| 404 | `{ error, code: "UNKNOWN_EXTERNAL_ID" }` | externalId 不存在或已 terminal |
| 410 | `{ error, code: "ALREADY_COMPLETED" }` | 已 COMPLETED,no-op |

**Worked example:**

```bash
curl -X POST https://customer-camera.example.com/cancel \
  -H "X-API-Key: $CUSTOMER_API_KEY" -H "X-Idempotency-Key: cancel-gzp-9c1..." \
  -H "Content-Type: application/json" \
  -d '{"externalId":"gzp-9c1...","reason":"[AUTO] confidence dropped to 0.27"}'
# → 200 { "externalId": "gzp-9c1...", "cancelledAt": "2026-05-08T09:15:11Z" }
```

---

## 4. Error Response Format

所有错误响应统一为:

```json
{ "error": "<human-readable message>", "code": "<MACHINE_CODE>", "retryable": <bool> }
```

| `code` | HTTP | retryable |
|---|---|---|
| `INVALID_POLYGON` | 400 | false |
| `INVALID_TIME_WINDOW` | 400 | false |
| `MISSING_FIELD` | 400 | false |
| `UNAUTHORIZED` | 401 | false |
| `RATE_LIMITED` | 429 | true |
| `BACKEND_UNAVAILABLE` | 503 | true |
| `UNKNOWN_EXTERNAL_ID` | 404 | false |
| `ALREADY_COMPLETED` | 410 | false |

---

## 5. Rate Limiting & Retry

**我方 → 客户:** 默认 60 req/min;429/503 按 `1s, 2s, 4s, 8s, 16s` 指数退避,5 次后
放弃并标 `dispatch_failed`。429 携带 `Retry-After` 时优先该值。

**客户 → 我方:** 同 idempotency-key 在 24h 窗口内重复推送幂等(我方落库去重,
返回 `409 { ok: true, dedup: true }`)。建议客户 webhook 失败重试 3 次后放弃 + 带外通知。

---

## 6. Media URL Conventions

`mediaUrls` 是 http(s) URL 数组,每条指向一张 / 一段 capture 媒体。
**有效期:** 推荐 ≥ 1 小时;我方在 webhook 收到后 5 分钟内 fetch 落 OSS。
**失败模式:** 我方未及时 fetch → URL 过期 → prediction 标 `media_expired`,不向客户报错。
**格式:** 客户保留选择(jpg / mp4 / hls 等);acceptance test 期校对实际格式。

---

## 7. Test Mode

客户提供 sandbox API key + base URL;我方提供 sandbox webhook URL + signing secret。

1. 我方 POST /dispatch,`predictionId` 以 `[TEST]` 前缀标记
2. 客户检测到前缀,**不实际部署摄像头**;30 秒内合成一条 webhook 流回送
   (`IN_PROGRESS` → `COMPLETED` + 占位 mediaUrls)
3. 我方 acceptance test 校验回调链路 + 签名验证 + 落库

Sandbox 与 prod 共用同一份契约,只是 base URL + key 不同。

---

## 8. Open Questions / Customer Review

> **客户填写区** — 请审核时每条下方加批注,无意见也请明示 "ok"。

1. **必填字段** — `vehicleClass` / `priority` / `metadata` 我方列为可选,客户实际是否一致?有无遗漏的强制字段?
2. **`regionPolygon` 格式** — GeoJSON Polygon(WGS-84)?或需 BD-09 / GCJ-02?或中心点 + 半径替代?
3. **认证方式偏好** — `X-API-Key` 是否符合客户安全规范?需要 OAuth2 client-credentials / JWT?
4. **Rate limit 实际承诺值** — 我方默认 60 req/min,客户实际 quota?按 tenant / IP / API-key 计?
5. **Sandbox 可用性** — 独立 sandbox 环境?credential 交付流程(谁发 / 何时 / 如何 rotate)?
6. **Webhook 重试策略** — 客户失败重试行为(次数 / 间隔 / 上限)?
7. **媒体 URL 鉴权** — `mediaUrls` 是否带签名?fetch 时携 X-API-Key?或 URL 内嵌 query token?

---

## 9. Open Issues / Known Gaps(我方侧 TBD)

- **Signature secret 格式** — hex / base64 / raw bytes;建议 ≥ 32 字节
- **Webhook delivery retry policy** — 待 §8.6 客户回复后定稿
- **Media fetch SLA** — 5 分钟上限是否足够,acceptance 测算
- **Multi-tenant(未来)** — v0.1 假设 1 客户 = 1 套 credential;v2.0 可能引入 tenant 维度
- **Geofencing 校验** — dispatch 接受时校验 polygon,或接受 + 后续 FAILED 反馈

---

## 10. Changelog

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-05-08 | 初稿(送客户审核前):基于 SimulatedGuangzhouPoliceCamAdapter 接口反推 |
| v0.2 | TBD | 客户 Round 1 反馈合并 |
| v1.0 | TBD | 客户最终确认 + 生产对接冻结 |
