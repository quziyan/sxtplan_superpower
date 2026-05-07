import { and, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dispatchResults, dispatchTasks, type DispatchTask } from '@/db/schema/dispatch'
import { getAdapter } from './adapter-pool'
import { getDefaultAdapterKey } from './constants'
import { canTransition, type DispatchState } from './state-machine'

export type EnqueueDispatchInput = {
  predictionId: string
  /**
   * Optional adapter key. When omitted, resolved via `getDefaultAdapterKey()`
   * (env-driven: CAMERA_BACKEND_KIND → SIMULATED_GZP_ENABLED → mock).
   */
  adapterKey?: string
  paramsJson?: Record<string, unknown>
}

/**
 * Enqueue a dispatch task — write QUEUED row + immediately call adapter.dispatch().
 * In m2 we skip BullMQ middleware (workers are stubbed) — direct call is OK because
 * MockCameraAdapter is in-process and always responds.
 *
 * m3: split into queue.add() → worker → adapter.dispatch();
 * here it's flat: write QUEUED → adapter.dispatch() → write SENT + externalId.
 */
export async function enqueueDispatch(db: Db, input: EnqueueDispatchInput): Promise<DispatchTask> {
  const adapterKey = input.adapterKey ?? getDefaultAdapterKey()
  const params = input.paramsJson ?? {}

  // 1. Write QUEUED row
  const [queued] = await db.insert(dispatchTasks).values({
    predictionId: input.predictionId,
    adapterKey,
    paramsJson: params,
    state: 'QUEUED',
  }).returning()
  if (!queued) throw new Error('failed to insert dispatch task')

  // 2. Call adapter.dispatch
  const adapter = getAdapter(adapterKey)
  const ack = await adapter.dispatch({ predictionId: input.predictionId, paramsJson: params })

  // 3. Update to SENT with externalId
  const [sent] = await db.update(dispatchTasks).set({
    state: 'SENT',
    externalId: ack.externalId,
    sentAt: new Date(ack.acceptedAt),
    updatedAt: new Date(),
  }).where(eq(dispatchTasks.id, queued.id)).returning()
  return sent!
}

/**
 * Plan-C T24: full cancellation flow — request side.
 *
 * 1. Validate state via the state machine (canTransition → CANCEL_PENDING).
 * 2. Atomically transition to CANCEL_PENDING with cancellationReason set, gated
 *    on the pre-read state (optimistic lock — concurrent cancel/webhook losers
 *    throw rather than clobber).
 * 3. Best-effort call to `adapter.cancel(externalId, "cancel-${dispatchId}")`.
 *    Idempotency key is deterministic so retries don't double-fire on the
 *    backend side.
 *
 * The dispatch does NOT transition to CANCELLED here — that happens later via
 * `advanceFromWebhook` when the backend posts the CANCELLED webhook (T18 path).
 *
 * Adapter errors are caught and logged but NOT rolled back: the row is already
 * CANCEL_PENDING in the DB, and the adapter retry / reconcile loop is m4
 * territory (out of scope for Plan-C). We still return the updated row so the
 * caller can audit-log the user-visible state change.
 */
export async function requestCancel(db: Db, dispatchId: string, reason: string): Promise<DispatchTask> {
  // Step 1: load the task and validate the transition. The select is outside
  // the transaction because we want a clean error message if the dispatch
  // doesn't exist or is in a non-cancellable state — the tx below only handles
  // the actual write + concurrency check.
  const [task] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, dispatchId))
  if (!task) throw new Error(`unknown dispatch ${dispatchId}`)
  const currentState = task.state as DispatchState
  if (!canTransition(currentState, 'CANCEL_PENDING')) {
    throw new Error(`cannot cancel: state is ${currentState}`)
  }

  // Step 2: transactional write with optimistic lock. If a parallel cancel /
  // webhook moved the row first, the predicate misses and we throw.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dispatchTasks)
      .set({
        state: 'CANCEL_PENDING',
        cancellationReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dispatchTasks.id, dispatchId),
          eq(dispatchTasks.state, currentState),
        ),
      )
      .returning()
    if (!row) {
      throw new Error(
        `state changed concurrently for dispatch ${dispatchId}; expected ${currentState}, retry needed`,
      )
    }
    return row
  })

  // Step 3: best-effort adapter.cancel. The DB state is already CANCEL_PENDING;
  // an adapter failure here is logged but does NOT roll back. The reconcile /
  // retry path is m4 territory.
  try {
    const adapter = getAdapter(task.adapterKey)
    // externalId may be null for tasks cancelled before SENT (QUEUED → CANCEL_PENDING).
    // In that case there's nothing for the adapter to cancel — it never accepted
    // the dispatch — so we skip the adapter call entirely.
    if (task.externalId) {
      await adapter.cancel(task.externalId, `cancel-${dispatchId}`)
    }
  } catch (err) {
    console.error(
      `[dispatch] adapter.cancel failed for dispatch ${dispatchId} (${task.adapterKey}/${task.externalId}):`,
      err instanceof Error ? err.message : err,
    )
  }

  return updated
}

export type AdvanceFromWebhookInput = {
  externalId: string
  adapterKey: string
  newState: DispatchState
  payload?: Record<string, unknown>
  /** Reserved for future media ingestion (m3) — accepted but not yet persisted. */
  mediaUrls?: string[]
}

/**
 * Advance a dispatch task in response to an inbound webhook (or polled status).
 *
 * Lookup is by (adapterKey, externalId) — the adapter-side identity, since
 * webhooks don't carry our internal UUID. Transition is validated against
 * the state machine; illegal transitions throw rather than silently no-op.
 *
 * Concurrency: the entire body runs inside a single DB transaction, and the
 * UPDATE is gated on the pre-read `state` (optimistic lock). If two webhooks
 * for the same dispatch race (e.g. SimulatedGuangzhouPoliceCamAdapter posts
 * IN_PROGRESS and COMPLETED ms apart), exactly one wins; the loser sees
 * zero rows updated and throws `state changed concurrently …` so the caller
 * (T18 webhook ingest) can retry or mark PROCESSING_FAILED — no clobbered
 * writes, no orphan dispatch_results rows.
 *
 * Side effects beyond the state column:
 *  - IN_PROGRESS sets `callbackAt` (first time the camera reported back)
 *  - COMPLETED / FAILED set `completedAt`
 *  - COMPLETED with payload also writes a `dispatch_results` row (same tx)
 */
export async function advanceFromWebhook(
  db: Db,
  params: AdvanceFromWebhookInput,
): Promise<DispatchTask> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(dispatchTasks)
      .where(
        and(
          eq(dispatchTasks.adapterKey, params.adapterKey),
          eq(dispatchTasks.externalId, params.externalId),
        ),
      )
    if (!task) {
      throw new Error(`unknown dispatch ${params.adapterKey}/${params.externalId}`)
    }
    if (!canTransition(task.state as DispatchState, params.newState)) {
      throw new Error(`invalid transition ${task.state} → ${params.newState}`)
    }

    const now = new Date()
    const updates = {
      state: params.newState,
      updatedAt: now,
      ...(params.newState === 'IN_PROGRESS' ? { callbackAt: now } : {}),
      ...(params.newState === 'COMPLETED' || params.newState === 'FAILED'
        ? { completedAt: now }
        : {}),
    } satisfies Partial<typeof dispatchTasks.$inferInsert>

    // Optimistic-lock predicate: only update if state still matches what we
    // read. If a parallel webhook moved the row first, this returns zero rows.
    const [updated] = await tx
      .update(dispatchTasks)
      .set(updates)
      .where(
        and(
          eq(dispatchTasks.id, task.id),
          eq(dispatchTasks.state, task.state),
        ),
      )
      .returning()
    if (!updated) {
      throw new Error(
        `state changed concurrently for ${params.adapterKey}/${params.externalId}; expected ${task.state}, retry needed`,
      )
    }

    if (params.newState === 'COMPLETED' && params.payload) {
      await tx.insert(dispatchResults).values({
        dispatchId: task.id,
        payloadJson: params.payload,
        capturedAt: now,
      })
    }

    return updated
  })
}
