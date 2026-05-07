import { Queue } from 'bullmq'
import { loadEnv } from '@/env'

const env = loadEnv()

// BullMQ accepts a redis url string OR an ioredis instance
const connection = { url: env.REDIS_URL }

export const refreshQueue = new Queue<{ predictionId: string; kind: 'INCR' | 'FULL' }>('refresh', { connection })
export const fullRecalcQueue = new Queue<{ predictionId: string }>('full-recalc', { connection })
export const newsIngestQueue = new Queue<{ keywords: string[] }>('news-ingest', { connection })
export const dispatchQueue = new Queue<{ predictionId: string; adapterKey: string }>('dispatch', { connection })

/**
 * Media-fetch queue. Producer: T18 webhook ingest (when an OK envelope's
 * body carries `mediaUrls`). Consumer: T19 worker, which calls
 * `fetchAndPersist` (src/media/fetcher.ts) to pull bytes → OSS → MediaAsset.
 *
 * Job shape mirrors `FetchTask` exactly so the worker can pass it through
 * with no remapping.
 */
export const mediaFetchQueue = new Queue<{
  dispatchId: string
  sourceUrl: string
  mediaType: 'image' | 'video' | 'metadata'
}>('media-fetch', { connection })

/**
 * Retrospective queue (Plan-C T22, ISC-30). Producer: the periodic
 * retrospective tick (`tickRetrospective`) which scans for predictions
 * whose `window_date + M_default days < NOW()` and have no retrospective
 * row yet. Consumer: T22 worker, which delegates to `runRetrospectiveAgent`
 * (T21) to produce the 4-piece artifact + case-library entry.
 *
 * `reviewerNotes` is optional — the periodic tick never sets it, but the
 * job shape supports manual on-demand replays that pass operator context.
 */
export const retrospectiveQueue = new Queue<{
  predictionId: string
  reviewerNotes?: string
}>('retrospective', { connection })

export async function closeAllQueues() {
  await Promise.allSettled([
    refreshQueue.close(),
    fullRecalcQueue.close(),
    newsIngestQueue.close(),
    dispatchQueue.close(),
    mediaFetchQueue.close(),
    retrospectiveQueue.close(),
  ])
}
