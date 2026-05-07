import { api } from './api'

// Plan-C T25 / ISC-33: frontend client for media-asset data.
// Mirrors the m2 API client style (see prediction-api.ts).
//
// Endpoint gap (noted for T29 — MediaGallery):
//   There is NO list-media-by-dispatch route in the backend yet, and the
//   GET /predictions/:id route does NOT inline mediaAssets either. T29
//   must add one of:
//     (a) GET /dispatches/:id/media -> { items: MediaAsset[] }
//     (b) inline mediaAssets[] inside an extended GET /predictions/:id
//         (already needed for dispatchTasks per T27 — see dispatch-api.ts)
//
//   The function below is the placeholder shape T29 will wire up. It
//   currently calls the (a) variant — the most natural REST shape — and
//   will start passing the moment T29 ships the route. We intentionally
//   keep it implemented (rather than `throw new Error(...)`) so the
//   component layer can compile + type-check today; a missing route
//   surfaces as a 404 ApiError at runtime, which is a clean signal that
//   T29 hasn't been completed yet.
//
// Field nullability note: the MediaAsset type below mirrors the spec from
// Plan-C T25 (sizeBytes/sha256/retentionUntil typed as required), but the
// underlying DB columns (src/db/schema/dispatch.ts mediaAssets) are
// nullable for sizeBytes, sha256, and retentionUntil. Whichever route
// T29 introduces should either:
//   - coerce nulls to defaults server-side before returning, or
//   - relax these fields here to `| null`.
// We've chosen the spec-faithful types so callers can write strict UI
// today; the server contract will need to honor it.

export type MediaType = 'image' | 'video' | 'metadata'

export type MediaAsset = {
  id: string
  dispatchId: string
  ossUri: string
  sourceUrl: string
  mediaType: MediaType
  sizeBytes: number
  sha256: string
  scanStatus: string
  retentionUntil: string
  createdAt: string
}

export async function listMediaAssetsByDispatch(dispatchId: string): Promise<MediaAsset[]> {
  // T29-pending route. Returns { items } once implemented; until then
  // this surfaces as ApiError(404) — caller should handle the gap.
  const res = await api<{ ok: true; items: MediaAsset[] }>(`/dispatches/${dispatchId}/media`)
  return res.items
}
