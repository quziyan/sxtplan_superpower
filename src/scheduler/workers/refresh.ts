import type { Worker } from 'bullmq'
import { runPredictionAgent, type RunPredictionAgentInput } from '@/agents/prediction-agent'
import type { Db } from '@/db/client'
import { createDb } from '@/db/client'
import type { infer as inferFnType } from '@/inference/client'
import { createBullMQWorker } from '../helpers/createBullMQWorker'

/**
 * Refresh queue job payload.
 * - INCR: incremental refresh triggered by new news evidence; carries the
 *   list of NewsItem ids that should be linked to the prediction.
 * - FULL: full recompute over the existing evidence pool.
 */
export type RefreshJobData = {
  predictionId: string
  kind: 'INCR' | 'FULL'
  newEvidenceNewsIds?: string[]
}

/**
 * Pure handler — decoupled from BullMQ so we can unit-test it without Redis.
 * The optional `inferFn` parameter is forwarded to `runPredictionAgent` for
 * dependency injection in tests; production callers omit it and the agent
 * uses the real LLM client.
 */
export async function processRefreshJob(
  db: Db,
  data: RefreshJobData,
  inferFn?: typeof inferFnType,
): Promise<{ confidence: number }> {
  // Conditional spread keeps `opts` strictly typed under
  // `exactOptionalPropertyTypes` — assigning `undefined` would be rejected.
  const opts: RunPredictionAgentInput = {
    predictionId: data.predictionId,
    kind: data.kind,
    ...(data.newEvidenceNewsIds ? { newEvidenceNewsIds: data.newEvidenceNewsIds } : {}),
  }
  const out = inferFn
    ? await runPredictionAgent(db, opts, inferFn)
    : await runPredictionAgent(db, opts)
  return { confidence: out.confidence }
}

/**
 * BullMQ Worker factory. Connects to Redis and consumes the `refresh` queue,
 * delegating each job to `processRefreshJob`. Caller is responsible for
 * `worker.close()` on shutdown.
 */
export function createRefreshWorker(): Worker<RefreshJobData, { confidence: number }> {
  const { db } = createDb('app')
  return createBullMQWorker<RefreshJobData, { confidence: number }>({
    name: 'refresh',
    handler: async (job) => processRefreshJob(db, job.data),
  })
}
