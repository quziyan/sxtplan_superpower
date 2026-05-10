import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  confidenceSnapshots,
  newsItems,
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
  /**
   * m5 UI 改进:只返回有 ≥ 1 条 news_evidence 的 prediction(分析师 proposal
   * 列表只想看"有证据"的)。Backend SQL 用 EXISTS 子查询过滤,O(N)。
   */
  hasEvidence?: boolean
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
  // m5 UI:hasEvidence=true 时用 raw SQL 加 EXISTS,因 drizzle 的 .where 链不便组合
  // status + EXISTS。保持简单,raw SQL 走得通就行。
  if (opts.hasEvidence) {
    const rawRows = await db.execute<typeof predictions.$inferSelect>(sql`
      SELECT p.* FROM predictions p
      WHERE EXISTS (SELECT 1 FROM news_evidence ne WHERE ne.prediction_id = p.id)
        ${opts.status ? sql`AND p.status = ${opts.status}` : sql``}
      ORDER BY p.created_at DESC
      LIMIT ${limit}
    `)
    const rows = rawRows as unknown as Prediction[]
    if (!opts.includeLatestSnapshot || rows.length === 0) {
      return rows
    }
    return attachLatestSnapshots(db, rows)
  }
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
  return attachLatestSnapshots(db, rows)
}

async function attachLatestSnapshots(db: Db, rows: Prediction[]): Promise<PredictionListItem[]> {
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
  // 用 drizzle inArray() —— 之前 ${ids}::uuid[] 模板会把数组序列化成单字符串 "uuid"
  // 触发 PG malformed array literal。
  const rows = await db
    .select({
      id: newsItems.id,
      title: newsItems.title,
      url: newsItems.url,
      sourceLabel: newsItems.sourceLabel,
      sourceKind: newsItems.sourceKind,
      summaryZh: newsItems.summaryZh,
      rawSnippet: newsItems.rawSnippet,
      publishedAt: newsItems.publishedAt,
    })
    .from(newsItems)
    .where(inArray(newsItems.id, ids))

  const out: Record<string, NewsItemSummary> = {}
  for (const r of rows) {
    out[r.id] = {
      id: r.id, title: r.title, url: r.url,
      sourceLabel: r.sourceLabel, sourceKind: r.sourceKind as string,
      summaryZh: r.summaryZh, rawSnippet: r.rawSnippet, publishedAt: r.publishedAt,
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
  to: 'PROPOSED' | 'VALIDATED' | 'APPROVED' | 'REJECTED'
}

// 状态机:
//   PROPOSED → VALIDATED   (ANALYST 推送给决策者)
//   PROPOSED → APPROVED    (BC: 决策者直接批准未推送提案)
//   PROPOSED → REJECTED    (BC: 决策者直接驳回未推送提案)
//   VALIDATED → APPROVED   (决策者批准已推送提案)
//   VALIDATED → REJECTED   (决策者驳回已推送提案)
//   VALIDATED → PROPOSED   (F:决策者打回重审,分析师可再次推送)
const ALLOWED_SOURCES: Record<StatusTransition['to'], ReadonlyArray<'PROPOSED' | 'VALIDATED'>> = {
  PROPOSED: ['VALIDATED'],
  VALIDATED: ['PROPOSED'],
  APPROVED: ['PROPOSED', 'VALIDATED'],
  REJECTED: ['PROPOSED', 'VALIDATED'],
}

export async function transitionStatus(db: Db, t: StatusTransition): Promise<Prediction> {
  const sources = ALLOWED_SOURCES[t.to]
  const [row] = await db.update(predictions)
    .set({ status: t.to, updatedAt: new Date() })
    .where(and(
      eq(predictions.id, t.predictionId),
      inArray(predictions.status, sources as unknown as Prediction['status'][]),
    ))
    .returning()
  if (!row) {
    throw new Error(`prediction ${t.predictionId} not in {${sources.join(',')}} or not found`)
  }
  return row
}
