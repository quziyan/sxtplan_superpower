import type { Worker } from 'bullmq'
import { createDb } from '@/db/client'
import type { Db } from '@/db/client'
import { shouldTriggerFull, type TriggerReason } from '../full-trigger'
import { createBullMQWorker } from '../helpers/createBullMQWorker'
import { refreshQueue } from '../queue'

/**
 * Full-recalc job payload (Plan-C T15, ISC-23).
 *
 * The full-recalc worker is the P1-P5 evaluator: it consumes
 * `full-recalc` queue jobs, asks `shouldTriggerFull` whether any priority
 * criterion is satisfied for the prediction, and (if yes) enqueues a
 * downstream FULL refresh job onto the `refresh` queue.
 *
 * `manualTrigger=true` short-circuits to P5 in `shouldTriggerFull` — used
 * by the analyst-facing "立即重算" path.
 */
export type FullRecalcJobData = {
  predictionId: string
  manualTrigger?: boolean
}

/**
 * Minimal queue surface used by the handler. Lets unit tests pass a mock
 * (no Redis, no BullMQ) while production wires up `refreshQueue`.
 */
export type FullRecalcQueueLike = {
  add: (
    name: string,
    data: { predictionId: string; kind: 'FULL' },
  ) => Promise<unknown>
}

/**
 * Pure handler — decoupled from BullMQ so we can unit-test it without Redis.
 *
 * Returns the trigger evaluation. When `triggered === true`, a FULL refresh
 * job has already been enqueued on `queue` before this function returns.
 */
export async function processFullRecalcJob(
  db: Db,
  data: FullRecalcJobData,
  queue: FullRecalcQueueLike = refreshQueue,
): Promise<TriggerReason> {
  const trigger = await shouldTriggerFull(db, data.predictionId, {
    manualTrigger: data.manualTrigger ?? false,
  })
  if (trigger.triggered) {
    await queue.add('full', { predictionId: data.predictionId, kind: 'FULL' })
  }
  return trigger
}

/**
 * BullMQ Worker factory. Connects to Redis and consumes the `full-recalc`
 * queue, delegating each job to `processFullRecalcJob`. Caller is responsible
 * for `worker.close()` on shutdown.
 */
export function createFullRecalcWorker(): Worker<FullRecalcJobData, TriggerReason> {
  const { db } = createDb('app')
  return createBullMQWorker<FullRecalcJobData, TriggerReason>({
    name: 'full-recalc',
    handler: async (job) => processFullRecalcJob(db, job.data),
  })
}
