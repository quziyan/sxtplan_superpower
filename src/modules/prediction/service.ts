import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  confidenceSnapshots,
  predictions,
  type Prediction,
} from '@/db/schema/prediction'

export type ListPredictionsOpts = {
  status?: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
  limit?: number
}

export async function listPredictions(db: Db, opts: ListPredictionsOpts = {}): Promise<Prediction[]> {
  const limit = opts.limit ?? 100
  if (opts.status) {
    return db.select().from(predictions)
      .where(eq(predictions.status, opts.status))
      .orderBy(sql`${predictions.createdAt} DESC`)
      .limit(limit)
  }
  return db.select().from(predictions)
    .orderBy(sql`${predictions.createdAt} DESC`)
    .limit(limit)
}

export async function getPrediction(db: Db, id: string): Promise<Prediction | null> {
  const [row] = await db.select().from(predictions).where(eq(predictions.id, id))
  return row ?? null
}

export async function getSnapshots(db: Db, predictionId: string) {
  return db.select().from(confidenceSnapshots)
    .where(eq(confidenceSnapshots.predictionId, predictionId))
    .orderBy(sql`${confidenceSnapshots.occurredAt} ASC`)
}

export type StatusTransition = {
  predictionId: string
  to: 'APPROVED' | 'REJECTED'
}

export async function transitionStatus(db: Db, t: StatusTransition): Promise<Prediction> {
  const [row] = await db.update(predictions)
    .set({ status: t.to, updatedAt: new Date() })
    .where(and(eq(predictions.id, t.predictionId), eq(predictions.status, 'PROPOSED')))
    .returning()
  if (!row) throw new Error(`prediction ${t.predictionId} not in PROPOSED state or not found`)
  return row
}
