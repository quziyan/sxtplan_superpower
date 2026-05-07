import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dispatchTasks, type DispatchTask } from '@/db/schema/dispatch'
import { getAdapter } from './adapter-pool'

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
