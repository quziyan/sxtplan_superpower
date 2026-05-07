import { describe, expect, mock, test } from 'bun:test'
import IORedis from 'ioredis'
import type { Db } from '@/db/client'
import type { MediaAsset } from '@/db/schema/dispatch'
import type { FetchTask, FetcherDeps } from '@/media/fetcher'
import {
  createMediaFetchWorker,
  processMediaFetchJob,
  type MediaFetchDeps,
  type MediaFetchJobData,
} from '@/scheduler/workers/media-fetch'

/**
 * Build a mock `fetchAndPersist` that returns a configurable MediaAsset
 * row and captures every call so tests can assert on the forwarded args.
 *
 * The mock matches the real signature `(db, task, deps?)` so it can be
 * substituted into `MediaFetchDeps` without an `as any` cast.
 */
function makeMockFetchAndPersist(returnVal: MediaAsset) {
  const calls: Array<{ db: Db; task: FetchTask; deps?: FetcherDeps }> = []
  const fn = mock(
    async (db: Db, task: FetchTask, deps?: FetcherDeps): Promise<MediaAsset> => {
      const entry: { db: Db; task: FetchTask; deps?: FetcherDeps } = { db, task }
      if (deps !== undefined) entry.deps = deps
      calls.push(entry)
      return returnVal
    },
  )
  const mfDeps: MediaFetchDeps = { fetchAndPersist: fn }
  return { deps: mfDeps, fn, calls }
}

/**
 * Build a fake MediaAsset row matching the Drizzle inferred shape.
 */
function fakeMediaAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'media-asset-1',
    dispatchId: 'dispatch-1',
    ossUri: 'oss://bucket/media/dispatch-1/abc123abc123.jpg',
    sourceUrl: 'https://camera.example.com/snap/1.jpg',
    mediaType: 'image',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    scanStatus: 'OK',
    retentionUntil: new Date('2030-01-01T00:00:00Z'),
    createdAt: new Date('2025-05-07T00:00:00Z'),
    ...overrides,
  }
}

async function redisReachable(): Promise<boolean> {
  const c = new IORedis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  try {
    await c.connect()
    await c.quit()
    return true
  } catch {
    try { c.disconnect() } catch { /* ignore */ }
    return false
  }
}

// `processMediaFetchJob` is pure: it never touches the real DB because
// the `fetchAndPersist` dep is injected. We can pass a stub `Db`-shaped
// value — the mock never inspects it.
const STUB_DB = {} as Db

describe('processMediaFetchJob', () => {
  test('happy path: returns the MediaAsset row produced by fetchAndPersist', async () => {
    const expected = fakeMediaAsset()
    const { deps } = makeMockFetchAndPersist(expected)
    const data: MediaFetchJobData = {
      dispatchId: 'dispatch-1',
      sourceUrl: 'https://camera.example.com/snap/1.jpg',
      mediaType: 'image',
    }

    const out = await processMediaFetchJob(STUB_DB, data, deps)

    expect(out).toBe(expected)
  })

  test('forwards (db, data) verbatim to fetchAndPersist', async () => {
    const { deps, fn, calls } = makeMockFetchAndPersist(fakeMediaAsset())
    const data: MediaFetchJobData = {
      dispatchId: 'dispatch-42',
      sourceUrl: 'https://camera.example.com/snap/42.jpg',
      mediaType: 'image',
    }

    await processMediaFetchJob(STUB_DB, data, deps)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(calls[0]!.db).toBe(STUB_DB)
    expect(calls[0]!.task).toEqual(data)
  })

  test('error path: fetchAndPersist failure propagates from the handler', async () => {
    const failing: MediaFetchDeps = {
      fetchAndPersist: async () => {
        throw new Error('OSS upload failed')
      },
    }

    await expect(
      processMediaFetchJob(
        STUB_DB,
        {
          dispatchId: 'dispatch-err',
          sourceUrl: 'https://camera.example.com/snap/err.jpg',
          mediaType: 'image',
        },
        failing,
      ),
    ).rejects.toThrow(/OSS upload failed/)
  })

  test('passes through every mediaType: image, video, metadata', async () => {
    for (const mediaType of ['image', 'video', 'metadata'] as const) {
      const expected = fakeMediaAsset({ mediaType, id: `asset-${mediaType}` })
      const { deps, calls } = makeMockFetchAndPersist(expected)

      const out = await processMediaFetchJob(
        STUB_DB,
        {
          dispatchId: 'dispatch-mt',
          sourceUrl: `https://camera.example.com/snap/${mediaType}`,
          mediaType,
        },
        deps,
      )

      expect(out.mediaType).toBe(mediaType)
      expect(calls[0]!.task.mediaType).toBe(mediaType)
    }
  })
})

// Probe Redis at module load time so test.skipIf can use the boolean directly.
const REDIS_OK = await redisReachable()

describe('createMediaFetchWorker (Redis-gated)', () => {
  test.skipIf(!REDIS_OK)(
    'creates a Worker bound to the media-fetch queue and closes cleanly',
    async () => {
      const worker = createMediaFetchWorker()
      try {
        expect(worker.name).toBe('media-fetch')
      } finally {
        await worker.close()
      }
    },
  )
})
