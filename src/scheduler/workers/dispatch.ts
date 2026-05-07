import type { Worker } from 'bullmq'
import type { Db } from '@/db/client'
import { createDb } from '@/db/client'
import { enqueueDispatch } from '@/dispatch/service'
import { createBullMQWorker } from '../helpers/createBullMQWorker'

/**
 * Dispatch queue job payload (Plan-C T16, ISC-24).
 *
 * Produced by the post-approval trigger (`triggerDispatchAfterApproval`)
 * once a prediction transitions to `APPROVED`. The worker delegates to
 * `enqueueDispatch`, which writes the QUEUED row, calls the camera
 * adapter, and updates the row to SENT with the externalId.
 */
export type DispatchJobData = {
  predictionId: string
  adapterKey: string
}

/**
 * Result returned by `processDispatchJob`. The `externalId` is supplied
 * by the upstream camera platform (or `null` if the adapter has not yet
 * acknowledged — m2 mock always returns one).
 */
export type DispatchJobResult = {
  dispatchId: string
  externalId: string | null
}

/**
 * Dependency-injection seam for the dispatch handler. Lets unit tests
 * supply a fake `enqueueDispatch` instead of hitting the real DB and
 * adapter pool. Production callers omit and the default delegates to
 * `@/dispatch/service`.
 */
export type DispatchDeps = {
  enqueueDispatch: (
    db: Db,
    params: { predictionId: string; adapterKey: string },
  ) => Promise<{ id: string; externalId: string | null }>
}

const defaultDeps: DispatchDeps = {
  enqueueDispatch: async (db, params) => {
    const task = await enqueueDispatch(db, params)
    return { id: task.id, externalId: task.externalId }
  },
}

/**
 * Pure handler — decoupled from BullMQ so we can unit-test it without
 * Redis. Calls `deps.enqueueDispatch(db, data)` and returns a normalised
 * `{dispatchId, externalId}` shape.
 */
export async function processDispatchJob(
  db: Db,
  data: DispatchJobData,
  deps: DispatchDeps = defaultDeps,
): Promise<DispatchJobResult> {
  const task = await deps.enqueueDispatch(db, {
    predictionId: data.predictionId,
    adapterKey: data.adapterKey,
  })
  return { dispatchId: task.id, externalId: task.externalId }
}

/**
 * BullMQ Worker factory. Connects to Redis and consumes the `dispatch`
 * queue, delegating each job to `processDispatchJob`. Caller is
 * responsible for `worker.close()` on shutdown.
 */
export function createDispatchWorker(): Worker<DispatchJobData, DispatchJobResult> {
  const { db } = createDb('app')
  return createBullMQWorker<DispatchJobData, DispatchJobResult>({
    name: 'dispatch',
    handler: async (job) => processDispatchJob(db, job.data),
  })
}
