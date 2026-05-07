import { api } from './api'

// Plan-C T25 / ISC-33 + T27 / ISC-35: frontend client for dispatch task data.
// Mirrors the m2 API client style (see prediction-api.ts).
//
// Backend route shapes:
//   POST /predictions/:id/cancel  (T24, src/modules/prediction/routes.ts)
//        body: { reason: string }
//        -> { ok: true, dispatch: DispatchTask }
//
// Listing dispatches: T27 resolved the gap by inlining `dispatchTasks[]`
// (with nested `mediaAssets`) inside GET /predictions/:id — see
// PredictionDetailResponse in prediction-api.ts. There is no separate
// list-by-prediction route; the detail call is the single source of truth.
// Types here are still the canonical DispatchTask shape consumed by
// DispatchPanel + by the cancel response below.

export type DispatchState =
  | 'QUEUED'
  | 'SENT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED_BY_ADAPTER'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'TIMED_OUT'

export type DispatchTask = {
  id: string
  predictionId: string
  adapterKey: string
  externalId: string | null
  state: DispatchState
  cancellationReason: string | null
  callbackAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CancelInput = { reason: string }

export async function cancelPrediction(
  predictionId: string,
  input: CancelInput,
): Promise<{ ok: true; dispatch: DispatchTask }> {
  return api<{ ok: true; dispatch: DispatchTask }>(`/predictions/${predictionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
