import { describe, expect, mock, test } from 'bun:test'
import IORedis from 'ioredis'
import type { Db } from '@/db/client'
import {
  createDispatchWorker,
  processDispatchJob,
  type DispatchDeps,
} from '@/scheduler/workers/dispatch'

/**
 * Build a mock `enqueueDispatch` that returns a configurable result and
 * captures every call so tests can assert on the forwarded args.
 */
function makeMockEnqueue(returnVal: { id: string; externalId: string | null }) {
  const calls: Array<{
    db: Db
    params: { predictionId: string; adapterKey: string }
  }> = []
  const fn = mock(
    async (
      db: Db,
      params: { predictionId: string; adapterKey: string },
    ) => {
      calls.push({ db, params })
      return returnVal
    },
  )
  const deps: DispatchDeps = { enqueueDispatch: fn }
  return { deps, fn, calls }
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

// `processDispatchJob` is pure: it never touches the real DB because the
// `enqueueDispatch` dep is injected. So we can pass a stub `Db`-shaped
// value — the mock never inspects it.
const STUB_DB = {} as Db

describe('processDispatchJob', () => {
  test('happy path: forwards data to enqueueDispatch and returns dispatchId+externalId', async () => {
    const { deps, fn, calls } = makeMockEnqueue({
      id: 'dispatch-123',
      externalId: 'ext-abc',
    })

    const out = await processDispatchJob(
      STUB_DB,
      { predictionId: 'pred-1', adapterKey: 'simulated-gzp' },
      deps,
    )

    expect(out).toEqual({ dispatchId: 'dispatch-123', externalId: 'ext-abc' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(calls[0]!.params).toEqual({
      predictionId: 'pred-1',
      adapterKey: 'simulated-gzp',
    })
  })

  test('passes adapterKey verbatim (no default substitution at handler layer)', async () => {
    const { deps, calls } = makeMockEnqueue({ id: 'd-2', externalId: null })

    await processDispatchJob(
      STUB_DB,
      { predictionId: 'pred-2', adapterKey: 'mock' },
      deps,
    )

    expect(calls[0]!.params.adapterKey).toBe('mock')
  })

  test('null externalId from adapter is preserved in the result', async () => {
    const { deps } = makeMockEnqueue({ id: 'd-3', externalId: null })

    const out = await processDispatchJob(
      STUB_DB,
      { predictionId: 'pred-3', adapterKey: 'mock' },
      deps,
    )

    expect(out.dispatchId).toBe('d-3')
    expect(out.externalId).toBeNull()
  })

  test('error path: enqueueDispatch failure propagates from the handler', async () => {
    const failing: DispatchDeps = {
      enqueueDispatch: async () => {
        throw new Error('adapter exploded')
      },
    }

    await expect(
      processDispatchJob(
        STUB_DB,
        { predictionId: 'pred-err', adapterKey: 'mock' },
        failing,
      ),
    ).rejects.toThrow(/adapter exploded/)
  })
})

// Probe Redis at module load time so test.skipIf can use the boolean directly.
const REDIS_OK = await redisReachable()

describe('createDispatchWorker (Redis-gated)', () => {
  test.skipIf(!REDIS_OK)(
    'creates a Worker bound to the dispatch queue and closes cleanly',
    async () => {
      const worker = createDispatchWorker()
      try {
        expect(worker.name).toBe('dispatch')
      } finally {
        await worker.close()
      }
    },
  )
})
