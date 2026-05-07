// Plan-C T25 / ISC-33 + T27 / ISC-35: types for media-asset data.
//
// MediaAsset rows reach the frontend inlined under `dispatchTasks[].mediaAssets`
// in the GET /predictions/:id response (see prediction-api.ts). T27 closed
// the runtime gap from T25 — there is no longer a separate
// /dispatches/:id/media fetch, so this module is types-only.
//
// Field nullability mirrors the DB schema (src/db/schema/dispatch.ts
// mediaAssets): sizeBytes / sha256 / retentionUntil are nullable. UI code
// must handle null defensively (e.g. `m.sizeBytes ?? 0`).
export type MediaType = 'image' | 'video' | 'metadata'

export type MediaAsset = {
  id: string
  dispatchId: string
  ossUri: string
  sourceUrl: string
  mediaType: MediaType
  sizeBytes: number | null
  sha256: string | null
  scanStatus: string
  retentionUntil: string | null
  createdAt: string
}
