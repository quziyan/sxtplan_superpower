import type { Db } from '@/db/client'

/**
 * Push auto-cancel event to DECIDER inbox.
 *
 * m4 implementation: degraded console.log shim — no `inbox_event` table exists yet.
 * `tickAutoCancel` already writes a structured audit log entry, so this is just a
 * front-channel notification placeholder for the inbox subsystem to land in m5+.
 *
 * TODO m5: when inbox subsystem ships, INSERT a row of type='AUTO_CANCEL'
 * with payload `{ predictionId, dispatchId, confidence }` for the DECIDER role.
 */
export async function pushAutoCancelToInbox(
  _db: Db,
  predictionId: string,
  dispatchId: string,
  confidence: number,
): Promise<void> {
  console.log(
    `[inbox] auto-cancel notification pred=${predictionId} dispatch=${dispatchId} conf=${confidence.toFixed(3)}`,
  )
}
