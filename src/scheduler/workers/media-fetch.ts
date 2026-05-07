import { Worker } from 'bullmq'
import type { Db } from '@/db/client'
import { createDb } from '@/db/client'
import { loadEnv } from '@/env'
import type { MediaAsset } from '@/db/schema/dispatch'
import { fetchAndPersist as defaultFetchAndPersist } from '@/media/fetcher'

/**
 * Media-fetch queue job payload (Plan-C T19, ISC-27 §7).
 *
 * Producer: post-dispatch trigger (the dispatch result body carries
 * `mediaUrls`). Consumer: this worker, which delegates to
 * `fetchAndPersist` (src/media/fetcher.ts) — that helper pulls the
 * remote URL, uploads bytes to OSS, and records a MediaAsset row.
 */
export type MediaFetchJobData = {
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}

/**
 * Dependency-injection seam for the media-fetch handler. Lets unit
 * tests supply a fake `fetchAndPersist` instead of hitting the real
 * network/OSS/DB stack. Production callers omit it and the default
 * delegates to `@/media/fetcher`.
 *
 * We mock the outer `fetchAndPersist` (rather than the inner
 * `putObject` of T11) — that gives the worker test cleaner separation
 * from the fetcher's internals.
 */
export type MediaFetchDeps = {
  fetchAndPersist: typeof defaultFetchAndPersist
}

const defaultDeps: MediaFetchDeps = { fetchAndPersist: defaultFetchAndPersist }

/**
 * Pure handler — decoupled from BullMQ so we can unit-test it without
 * Redis. Forwards `(db, data)` verbatim to `deps.fetchAndPersist` and
 * returns the persisted `MediaAsset` row.
 */
export async function processMediaFetchJob(
  db: Db,
  data: MediaFetchJobData,
  deps: MediaFetchDeps = defaultDeps,
): Promise<MediaAsset> {
  return await deps.fetchAndPersist(db, data)
}

/**
 * BullMQ Worker factory. Connects to Redis and consumes the
 * `media-fetch` queue, delegating each job to `processMediaFetchJob`.
 * Caller is responsible for `worker.close()` on shutdown.
 */
export function createMediaFetchWorker(): Worker<MediaFetchJobData, MediaAsset> {
  const env = loadEnv()
  const { db } = createDb('app')
  return new Worker<MediaFetchJobData, MediaAsset>(
    'media-fetch',
    async (job) => processMediaFetchJob(db, job.data),
    { connection: { url: env.REDIS_URL } },
  )
}
