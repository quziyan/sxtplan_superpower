import { createHash } from 'node:crypto'
import type { Db } from '@/db/client'
import { mediaAssets, type MediaAsset } from '@/db/schema/dispatch'
import type { OssAdapter } from './oss-adapter'
import { getOssAdapter } from './oss-adapter-pool'
import { computeRetentionUntil } from './retention'

export type FetchTask = {
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}

export type FetcherDeps = {
  /**
   * Mockable in tests; defaults to the OssAdapter pool singleton (T4 of
   * cnp-adapters-unify). Tests inject a recording stub via
   * `tests/helpers/oss-stub.ts → makeOssStub()`.
   */
  oss: OssAdapter
}

/**
 * Lazy default-deps resolver. We must not capture `getOssAdapter()` at
 * module load — that would force adapter init at import time and break
 * tests that swap adapters via `resetOssAdapterForTests()` post-import.
 * Instead, resolve per-call (only when no explicit `deps` is passed).
 */
function getDefaultDeps(): FetcherDeps {
  return { oss: getOssAdapter() }
}

function extensionFor(mediaType: FetchTask['mediaType']): string {
  if (mediaType === 'video') return 'mp4'
  if (mediaType === 'image') return 'jpg'
  return 'json'
}

/**
 * Fetch a remote media URL, persist to OSS via the unified OssAdapter,
 * and record a MediaAsset row.
 *
 * Dependency-injection-friendly: callers (tests in particular) pass an
 * OssAdapter (e.g. via `makeOssStub()`) to avoid real network/OSS calls
 * and to sidestep `mock.module` global-leak issues encountered in m1/m2.
 */
export async function fetchAndPersist(
  db: Db,
  t: FetchTask,
  deps: FetcherDeps = getDefaultDeps(),
): Promise<MediaAsset> {
  const res = await fetch(t.sourceUrl)
  if (!res.ok) {
    throw new Error(`fetch ${t.sourceUrl} → ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const ext = extensionFor(t.mediaType)
  const key = `media/${t.dispatchId}/${sha256.slice(0, 12)}.${ext}`
  const { uri } = await deps.oss.put(key, buffer)
  const retentionUntil = computeRetentionUntil()
  const [row] = await db
    .insert(mediaAssets)
    .values({
      dispatchId: t.dispatchId,
      ossUri: uri,
      sourceUrl: t.sourceUrl,
      mediaType: t.mediaType,
      sizeBytes: buffer.byteLength,
      sha256,
      scanStatus: 'OK',
      retentionUntil,
    })
    .returning()
  if (!row) {
    throw new Error('fetchAndPersist: insert returned no row')
  }
  return row
}
