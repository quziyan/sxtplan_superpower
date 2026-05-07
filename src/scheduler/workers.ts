// m3: refresh worker wired (Plan-C T13). news-ingest worker remains
// stubbed and will be added incrementally.
// m3: cadence tick wired (Plan-C T14) — periodic INCR enqueue for due predictions.
// m3: full-recalc worker wired (Plan-C T15) — P1-P5 evaluator → FULL job.
// m3: dispatch worker wired (Plan-C T16, ISC-24) — consumes post-approval
// trigger jobs and delegates to enqueueDispatch.
// The queue definitions live in queue.ts.

import type { Worker } from 'bullmq'
import { closeAllQueues } from './queue'
import { scheduleCadenceTick } from './workers/cadence'
import { createDispatchWorker } from './workers/dispatch'
import { createFullRecalcWorker } from './workers/full-recalc'
import { createRefreshWorker } from './workers/refresh'

const workers: Worker[] = []
const intervals: ReturnType<typeof setInterval>[] = []

export async function startWorkers(): Promise<void> {
  workers.push(createRefreshWorker())
  console.log('[scheduler] refresh worker registered')
  workers.push(createFullRecalcWorker())
  console.log('[scheduler] full-recalc worker registered')
  workers.push(createDispatchWorker())
  console.log('[scheduler] dispatch worker registered')
  intervals.push(scheduleCadenceTick())
  console.log('[scheduler] cadence tick scheduled (60s)')
  console.log('[scheduler] queues defined: refresh, full-recalc, news-ingest, dispatch')
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
