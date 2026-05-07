import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import type { Db } from '@/db/client'
import { refreshQueue } from '../queue'

/**
 * Cadence tick worker (Plan-C T14, ISC-22).
 *
 * Scans `predictions` for PROPOSED rows whose configured cadence has elapsed
 * since their last incremental refresh and enqueues an INCR job per row.
 *
 * The worker is **dependency-injectable** so unit tests can pass a mock queue
 * (no Redis) while production wires up `refreshQueue` via `defaultCadenceDeps`.
 *
 * Cadence semantics: a row is "due" when
 *   `last_incr_at IS NULL` (never run) OR
 *   `last_incr_at + cadence_minutes < NOW()`
 * AND the prediction has not yet expired.
 *
 * The SELECT is bounded to 100 rows to keep individual ticks cheap; the next
 * tick (default 60s) will pick up any backlog.
 */

/** Minimal queue surface used by the tick — keeps tests free of BullMQ. */
export type CadenceQueueLike = {
  add: (name: string, data: { predictionId: string; kind: 'INCR' }) => Promise<unknown>
}

export type CadenceDeps = {
  db: Db
  queue: CadenceQueueLike
  /**
   * Optional cap on rows scanned per tick. Defaults to 100 — enough headroom
   * for the production cadence (next tick picks up the rest) while keeping
   * each query cheap. Tests may pass a higher number when the shared test DB
   * has a large backlog of pre-existing PROPOSED rows.
   */
  limit?: number
}

/**
 * Run one cadence tick. Returns the number of rows enqueued.
 *
 * Pure with respect to its `deps` argument — does not touch globals.
 */
export async function tickCadence(deps: CadenceDeps): Promise<number> {
  const limit = deps.limit ?? 100
  const due = await deps.db.execute<{ id: string }>(sql`
    SELECT id FROM predictions
    WHERE status = 'PROPOSED'
      AND expires_at > NOW()
      AND (last_incr_at IS NULL
           OR last_incr_at + (cadence_minutes * INTERVAL '1 minute') < NOW())
    LIMIT ${limit}
  `)
  const rows = due as Array<{ id: string }>
  let n = 0
  for (const row of rows) {
    await deps.queue.add('incr', { predictionId: row.id, kind: 'INCR' })
    n++
  }
  return n
}

/**
 * Production wiring helper. Lazily opens an admin DB connection and returns
 * the real `refreshQueue`. Callers that want to share a Db should construct
 * `CadenceDeps` themselves instead.
 */
export function defaultCadenceDeps(): CadenceDeps {
  const { db } = createDb('admin')
  return { db, queue: refreshQueue }
}

/**
 * Schedule the cadence tick on a recurring interval. Returns the underlying
 * timer so callers can `clearInterval(...)` during graceful shutdown.
 *
 * The timer is `.unref()`'d (when supported) so it does NOT keep the bun
 * event loop alive on its own. Production deployments should still call
 * `clearInterval` explicitly during shutdown so an in-flight tick can settle.
 */
export function scheduleCadenceTick(
  deps: CadenceDeps = defaultCadenceDeps(),
  intervalMs = 60_000,
): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    tickCadence(deps).catch((err) => { console.error('[cadence-tick] failed:', err) })
  }, intervalMs)
  // bun's setInterval returns Timer with optional unref(); guard for environments without it.
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
