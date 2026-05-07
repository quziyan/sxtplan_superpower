import { describe, expect, mock, test } from 'bun:test'
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
  test('default adapterKey: adds dispatch job with simulated-gzp', async () => {
    const { queue, add, calls } = makeMockQueue()

    await triggerDispatchAfterApproval('pred-abc', undefined, queue)

    expect(add).toHaveBeenCalledTimes(1)
    expect(calls.length).toBe(1)
    expect(calls[0]!.name).toBe('dispatch')
    expect(calls[0]!.data).toEqual({
      predictionId: 'pred-abc',
      adapterKey: 'simulated-gzp',
    })
  })

  test('default param call (no adapterKey arg) still uses simulated-gzp', async () => {
    // Verify the default value applies when omitting both adapterKey and queue
    // would hit Redis — so we still pass the queue but rely on adapterKey default.
    const { queue, calls } = makeMockQueue()

    // Two-arg form: only predictionId provided, queue overridden via 3rd arg.
    // To exercise the "default adapterKey" path we'd ideally call with one arg,
    // but the production default (`dispatchQueue`) would hit Redis. So we
    // pass an explicit `undefined` as adapterKey, which the runtime resolves
    // to the default. This matches how Hono routes will call it (one-arg).
    await triggerDispatchAfterApproval('pred-default', undefined, queue)

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
