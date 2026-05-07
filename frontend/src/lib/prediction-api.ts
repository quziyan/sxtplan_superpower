import { api } from './api'

export type PredictionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
export type HalfDay = 'AM' | 'PM'

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

export async function listPredictions(opts: { status?: PredictionStatus; limit?: number } = {}): Promise<Prediction[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return api<Prediction[]>(`/predictions${qs ? `?${qs}` : ''}`)
}

export async function getPredictionDetail(id: string): Promise<{ prediction: Prediction; snapshots: ConfidenceSnapshot[] }> {
  return api<{ prediction: Prediction; snapshots: ConfidenceSnapshot[] }>(`/predictions/${id}`)
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
