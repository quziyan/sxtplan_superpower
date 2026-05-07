import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { webhookEnvelopes } from '@/db/schema/webhook'

export const RETRY_LIMIT = 5

export type IngestEnvelope = {
  adapterKey: string
  idempotencyKey: string
  sigStatus: 'OK' | 'INVALID' | 'MISSING'
  rawHeaders: Record<string, string>
  rawBody: string
}

/**
 * Persist a webhook envelope idempotently keyed by composite
 * (adapterKey, idempotencyKey). On conflict, returns the existing
 * row's id with isDuplicate=true. NOTE: idempotency_key alone is
 * NOT unique across adapters — we MUST filter on both columns.
 */
export async function persistEnvelope(
  db: Db,
  e: IngestEnvelope,
): Promise<{ id: string; isDuplicate: boolean }> {
  const result = await db
    .insert(webhookEnvelopes)
    .values({
      adapterKey: e.adapterKey,
      idempotencyKey: e.idempotencyKey,
      sigStatus: e.sigStatus,
      rawHeadersJson: e.rawHeaders,
      rawBody: e.rawBody,
    })
    .onConflictDoNothing()
    .returning()

  if (result.length === 0) {
    const [existing] = await db
      .select()
      .from(webhookEnvelopes)
      .where(
        and(
          eq(webhookEnvelopes.adapterKey, e.adapterKey),
          eq(webhookEnvelopes.idempotencyKey, e.idempotencyKey),
        ),
      )
    return { id: existing!.id, isDuplicate: true }
  }
  return { id: result[0]!.id, isDuplicate: false }
}

export async function markProcessed(
  db: Db,
  envelopeId: string,
  dispatchId: string,
): Promise<void> {
  await db
    .update(webhookEnvelopes)
    .set({
      status: 'PROCESSED',
      processedDispatchId: dispatchId,
      processedAt: new Date(),
    })
    .where(eq(webhookEnvelopes.id, envelopeId))
}

export async function markFailed(
  db: Db,
  envelopeId: string,
  err: string,
): Promise<void> {
  await db
    .update(webhookEnvelopes)
    .set({
      status: 'PROCESSING_FAILED',
      error: err,
    })
    .where(eq(webhookEnvelopes.id, envelopeId))
}

/**
 * Atomically increment retry_count and return the new count plus
 * a reachedLimit flag. Limit defined by RETRY_LIMIT (ISC-13).
 */
export async function incrementRetry(
  db: Db,
  envelopeId: string,
): Promise<{ retryCount: number; reachedLimit: boolean }> {
  const [row] = await db
    .update(webhookEnvelopes)
    .set({ retryCount: sql`${webhookEnvelopes.retryCount} + 1` })
    .where(eq(webhookEnvelopes.id, envelopeId))
    .returning({ retryCount: webhookEnvelopes.retryCount })

  const retryCount = row!.retryCount
  return { retryCount, reachedLimit: retryCount >= RETRY_LIMIT }
}
