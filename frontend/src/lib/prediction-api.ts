import { api } from './api'
import type { DispatchTask } from './dispatch-api'
import type { MediaAsset } from './media-api'

export type PredictionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
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
  opts: { status?: PredictionStatus; limit?: number; includeLatestSnapshot?: boolean } = {},
): Promise<PredictionListItem[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  // Plan-C T33 / ISC-41: comma-separated `include` token list. Today only
  // `latest_snapshot` is supported; future flags can be appended without
  // breaking the contract.
  if (opts.includeLatestSnapshot) params.set('include', 'latest_snapshot')
  const qs = params.toString()
  return api<PredictionListItem[]>(`/predictions${qs ? `?${qs}` : ''}`)
}

export type PredictionDetailResponse = {
  prediction: Prediction
  snapshots: ConfidenceSnapshot[]
  dispatchTasks: DispatchTaskWithMedia[]
}

export async function getPredictionDetail(id: string): Promise<PredictionDetailResponse> {
  return api<PredictionDetailResponse>(`/predictions/${id}`)
}

export async function approvePrediction(id: string): Promise<{ ok: boolean; prediction: Prediction }> {
  return api<{ ok: boolean; prediction: Prediction }>(`/predictions/${id}/approve`, { method: 'POST', body: '{}' })
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

export async function recomputeNow(id: string): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>(`/predictions/${id}/recompute-now`, { method: 'POST', body: '{}' })
}
