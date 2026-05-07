import { and, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dispatchResults, dispatchTasks, type DispatchTask } from '@/db/schema/dispatch'
import { getAdapter } from './adapter-pool'
import { canTransition, type DispatchState } from './state-machine'

export type EnqueueDispatchInput = {
  predictionId: string
  adapterKey?: string  // default 'mock'
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
  const adapterKey = input.adapterKey ?? 'mock'
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

/** Cancel — m2 placeholder; real cancellation flow is m3 */
export async function requestCancel(db: Db, dispatchId: string, reason: string): Promise<DispatchTask> {
  const [task] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, dispatchId))
  if (!task) throw new Error(`dispatch ${dispatchId} not found`)
  if (!task.externalId) throw new Error(`dispatch ${dispatchId} has no externalId yet`)

  // Transition to CANCEL_PENDING
  await db.update(dispatchTasks).set({
    state: 'CANCEL_PENDING',
    cancellationReason: reason,
    updatedAt: new Date(),
  }).where(eq(dispatchTasks.id, dispatchId))

  // Call adapter.cancel
  const adapter = getAdapter(task.adapterKey)
  await adapter.cancel(task.externalId, `cancel-${dispatchId}`)

  // Transition to CANCELLED
  const [cancelled] = await db.update(dispatchTasks).set({
    state: 'CANCELLED',
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(dispatchTasks.id, dispatchId)).returning()
  return cancelled!
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
