import { api } from './api'

// Plan-C T25 / ISC-33: frontend client for dispatch task data.
// Mirrors the m2 API client style (see prediction-api.ts).
//
// Backend route shapes:
//   POST /predictions/:id/cancel  (T24, src/modules/prediction/routes.ts)
//        body: { reason: string }
//        -> { ok: true, dispatch: DispatchTask }
//
// Endpoint gap (noted for T27 — DispatchPanel):
//   There is NO list-dispatch-by-prediction route yet, and the existing
//   GET /predictions/:id route only returns { prediction, snapshots } —
//   it does NOT inline dispatch tasks. T27 must either:
//     (a) extend GET /predictions/:id to inline a dispatchTasks[] field, or
//     (b) add a new route, e.g. GET /predictions/:id/dispatches, and a
//         corresponding `listDispatchesByPrediction()` here.
//   Until then this client only exposes the cancel call.

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
