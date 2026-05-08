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

export type NewsEvidenceWithItem = {
  evidenceId: string
  weight: 'HIGH' | 'MED' | 'LOW'
  cited: boolean
  addedAt: Date
  news: {
    id: string
    title: string
    url: string
    sourceLabel: string
    sourceKind: string
    summaryZh: string | null
    rawSnippet: string | null
    publishedAt: Date | null
  }
}

export type NewsItemSummary = {
  id: string
  title: string
  url: string
  sourceLabel: string
  sourceKind: string
  summaryZh: string | null
  rawSnippet: string | null
  publishedAt: Date | null
}

export async function getNewsByIds(db: Db, ids: string[]): Promise<Record<string, NewsItemSummary>> {
  if (ids.length === 0) return {}
  const rows = await db.execute<{
    id: string; title: string; url: string; source_label: string; source_kind: string
    summary_zh: string | null; raw_snippet: string | null; published_at: Date | null
  }>(sql`
    SELECT id, title, url, source_label, source_kind::text AS source_kind,
           summary_zh, raw_snippet, published_at
    FROM news_items
    WHERE id = ANY(${ids}::uuid[])
  `)
  const out: Record<string, NewsItemSummary> = {}
  for (const r of rows as any[]) {
    out[r.id] = {
      id: r.id, title: r.title, url: r.url,
      sourceLabel: r.source_label, sourceKind: r.source_kind,
      summaryZh: r.summary_zh, rawSnippet: r.raw_snippet, publishedAt: r.published_at,
    }
  }
  return out
}

export async function getNewsEvidence(db: Db, predictionId: string): Promise<NewsEvidenceWithItem[]> {
  const rows = await db.execute<{
    evidence_id: string; weight: 'HIGH' | 'MED' | 'LOW'; cited: boolean; added_at: Date
    news_id: string; title: string; url: string; source_label: string; source_kind: string
    summary_zh: string | null; raw_snippet: string | null; published_at: Date | null
  }>(sql`
    SELECT ne.id AS evidence_id, ne.weight, ne.cited, ne.added_at,
           n.id AS news_id, n.title, n.url, n.source_label, n.source_kind::text AS source_kind,
           n.summary_zh, n.raw_snippet, n.published_at
    FROM news_evidence ne
    JOIN news_items n ON n.id = ne.news_id
    WHERE ne.prediction_id = ${predictionId}::uuid
    ORDER BY ne.added_at DESC
    LIMIT 50
  `)
  return (rows as any[]).map(r => ({
    evidenceId: r.evidence_id,
    weight: r.weight,
    cited: r.cited,
    addedAt: r.added_at,
    news: {
      id: r.news_id, title: r.title, url: r.url,
      sourceLabel: r.source_label, sourceKind: r.source_kind,
      summaryZh: r.summary_zh, rawSnippet: r.raw_snippet, publishedAt: r.published_at,
    },
  }))
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
