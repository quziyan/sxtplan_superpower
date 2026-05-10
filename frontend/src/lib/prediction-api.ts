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

export type PredictionListItem = Prediction & {
  latestSnapshot?: LatestSnapshotSummary | null
}

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
  opts: { status?: PredictionStatus; limit?: number; includeLatestSnapshot?: boolean; hasEvidence?: boolean } = {},
): Promise<PredictionListItem[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  // Plan-C T33 / ISC-41: comma-separated `include` token list. Today only
  // `latest_snapshot` is supported; future flags can be appended without
  // breaking the contract.
  if (opts.includeLatestSnapshot) params.set('include', 'latest_snapshot')
  // m5 UI: 过滤无证据 prediction(分析师 proposal 列表只看 actionable 的)
  if (opts.hasEvidence) params.set('has_evidence', 'true')
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

// 预测自动/手动生产 — 对所有 active watchlist 在未来 N 天内确保 PROPOSED 预测覆盖
export type SpawnAllResult = {
  ok: boolean
  totalSpawned: number
  totalSkipped: number
  watchlistsProcessed: number
  results: Array<{ watchlistId: string; watchlistName: string; spawned: number; skipped: number }>
}
export async function spawnFromAllWatchlists(coverageDays?: number): Promise<SpawnAllResult> {
  return api<SpawnAllResult>('/predictions/spawn-from-all', {
    method: 'POST',
    body: JSON.stringify(coverageDays !== undefined ? { coverageDays } : {}),
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
