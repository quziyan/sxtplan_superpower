import type { Worker } from 'bullmq'
import { createDb, type Db } from '@/db/client'
import { loadEnv } from '@/env'
import { runNewsTriageAgent } from '@/agents/news-triage-agent'
import type { infer as inferFnType } from '@/inference/client'
import { createBullMQWorker } from '../helpers/createBullMQWorker'

/**
 * News-triage worker (Plan-E Task 8, G3 / ISC-G3.1..G3.5).
 *
 * Producer: `tickNewsIngest` (Task 7) enqueues one job per (prediction × news)
 * candidate pair surfaced by the matcher.
 *
 * Consumer: this worker invokes `runNewsTriageAgent` (a real LLM call) to
 * decide whether the news is informative for the prediction, and if so at
 * what strength (HIGH / MED / LOW). § 2D rules:
 *   - !relevant or LOW → no-op (drop on the floor; we don't refresh).
 *   - MED or HIGH → evidence is linked (the agent itself writes the
 *     `news_evidence` row when relevant=true, including the chosen weight,
 *     so the worker doesn't double-insert; `evidenceWritten` reflects the
 *     MED+ gate the worker enforces semantically).
 *   - HIGH only → enqueue a `refresh` INCR job carrying `newEvidenceNewsIds`
 *     so the prediction agent knows which news to read in this pass.
 *
 * Note on the LOW-but-relevant case: `runNewsTriageAgent` writes the
 * evidence on any relevant=true outcome (current contract). When the worker
 * gates on LOW it returns `evidenceWritten: false` — that field reflects
 * "did the worker decide this was MED+ evidence", not "did any DB write
 * occur upstream". Tests assert the worker's own decision.
 */
export type NewsTriageJobData = {
  predictionId: string
  newsId: string
}

export type NewsTriageJobResult = {
  relevant: boolean
  weight: 'HIGH' | 'MED' | 'LOW'
  evidenceWritten: boolean
  refreshEnqueued: boolean
}

/**
 * Refresh-queue surface this worker uses. Mirrors `RefreshJobData` from
 * `workers/refresh.ts` for the INCR call shape. Kept local so tests can
 * supply a fake without pulling in `bullmq`.
 */
export type RefreshQueueLike = {
  add: (
    name: string,
    data: { predictionId: string; kind: 'INCR'; newEvidenceNewsIds: string[] },
  ) => Promise<unknown>
}

/**
 * Pure handler — no Redis dependency. Tests call this directly with a fake
 * `refreshQueue`. `inferFn` is optional dependency injection for forcing
 * LLM failures (Test 3); when omitted the agent uses the real client.
 */
export async function processNewsTriageJob(
  db: Db,
  data: NewsTriageJobData,
  refreshQueue: RefreshQueueLike,
  inferFn?: typeof inferFnType,
): Promise<NewsTriageJobResult> {
  const out = inferFn
    ? await runNewsTriageAgent(db, { newsId: data.newsId, predictionId: data.predictionId }, inferFn)
    : await runNewsTriageAgent(db, { newsId: data.newsId, predictionId: data.predictionId })

  if (!out.relevant || out.weight === 'LOW') {
    return {
      relevant: out.relevant,
      weight: out.weight,
      evidenceWritten: false,
      refreshEnqueued: false,
    }
  }

  // MED+ → the agent already wrote `news_evidence` (relevant=true branch
  // in runNewsTriageAgent). We don't re-insert: the table has no
  // (prediction_id, news_id) UNIQUE constraint, so a defensive second
  // INSERT would duplicate the link. Single source of truth = the agent.

  let refreshEnqueued = false
  if (out.weight === 'HIGH') {
    await refreshQueue.add('incr', {
      predictionId: data.predictionId,
      kind: 'INCR',
      newEvidenceNewsIds: [data.newsId],
    })
    refreshEnqueued = true
  }

  return {
    relevant: out.relevant,
    weight: out.weight,
    evidenceWritten: true,
    refreshEnqueued,
  }
}

/**
 * BullMQ Worker factory. Caller owns lifecycle (close on shutdown).
 *
 * Lazy-imports `refreshQueue` to avoid a module-load circular dep — Task 9
 * will register `newsTriageQueue` in `queue.ts`, but for Task 8 we only read.
 */
export function createNewsTriageWorker(): Worker<NewsTriageJobData, NewsTriageJobResult> {
  const env = loadEnv()
  const { db } = createDb('app')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { refreshQueue } = require('../queue') as { refreshQueue: RefreshQueueLike }
  return createBullMQWorker<NewsTriageJobData, NewsTriageJobResult>({
    name: 'news-triage',
    handler: async (job) => processNewsTriageJob(db, job.data, refreshQueue),
    options: { concurrency: env.NEWS_TRIAGE_CONCURRENCY },
  })
}
