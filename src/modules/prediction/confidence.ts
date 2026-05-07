import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  confidenceSnapshots,
  predictions,
  type ConfidenceSnapshot,
} from '@/db/schema/prediction'

export type WriteConfidenceSnapshotInput = {
  predictionId: string
  kind: 'INCR' | 'FULL' | 'MANUAL'
  confidence: number
  ciLow?: number
  ciHigh?: number
  evidenceIds?: string[]
  reasoning?: string
  operator: string // 'PredictionAgent' or userId
}

export async function writeConfidenceSnapshot(
  db: Db,
  input: WriteConfidenceSnapshotInput,
): Promise<ConfidenceSnapshot> {
  const now = new Date()
  return db.transaction(async (tx) => {
    const [snap] = await tx.insert(confidenceSnapshots).values({
      predictionId: input.predictionId,
      kind: input.kind,
      confidence: input.confidence,
      confidenceCiLow: input.ciLow ?? null,
      confidenceCiHigh: input.ciHigh ?? null,
      evidenceIds: input.evidenceIds ?? [],
      reasoning: input.reasoning ?? null,
      operator: input.operator,
    }).returning()
    if (input.kind === 'FULL') {
      await tx.update(predictions).set({
        confidenceNow: input.confidence, lastFullAt: now, updatedAt: now,
      }).where(eq(predictions.id, input.predictionId))
    } else if (input.kind === 'INCR') {
      await tx.update(predictions).set({
        confidenceNow: input.confidence, lastIncrAt: now, updatedAt: now,
      }).where(eq(predictions.id, input.predictionId))
    } else {
      // MANUAL
      await tx.update(predictions).set({
        confidenceNow: input.confidence, updatedAt: now,
      }).where(eq(predictions.id, input.predictionId))
    }
    return snap!
  })
}
