// m3: refresh worker wired (Plan-C T13). Other workers (full-recalc, news-ingest,
// dispatch) remain stubbed and will be added incrementally.
// The queue definitions live in queue.ts.

import type { Worker } from 'bullmq'
import { closeAllQueues } from './queue'
import { createRefreshWorker } from './workers/refresh'

const workers: Worker[] = []

export async function startWorkers(): Promise<void> {
  workers.push(createRefreshWorker())
  console.log('[scheduler] refresh worker registered')
  console.log('[scheduler] queues defined: refresh, full-recalc, news-ingest, dispatch')
}

export async function stopWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()))
  workers.length = 0
}

if (import.meta.main) {
  await startWorkers()
  // Graceful shutdown
  process.on('SIGTERM', async () => { await stopWorkers(); await closeAllQueues(); process.exit(0) })
  process.on('SIGINT',  async () => { await stopWorkers(); await closeAllQueues(); process.exit(0) })
}
