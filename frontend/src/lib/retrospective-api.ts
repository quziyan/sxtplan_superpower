import { api } from './api'

// Plan-C T25 / ISC-33: frontend client for backend T23 retrospective routes.
// Mirrors the m2 API client style (see prediction-api.ts):
//   - shared `api` helper handles base URL + credentials + error parsing
//   - all timestamps are JSON-wire strings (ISO-8601), not Date
//   - keep types camelCase to mirror Drizzle's auto-camelCase responses
//
// Backend route shapes (src/modules/retrospective/routes.ts):
//   GET    /retrospectives           -> { ok: true, items:        RetrospectiveListItem[] }
//   GET    /retrospectives/:id       -> { ok: true, retrospective: RetrospectiveDetail }
//   POST   /retrospectives/:id/override -> { ok: true, retrospective: RetrospectiveDetail }

export type PredictionOutcome = 'HIT' | 'MISS' | 'NO_DATA'
export type CaptureOutcome = 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'

export type RetrospectiveListItem = {
  id: string
  predictionId: string
  predictionOutcome: PredictionOutcome
  captureOutcome: CaptureOutcome
  composite: number
  outcomeOverridden: boolean
  generatedAt: string
  prediction: {
    vehicleClass: string
    taskClass: string
    regionName: string | null
    windowDate: string
  }
}

export type RetrospectiveDetail = RetrospectiveListItem & {
  scoreV: number
  scoreR: number
  scoreW: number
  scoreT: number
  causalMd: string
  summaryMd: string
  evidenceNewsIds: string[]
  captureDispatchIds: string[]
  reviewerNotes: string | null
  overriddenReason: string | null
  updatedAt: string
}

export type RetrospectiveListFilter = {
  predictionOutcome?: PredictionOutcome
  captureOutcome?: CaptureOutcome
  overridden?: boolean
  limit?: number
  offset?: number
}

export type OverrideInput = {
  newPredictionOutcome?: PredictionOutcome
  newCaptureOutcome?: CaptureOutcome
  reason: string
}

export async function listRetrospectives(filter: RetrospectiveListFilter = {}): Promise<RetrospectiveListItem[]> {
  const params = new URLSearchParams()
  if (filter.predictionOutcome) params.set('predictionOutcome', filter.predictionOutcome)
  if (filter.captureOutcome) params.set('captureOutcome', filter.captureOutcome)
  if (typeof filter.overridden === 'boolean') params.set('overridden', String(filter.overridden))
  if (filter.limit !== undefined) params.set('limit', String(filter.limit))
  if (filter.offset !== undefined) params.set('offset', String(filter.offset))
  const qs = params.toString()
  const res = await api<{ ok: true; items: RetrospectiveListItem[] }>(`/retrospectives${qs ? `?${qs}` : ''}`)
  return res.items
}

export async function getRetrospective(id: string): Promise<RetrospectiveDetail> {
  const res = await api<{ ok: true; retrospective: RetrospectiveDetail }>(`/retrospectives/${id}`)
  return res.retrospective
}

export async function overrideRetrospective(id: string, input: OverrideInput): Promise<RetrospectiveDetail> {
  const res = await api<{ ok: true; retrospective: RetrospectiveDetail }>(`/retrospectives/${id}/override`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.retrospective
}
