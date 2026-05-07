// m2: workers stubbed. Real handlers wired in m2 §6 (Modules) or m3 (E2E flow).
// This file exists so `bun src/scheduler/workers.ts` is a valid entry point;
// it currently registers no handlers. The queue definitions live in queue.ts.

import { closeAllQueues } from './queue'

export async function startWorkers(): Promise<void> {
  console.log('[scheduler] workers stub — no handlers registered yet (m2 placeholder)')
  console.log('[scheduler] queues defined: refresh, full-recalc, news-ingest, dispatch')
}

if (import.meta.main) {
  await startWorkers()
  // Graceful shutdown
  process.on('SIGTERM', async () => { await closeAllQueues(); process.exit(0) })
  process.on('SIGINT',  async () => { await closeAllQueues(); process.exit(0) })
}
