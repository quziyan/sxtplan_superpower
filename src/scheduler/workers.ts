// m3: refresh worker wired (Plan-C T13). news-ingest worker remains
// stubbed and will be added incrementally.
// m3: cadence tick wired (Plan-C T14) — periodic INCR enqueue for due predictions.
// m3: full-recalc worker wired (Plan-C T15) — P1-P5 evaluator → FULL job.
// m3: dispatch worker wired (Plan-C T16, ISC-24) — consumes post-approval
// trigger jobs and delegates to enqueueDispatch.
// m3: media-fetch worker wired (Plan-C T19, ISC-27 §7) — pulls dispatch
// result media URLs to OSS and records MediaAsset rows.
// m3: retrospective worker + tick wired (Plan-C T22, ISC-30) — periodic
// scan for due predictions enqueues retro jobs that delegate to
// runRetrospectiveAgent (T21).
// The queue definitions live in queue.ts.

import type { Worker } from 'bullmq'
import { closeAllQueues } from './queue'
import { scheduleAutoCancelTick } from './workers/auto-cancel'
import { scheduleCadenceTick } from './workers/cadence'
import { createDispatchWorker } from './workers/dispatch'
import { createFullRecalcWorker } from './workers/full-recalc'
import { createMediaFetchWorker } from './workers/media-fetch'
import { scheduleNewsIngestTick } from './workers/news-ingest'
import { createNewsTriageWorker } from './workers/news-triage'
import { schedulePredictionSpawnTick } from './workers/prediction-spawn'
import { createRefreshWorker } from './workers/refresh'
import { createRetrospectiveWorker, scheduleRetrospectiveTick } from './workers/retrospective'

const workers: Worker[] = []
const intervals: ReturnType<typeof setInterval>[] = []

export async function startWorkers(): Promise<void> {
  workers.push(createRefreshWorker())
  console.log('[scheduler] refresh worker registered')
  workers.push(createFullRecalcWorker())
  console.log('[scheduler] full-recalc worker registered')
  workers.push(createDispatchWorker())
  console.log('[scheduler] dispatch worker registered')
  workers.push(createMediaFetchWorker())
  console.log('[scheduler] media-fetch worker registered')
  workers.push(createRetrospectiveWorker())
  console.log('[scheduler] retrospective worker registered')
  workers.push(createNewsTriageWorker())
  console.log('[scheduler] news-triage worker registered')
  intervals.push(scheduleCadenceTick())
  console.log('[scheduler] cadence tick scheduled (60s)')
  intervals.push(scheduleRetrospectiveTick())
  console.log('[scheduler] retrospective tick scheduled (5m)')
  intervals.push(scheduleAutoCancelTick())
  console.log('[scheduler] auto-cancel tick scheduled (5m)')
  intervals.push(scheduleNewsIngestTick())
  console.log('[scheduler] news-ingest tick scheduled (15m default)')
  intervals.push(schedulePredictionSpawnTick())
  console.log('[scheduler] prediction-spawn tick scheduled (24h)')
  console.log('[scheduler] queues defined: refresh, full-recalc, news-ingest, news-triage, dispatch, media-fetch, retrospective')
}

export async function stopWorkers(): Promise<void> {
  for (const t of intervals) clearInterval(t)
  intervals.length = 0
  await Promise.allSettled(workers.map((w) => w.close()))
  workers.length = 0
}

if (import.meta.main) {
  await startWorkers()
  // Graceful shutdown
  process.on('SIGTERM', async () => { await stopWorkers(); await closeAllQueues(); process.exit(0) })
  process.on('SIGINT',  async () => { await stopWorkers(); await closeAllQueues(); process.exit(0) })
}
