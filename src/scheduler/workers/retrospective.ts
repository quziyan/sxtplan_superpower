import type { Worker } from 'bullmq'
import { sql } from 'drizzle-orm'
import { runRetrospectiveAgent as defaultRunRetrospectiveAgent } from '@/agents/retrospective-agent'
import { createDb } from '@/db/client'
import type { Db } from '@/db/client'
import { createBullMQWorker } from '../helpers/createBullMQWorker'
import { retrospectiveQueue } from '../queue'

/**
 * Retrospective scheduler tick + worker (Plan-C T22, ISC-30).
 *
 * The tick scans for predictions that are settled (status COMPLETED or
 * EXPIRED) whose review-window has elapsed (`window_date + M_default days
 * < NOW()`) and that do not yet have a retrospective row. For each
 * matching prediction it enqueues a `retro` job onto `retrospectiveQueue`.
 *
 * The worker consumes those jobs and delegates to T21's
 * `runRetrospectiveAgent`, which produces the 4-piece retrospective +
 * case-library entry. Both the tick and the worker are
 * dependency-injectable so tests can avoid Redis and LLM calls.
 *
 * Default retention: 7 days (`M_default` from ISC-30). The tick is
 * scheduled at 5 minutes — a courser cadence than cadence/full-recalc
 * because the retro window is days, not minutes.
 */

/** Minimal queue surface used by the tick — keeps tests free of BullMQ. */
export type RetrospectiveQueueLike = {
  add: (
    name: string,
    data: { predictionId: string },
  ) => Promise<unknown>
}

export type RetrospectiveTickDeps = {
  db: Db
  queue: RetrospectiveQueueLike
  /**
   * Optional cap on rows scanned per tick. Defaults to 50 — enough
   * headroom for the production cadence (next tick picks up the rest)
   * while keeping each query cheap. Tests may pass a higher number when
   * the shared test DB has a large backlog of pre-existing rows.
   */
  limit?: number
  /**
   * Retention days that must have elapsed since `window_date` before a
   * prediction is eligible for retrospective. Defaults to 7 (M_default).
   */
  retentionDays?: number
}

/**
 * Run one retrospective tick. Returns the number of jobs enqueued.
 *
 * Pure with respect to its `deps` argument — does not touch globals.
 */
export async function tickRetrospective(deps: RetrospectiveTickDeps): Promise<number> {
  const limit = deps.limit ?? 50
  const days = deps.retentionDays ?? 7
  const due = await deps.db.execute<{ id: string }>(sql`
    SELECT p.id FROM predictions p
    LEFT JOIN retrospectives r ON r.prediction_id = p.id
    WHERE p.status IN ('COMPLETED', 'EXPIRED')
      AND r.id IS NULL
      AND p.window_date + (${days} || ' days')::interval < NOW()
    LIMIT ${limit}
  `)
  const rows = due as Array<{ id: string }>
  let n = 0
  for (const row of rows) {
    await deps.queue.add('retro', { predictionId: row.id })
    n++
  }
  return n
}

/**
 * Production wiring helper. Lazily opens an admin DB connection and
 * returns the real `retrospectiveQueue`. Callers that want to share a Db
 * should construct `RetrospectiveTickDeps` themselves instead.
 */
export function defaultRetrospectiveTickDeps(): RetrospectiveTickDeps {
  const { db } = createDb('admin')
  return { db, queue: retrospectiveQueue }
}

/**
 * Schedule the retrospective tick on a recurring interval. Returns the
 * underlying timer so callers can `clearInterval(...)` during graceful
 * shutdown.
 *
 * The timer is `.unref()`'d (when supported) so it does NOT keep the bun
 * event loop alive on its own.
 */
export function scheduleRetrospectiveTick(
  deps: RetrospectiveTickDeps = defaultRetrospectiveTickDeps(),
  intervalMs = 5 * 60_000,
): ReturnType<typeof setInterval> {
  const t = setInterval(() => {
    tickRetrospective(deps).catch((err) => {
      console.error('[retrospective-tick] failed:', err)
    })
  }, intervalMs)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}

/**
 * Retrospective worker job payload. Produced by the periodic tick (which
 * never sets `reviewerNotes`) and by manual on-demand enqueues.
 */
export type RetrospectiveJobData = {
  predictionId: string
  reviewerNotes?: string
}

/**
 * Pure handler return shape. Mirrors a subset of the agent's output —
 * the retro id and the two outcome enums — so the worker can log a
 * compact summary without leaking the entire agent payload.
 */
export type RetrospectiveJobResult = {
  retrospectiveId: string
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
}

/**
 * Dependency-injection seam for the retrospective handler. Lets unit
 * tests supply a fake `runRetrospectiveAgent` instead of hitting the
 * real DB + LLM pipeline.
 */
export type RetrospectiveDeps = {
  runRetrospectiveAgent: typeof defaultRunRetrospectiveAgent
}

const defaultDeps: RetrospectiveDeps = {
  runRetrospectiveAgent: defaultRunRetrospectiveAgent,
}

/**
 * Pure handler — decoupled from BullMQ so we can unit-test it without
 * Redis. Calls `deps.runRetrospectiveAgent(db, {...})` and returns a
 * normalised summary shape.
 *
 * `reviewerNotes` is forwarded only when present and non-empty so the
 * agent's optional-property contract is preserved (matches T21's
 * `RunRetrospectiveAgentInput` shape).
 */
export async function processRetrospectiveJob(
  db: Db,
  data: RetrospectiveJobData,
  deps: RetrospectiveDeps = defaultDeps,
): Promise<RetrospectiveJobResult> {
  const out = await deps.runRetrospectiveAgent(db, {
    predictionId: data.predictionId,
    ...(data.reviewerNotes && data.reviewerNotes.trim().length > 0
      ? { reviewerNotes: data.reviewerNotes }
      : {}),
  })
  return {
    retrospectiveId: out.retrospectiveId,
    predictionOutcome: out.predictionOutcome,
    captureOutcome: out.captureOutcome,
  }
}

/**
 * BullMQ Worker factory. Connects to Redis and consumes the
 * `retrospective` queue, delegating each job to `processRetrospectiveJob`.
 * Caller is responsible for `worker.close()` on shutdown.
 */
export function createRetrospectiveWorker(): Worker<RetrospectiveJobData, RetrospectiveJobResult> {
  const { db } = createDb('app')
  return createBullMQWorker<RetrospectiveJobData, RetrospectiveJobResult>({
    name: 'retrospective',
    handler: async (job) => processRetrospectiveJob(db, job.data),
  })
}
