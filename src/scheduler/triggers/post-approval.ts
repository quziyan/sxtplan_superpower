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
 * The default adapter key is `simulated-gzp` per Plan-C; callers may
 * override (e.g. for tests or alternative deployments).
 *
 * The `queue` parameter is exposed for testability — production callers
 * accept the default `dispatchQueue` import.
 */
export async function triggerDispatchAfterApproval(
  predictionId: string,
  adapterKey: string = 'simulated-gzp',
  queue: DispatchQueueLike = dispatchQueue,
): Promise<void> {
  await queue.add('dispatch', { predictionId, adapterKey })
}
