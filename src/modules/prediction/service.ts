import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  confidenceSnapshots,
  predictions,
  type ConfidenceSnapshot,
  type Prediction,
} from '@/db/schema/prediction'

export type ListPredictionsOpts = {
  status?: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'DISPATCHED' | 'EXPIRED' | 'COMPLETED'
  limit?: number
  /**
   * Plan-C T33 / ISC-41: opt-in inline of each prediction's most recent
   * confidence snapshot. When true the returned items include a
   * `latestSnapshot` field (or `null` when no snapshots exist for that row).
   * Default `false` so existing callers stay byte-for-byte compatible.
   */
  includeLatestSnapshot?: boolean
}

/**
 * Plan-C T33 / ISC-41: shape of the inlined "latest snapshot" surfaced on
 * list items when callers pass `includeLatestSnapshot: true`. Picked from
 * the columns the InboxCard actually needs — the full snapshot is on
 * GET /predictions/:id.
 */
export type LatestSnapshotSummary = {
  confidence: number
  reasoning: string | null
  occurredAt: Date
  kind: ConfidenceSnapshot['kind']
}

export type PredictionListItem = Prediction & {
  latestSnapshot?: LatestSnapshotSummary | null
}

export async function listPredictions(
  db: Db,
  opts: ListPredictionsOpts = {},
): Promise<PredictionListItem[]> {
  const limit = opts.limit ?? 100
  const rows = opts.status
    ? await db.select().from(predictions)
        .where(eq(predictions.status, opts.status))
        .orderBy(sql`${predictions.createdAt} DESC`)
        .limit(limit)
    : await db.select().from(predictions)
        .orderBy(sql`${predictions.createdAt} DESC`)
        .limit(limit)

  if (!opts.includeLatestSnapshot || rows.length === 0) {
    return rows
  }

  // Plan-C T33 / ISC-41: batch-load latest snapshot per prediction in one
  // query, then group via Map to avoid N+1 (mirrors the T27 detail-route
  // mediaAssets grouping pattern). We pull every snapshot for the IN(...)
  // set ordered by occurredAt DESC and keep only the first row per
  // predictionId — that's the latest by definition.
  const ids = rows.map((r) => r.id)
  const allSnaps = await db.select().from(confidenceSnapshots)
    .where(inArray(confidenceSnapshots.predictionId, ids))
    .orderBy(sql`${confidenceSnapshots.occurredAt} DESC`)

  const latestByPrediction = new Map<string, LatestSnapshotSummary>()
  for (const s of allSnaps) {
    if (latestByPrediction.has(s.predictionId)) continue
    latestByPrediction.set(s.predictionId, {
      confidence: s.confidence,
      reasoning: s.reasoning,
      occurredAt: s.occurredAt,
      kind: s.kind,
    })
  }

  return rows.map((r) => ({
    ...r,
    latestSnapshot: latestByPrediction.get(r.id) ?? null,
  }))
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
