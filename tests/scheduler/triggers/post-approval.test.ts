import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import {
  triggerDispatchAfterApproval,
  type DispatchQueueLike,
} from '@/scheduler/triggers/post-approval'

/** Builds a queue mock that captures every `add(...)` call. */
function makeMockQueue() {
  const calls: Array<{
    name: string
    data: { predictionId: string; adapterKey: string }
  }> = []
  const add = mock(
    async (
      name: string,
      data: { predictionId: string; adapterKey: string },
    ) => {
      calls.push({ name, data })
      return { id: `mock-${calls.length}` }
    },
  )
  const queue: DispatchQueueLike = { add }
  return { queue, add, calls }
}

describe('triggerDispatchAfterApproval', () => {
  // Plan-D Task 4 / ISC-C4: default adapterKey is now env-driven via
  // `getDefaultAdapterKey()`. Snapshot + restore the env vars it consults
  // so tests in this file (and downstream files) don't see leaked state.
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    envSnapshot = {
      CAMERA_BACKEND_KIND: process.env.CAMERA_BACKEND_KIND,
      SIMULATED_GZP_ENABLED: process.env.SIMULATED_GZP_ENABLED,
    }
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('default adapterKey: env-driven via getDefaultAdapterKey() — falls back to "mock" when no env set', async () => {
    delete process.env.CAMERA_BACKEND_KIND
    delete process.env.SIMULATED_GZP_ENABLED
    resetEnvCacheForTests()

    const { queue, add, calls } = makeMockQueue()

    await triggerDispatchAfterApproval('pred-abc', undefined, queue)

    expect(add).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(1)
    expect(calls[0]!.name).toBe('dispatch')
    expect(calls[0]!.data).toEqual({
      predictionId: 'pred-abc',
      adapterKey: 'mock',
    })
  })

  test('default adapterKey: respects CAMERA_BACKEND_KIND=simulated-gzp', async () => {
    process.env.CAMERA_BACKEND_KIND = 'simulated-gzp'
    resetEnvCacheForTests()

    const { queue, calls } = makeMockQueue()

    await triggerDispatchAfterApproval('pred-default', undefined, queue)

    expect(calls.length).toBe(1)
    expect(calls[0]!.data.adapterKey).toBe('simulated-gzp')
  })

  test('default adapterKey: respects SIMULATED_GZP_ENABLED=true (m3 legacy flag)', async () => {
    delete process.env.CAMERA_BACKEND_KIND
    process.env.SIMULATED_GZP_ENABLED = 'true'
    resetEnvCacheForTests()

    const { queue, calls } = makeMockQueue()

    await triggerDispatchAfterApproval('pred-legacy', undefined, queue)

    expect(calls.length).toBe(1)
    expect(calls[0]!.data.adapterKey).toBe('simulated-gzp')
  })

  test('custom adapterKey override is forwarded into the job payload', async () => {
    const { queue, add, calls } = makeMockQueue()

    await triggerDispatchAfterApproval('pred-xyz', 'custom-adapter', queue)

    expect(add).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(1)
    expect(calls[0]!.name).toBe('dispatch')
    expect(calls[0]!.data).toEqual({
      predictionId: 'pred-xyz',
      adapterKey: 'custom-adapter',
    })
  })

  test('queue.add rejection propagates to caller', async () => {
    const failing: DispatchQueueLike = {
      add: async () => {
        throw new Error('redis down')
      },
    }

    await expect(
      triggerDispatchAfterApproval('pred-fail', 'simulated-gzp', failing),
    ).rejects.toThrow(/redis down/)
  })
})
