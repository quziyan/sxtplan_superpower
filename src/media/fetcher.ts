import { createHash } from 'node:crypto'
import type { Db } from '@/db/client'
import { mediaAssets, type MediaAsset } from '@/db/schema/dispatch'
import { putObject as defaultPutObject } from './oss-client'
import { computeRetentionUntil } from './retention'

export type FetchTask = {
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}

export type FetcherDeps = {
  /** Mockable in tests; defaults to the real OSS client wrapper. */
  putObject: (key: string, body: Buffer) => Promise<{ uri: string }>
}

const defaultDeps: FetcherDeps = { putObject: defaultPutObject }

function extensionFor(mediaType: FetchTask['mediaType']): string {
  if (mediaType === 'video') return 'mp4'
  if (mediaType === 'image') return 'jpg'
  return 'json'
}

/**
 * Fetch a remote media URL, persist to OSS, and record a MediaAsset row.
 *
 * Dependency-injection-friendly: callers (tests in particular) can pass
 * a mock `putObject` to avoid real network/OSS calls and to sidestep
 * `mock.module` global-leak issues encountered earlier in m1/m2.
 */
export async function fetchAndPersist(
  db: Db,
  t: FetchTask,
  deps: FetcherDeps = defaultDeps,
): Promise<MediaAsset> {
  const res = await fetch(t.sourceUrl)
  if (!res.ok) {
    throw new Error(`fetch ${t.sourceUrl} → ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const ext = extensionFor(t.mediaType)
  const key = `media/${t.dispatchId}/${sha256.slice(0, 12)}.${ext}`
  const { uri } = await deps.putObject(key, buffer)
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
