import { getDefaultAdapterKey } from '@/dispatch/constants'
import { dispatchQueue } from '../queue'

/**
 * Minimal queue surface used by `triggerDispatchAfterApproval`. Lets unit
 * tests pass a mock (no Redis, no BullMQ) while production wires up the
 * real `dispatchQueue` exported from `../queue`.
 */
export type DispatchQueueLike = {
  add: (
    name: string,
    data: { predictionId: string; adapterKey: string },
  ) => Promise<unknown>
}

/**
 * Plan-C T16 / ISC-24 — post-approval trigger.
 *
 * Called from the `/predictions/:id/approve` route after the status
 * transition to `APPROVED` is committed. Adds a `dispatch` job onto the
 * dispatch queue so the dispatch worker can asynchronously call the
 * configured camera adapter without blocking the approve response.
 *
 * Plan-D Task 4 / ISC-C4: the default adapter key is now sourced from
 * `getDefaultAdapterKey()` (env-driven: CAMERA_BACKEND_KIND → SIMULATED_GZP_ENABLED → mock)
 * rather than hardcoded to `'simulated-gzp'`. Callers may still override.
 *
 * The `queue` parameter is exposed for testability — production callers
 * accept the default `dispatchQueue` import.
 */
export async function triggerDispatchAfterApproval(
  predictionId: string,
  adapterKey?: string,
  queue: DispatchQueueLike = dispatchQueue,
): Promise<void> {
  const key = adapterKey ?? getDefaultAdapterKey()
  await queue.add('dispatch', { predictionId, adapterKey: key })
}
