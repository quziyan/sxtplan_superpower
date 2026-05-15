import { api } from './api'
import type { DispatchTask } from './dispatch-api'
import type { MediaAsset } from './media-api'

export type PredictionStatus = 'PROPOSED' | 'VALIDATED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
export type HalfDay = 'AM' | 'PM'

// Plan-C T27 / ISC-35: GET /predictions/:id inlines dispatchTasks (with
// nested mediaAssets per dispatch) so the detail view loads in one round
// trip. Mirrors the backend response shape from src/modules/prediction/routes.ts.
export type DispatchTaskWithMedia = DispatchTask & { mediaAssets: MediaAsset[] }

export type Prediction = {
  id: string
  sourceKind: 'WATCHLIST' | 'TASKCARD'
  sourceId: string
  regionId: string
  regionVersion: number
  windowDate: string
  windowHalf: HalfDay
  vehicleClassId: string
  taskClassId: string
  confidenceNow: number
  kDays: number
  status: PredictionStatus
  cadenceMinutes: number
  lastFullAt: string | null
  lastIncrAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

// Plan-C T33 / ISC-41: when callers pass `includeLatestSnapshot: true`, the
// backend inlines a summary of each prediction's most recent confidence
// snapshot (or null when none exist). Lets DecisionView's InboxCard render
// the reasoning snippet without a per-row /predictions/:id roundtrip.
export type LatestSnapshotSummary = {
  confidence: number
  reasoning: string | null
  occurredAt: string
  kind: 'INCR' | 'FULL' | 'MANUAL'
}

// Schedule tab:?include=names 时后端 inline 名称,日历视图直接显示。
export type PredictionNames = {
  vehicleClassName?: string
  taskClassName?: string
  regionName?: string | null
  sourceName?: string | null
}

export type PredictionListItem = Prediction & {
  latestSnapshot?: LatestSnapshotSummary | null
} & PredictionNames

export type ConfidenceSnapshot = {
  id: string
  predictionId: string
  kind: 'INCR' | 'FULL' | 'MANUAL'
  confidence: number
  confidenceCiLow: number | null
  confidenceCiHigh: number | null
  evidenceIds: string[]
  reasoning: string | null
  operator: string | null
  occurredAt: string
}

export async function listPredictions(
  opts: {
    status?: PredictionStatus
    limit?: number
    includeLatestSnapshot?: boolean
    includeNames?: boolean
    hasEvidence?: boolean
    /** Schedule tab: windowDate ≥ from (YYYY-MM-DD) */
    from?: string
    /** Schedule tab: windowDate ≤ to (YYYY-MM-DD) */
    to?: string
  } = {},
): Promise<PredictionListItem[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  // Plan-C T33 / ISC-41: comma-separated `include` token list. Schedule tab
  // adds `names` for inline V/T/region/source names; both tokens compose.
  const includeTokens: string[] = []
  if (opts.includeLatestSnapshot) includeTokens.push('latest_snapshot')
  if (opts.includeNames) includeTokens.push('names')
  if (includeTokens.length > 0) params.set('include', includeTokens.join(','))
  // m5 UI: 过滤无证据 prediction(分析师 proposal 列表只看 actionable 的)
  if (opts.hasEvidence) params.set('has_evidence', 'true')
  if (opts.from) params.set('from', opts.from)
  if (opts.to) params.set('to', opts.to)
  const qs = params.toString()
  return api<PredictionListItem[]>(`/predictions${qs ? `?${qs}` : ''}`)
}

// m5 UI 改进:GET /predictions/:id 现在 inline news_evidence 关联的新闻原文
export type NewsEvidenceWithItem = {
  evidenceId: string
  weight: 'HIGH' | 'MED' | 'LOW'
  cited: boolean
  addedAt: string
  news: {
    id: string
    title: string
    url: string
    sourceLabel: string
    sourceKind: string
    summaryZh: string | null
    rawSnippet: string | null
    publishedAt: string | null
  }
}

// m5 UI v2: 后端把 snapshots 引用的全部新闻打 lookup map,前端按 snapshot 分组着色
export type NewsItemSummary = {
  id: string
  title: string
  url: string
  sourceLabel: string
  sourceKind: string
  summaryZh: string | null
  rawSnippet: string | null
  publishedAt: string | null
}

export type PredictionDetailResponse = {
  prediction: Prediction
  snapshots: ConfidenceSnapshot[]
  dispatchTasks: DispatchTaskWithMedia[]
  evidence: NewsEvidenceWithItem[]
  newsById: Record<string, NewsItemSummary>
}

export async function getPredictionDetail(id: string): Promise<PredictionDetailResponse> {
  return api<PredictionDetailResponse>(`/predictions/${id}`)
}

export async function approvePrediction(id: string): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}/approve`, { method: 'POST', body: '{}' })
}

// (β) m5 UI 对齐:ANALYST 推送 PROPOSED → VALIDATED,DECIDER 工作台仅看 VALIDATED
export async function validatePrediction(id: string): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}/validate`, { method: 'POST', body: '{}' })
}

// F:DECIDER 把 VALIDATED 打回 → PROPOSED,reason 必须 ≥ 4 字
export async function sendBackPrediction(id: string, reason: string): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}/send-back`, {
    method: 'POST', body: JSON.stringify({ reason }),
  })
}

// ANALYST 删除 PROPOSED prediction(硬删 + 级联)
export async function deletePrediction(id: string): Promise<{ ok: boolean; deletedId: string }> {
  return api<{ ok: boolean; deletedId: string }>(`/predictions/${id}`, { method: 'DELETE' })
}

// ANALYST 编辑 PROPOSED prediction 的窗口(改 windowDate / windowHalf → 重算 kDays)
export async function updatePrediction(
  id: string,
  patch: { windowDate?: string; windowHalf?: 'AM' | 'PM' },
): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  })
}

export async function rejectPrediction(id: string, reason?: string): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}/reject`, {
    method: 'POST', body: JSON.stringify({ reason: reason ?? '' }),
  })
}

export async function setManualConfidence(
  id: string,
  input: { confidence: number; reason: string; ciLow?: number; ciHigh?: number },
): Promise<{ ok: boolean; snapshot: ConfidenceSnapshot }> {
  return api<{ ok: boolean; snapshot: ConfidenceSnapshot }>(`/predictions/${id}/manual-confidence`, {
    method: 'POST', body: JSON.stringify(input),
  })
}

// (β) 「📡 生成预测」新路径 — 拉新闻(用 settings.news_freshness_days 窗口)
// + 同步 drain extract → 创建/合并 prediction(必带 evidence)
export type SpawnFromNewsResult = {
  ok: boolean
  watchlistsProcessed: number
  newsFetched: number
  newsInserted: number
  extractAttempted: number
  predictionsCreated: number
  predictionsMerged: number
  llmDegraded: number
  errors: number
  perWatchlist: Array<{
    watchlistId: string
    name: string
    newsFetched: number
    newsInserted: number
    extracted: number
    created: number
    merged: number
    error?: string
  }>
}
export async function spawnFromNews(): Promise<SpawnFromNewsResult> {
  return api<SpawnFromNewsResult>('/predictions/spawn-from-news', {
    method: 'POST', body: '{}',
  })
}

// Plan-PP:pipeline stage trace(spawn-from-news 响应含 6 阶段漏斗)
export type StageName = 'search' | 'freshness' | 'rule_filter' | 'rerank' | 'ingest' | 'extract'
export type StageDropReason =
  | 'no-url' | 'no-title' | 'short-title' | 'no-cjk' | 'blocklist'
  | 'expired' | 'duplicate' | 'below-threshold' | 'over-cap'
export type StageDropEntry = {
  url: string
  title: string
  reason: StageDropReason
  detail?: string
}
export type StageKeptEntry = {
  url: string
  title: string
  detail?: string
}
export type StageTrace = {
  name: StageName
  watchlistName?: string
  in: number
  out: number
  durationMs: number
  params?: Record<string, unknown>
  dropped: StageDropEntry[]
  kept: StageKeptEntry[]
  note?: string
}

// 单 watchlist 版 — 前端按列表串行调,每条返回后展示进度
export type SpawnFromNewsForWatchlistResult = {
  ok: boolean
  watchlistId: string
  name: string
  newsFetched: number
  newsInserted: number
  extractAttempted: number
  predictionsCreated: number
  predictionsMerged: number
  llmDegraded: number
  skipped?: boolean
  reason?: string
  stages?: StageTrace[]
}
export async function spawnFromNewsForWatchlist(watchlistId: string): Promise<SpawnFromNewsForWatchlistResult> {
  return api<SpawnFromNewsForWatchlistResult>(`/predictions/spawn-from-news/${watchlistId}`, {
    method: 'POST', body: '{}',
  })
}

export async function recomputeNow(id: string): Promise<{ ok: boolean; mode: 'FULL' | 'INCR'; message: string }> {
  // m5 G5: 后端 recompute-now 改为真触发 fullRecalcQueue + manualTrigger=true (P5)
  // 返回 { ok, mode: 'FULL', message } —— 默认 FULL P5 模式
  return api<{ ok: boolean; mode: 'FULL' | 'INCR'; message: string }>(
    `/predictions/${id}/recompute-now`,
    { method: 'POST', body: '{}' },
  )
}
