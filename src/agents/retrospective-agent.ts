import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { InferenceError } from '@/inference/types'
import {
  RETROSPECTIVE_SYSTEM,
  RetrospectiveOutputSchema,
  renderRetrospectiveUserMsg,
  type RetrospectiveInput,
} from '@/inference/prompts/retrospective-agent'

export type RunRetrospectiveAgentInput = {
  predictionId: string
  reviewerNotes?: string
}

export type RunRetrospectiveAgentOutput = {
  retrospectiveId: string
  caseLibraryEntryId: string
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  composite: number
}

type DispatchSummary = {
  dispatchId: string
  state: string
  mediaCount: number
  metadata?: Record<string, unknown>
}

export async function runRetrospectiveAgent(
  db: Db,
  input: RunRetrospectiveAgentInput,
  inferFn: typeof infer = infer,
): Promise<RunRetrospectiveAgentOutput> {
  // 1. Load prediction
  const [p] = await db.select().from(predictions).where(eq(predictions.id, input.predictionId))
  if (!p) throw new Error(`prediction ${input.predictionId} not found`)

  // 2. Load V/T classes
  const [vc] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, p.vehicleClassId))
  const [tc] = await db.select().from(taskClasses).where(eq(taskClasses.id, p.taskClassId))
  if (!vc || !tc) throw new Error(`class lookup failed for prediction ${p.id}`)

  // 3. Load region by (id, version)
  const regResult = await db.execute<{ name: string | null }>(sql`
    SELECT name
    FROM regions
    WHERE id = ${p.regionId}::uuid AND version = ${p.regionVersion}
    LIMIT 1
  `)
  const region = regResult[0]
  if (!region) throw new Error(`region ${p.regionId} v${p.regionVersion} not found`)
  const regionName = region.name ?? '即时区域'

  // 4. Load news linked via news_evidence (PredictionMatcher already determined relevance set in m2)
  const newsRows = await db.execute<{
    id: string
    source_label: string
    source_kind: string
    title: string
    summary_zh: string | null
    raw_snippet: string | null
    published_at: Date | null
  }>(sql`
    SELECT n.id,
           n.source_label,
           LOWER(n.source_kind::text) AS source_kind,
           n.title,
           n.summary_zh,
           n.raw_snippet,
           n.published_at
    FROM news_evidence ne
    JOIN news_items n ON n.id = ne.news_id
    WHERE ne.prediction_id = ${p.id}::uuid
    ORDER BY n.published_at DESC NULLS LAST
  `)

  // 5. Load dispatch tasks + result/media counts
  const dispatchRows = await db.select().from(dispatchTasks).where(eq(dispatchTasks.predictionId, p.id))
  const dispatchSummaries: DispatchSummary[] = []
  for (const d of dispatchRows) {
    const counts = await db.execute<{ media_count: number }>(sql`
      SELECT COUNT(*)::int AS media_count
      FROM media_assets
      WHERE dispatch_id = ${d.id}::uuid
    `)
    const mediaCount = counts[0]?.media_count ?? 0
    const params = d.paramsJson as Record<string, unknown> | null
    const summary: DispatchSummary = {
      dispatchId: d.id,
      state: d.state,
      mediaCount,
    }
    if (params && typeof params === 'object') {
      summary.metadata = params
    }
    dispatchSummaries.push(summary)
  }

  // 6. Build agent input
  const agentInput: RetrospectiveInput = {
    prediction: {
      id: p.id,
      vehicleClass: vc.name,
      taskClass: tc.name,
      region: { name: regionName },
      windowDate: p.windowDate instanceof Date
        ? p.windowDate.toISOString().slice(0, 10)
        : String(p.windowDate).slice(0, 10),
      windowHalf: p.windowHalf,
      confidenceFinal: p.confidenceNow,
    },
    news: newsRows.map((r) => ({
      id: r.id,
      sourceLabel: r.source_label,
      sourceKind: r.source_kind,
      title: r.title,
      summary: r.summary_zh ?? r.raw_snippet ?? '',
      ...(r.published_at
        ? { publishedAt: r.published_at instanceof Date ? r.published_at.toISOString() : String(r.published_at) }
        : {}),
    })),
    capture: dispatchSummaries.map((d) => ({
      dispatchId: d.dispatchId,
      state: d.state,
      mediaCount: d.mediaCount,
      ...(d.metadata ? { metadata: d.metadata } : {}),
    })),
    ...(input.reviewerNotes && input.reviewerNotes.trim().length > 0
      ? { reviewerNotes: input.reviewerNotes }
      : {}),
  }

  // 7. LLM call
  const llmRes = await inferFn({
    messages: [
      { role: 'system', content: RETROSPECTIVE_SYSTEM },
      { role: 'user', content: renderRetrospectiveUserMsg(agentInput) },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
  })

  // 8. Parse + validate
  const raw = extractJson<unknown>(llmRes.text)
  const parseResult = RetrospectiveOutputSchema.safeParse(raw)
  if (!parseResult.success) {
    throw new InferenceError('PARSE', `retrospective output invalid: ${parseResult.error.message}`)
  }
  const out = parseResult.data

  // 9. Persist retrospective + case_library_entry (transactional, upsert on prediction_id)
  const dispatchIds = dispatchSummaries.map((d) => d.dispatchId)
  const predictionSnapshot = {
    id: p.id,
    vehicleClassId: p.vehicleClassId,
    taskClassId: p.taskClassId,
    regionId: p.regionId,
    regionVersion: p.regionVersion,
    windowDate: p.windowDate instanceof Date ? p.windowDate.toISOString().slice(0, 10) : String(p.windowDate),
    windowHalf: p.windowHalf,
    kDays: p.kDays,
    confidenceFinal: p.confidenceNow,
  }
  const retrievalKeys = {
    vehicleClass: vc.name,
    taskClass: tc.name,
    regionName,
    windowDate: predictionSnapshot.windowDate,
    predictionOutcome: out.prediction_outcome,
    captureOutcome: out.capture_outcome,
  }
  const bm25Blob = [out.causal_md, out.summary_md, out.key_signals.join(' ')]
    .filter((s) => s && s.length > 0)
    .join('\n\n')

  const result = await db.transaction(async (tx) => {
    const retroRows = await tx.execute<{ id: string }>(sql`
      INSERT INTO retrospectives (
        prediction_id, prediction_outcome, capture_outcome,
        score_v, score_r, score_w, score_t, composite,
        causal_md, summary_md, evidence_news_ids, capture_dispatch_ids,
        reviewer_notes, outcome_overridden, generated_at, updated_at
      )
      VALUES (
        ${p.id}::uuid,
        ${out.prediction_outcome}::prediction_outcome,
        ${out.capture_outcome}::capture_outcome,
        ${out.score_v}, ${out.score_r}, ${out.score_w}, ${out.score_t}, ${out.composite},
        ${out.causal_md}, ${out.summary_md},
        ${JSON.stringify(out.evidence_news_ids)}::jsonb,
        ${JSON.stringify(dispatchIds)}::jsonb,
        ${input.reviewerNotes ?? null},
        FALSE,
        NOW(), NOW()
      )
      ON CONFLICT (prediction_id) DO UPDATE SET
        prediction_outcome = EXCLUDED.prediction_outcome,
        capture_outcome = EXCLUDED.capture_outcome,
        score_v = EXCLUDED.score_v,
        score_r = EXCLUDED.score_r,
        score_w = EXCLUDED.score_w,
        score_t = EXCLUDED.score_t,
        composite = EXCLUDED.composite,
        causal_md = EXCLUDED.causal_md,
        summary_md = EXCLUDED.summary_md,
        evidence_news_ids = EXCLUDED.evidence_news_ids,
        capture_dispatch_ids = EXCLUDED.capture_dispatch_ids,
        reviewer_notes = EXCLUDED.reviewer_notes,
        updated_at = NOW()
      RETURNING id
    `)
    const retrospectiveId = retroRows[0]!.id

    const caseRows = await tx.execute<{ id: string }>(sql`
      INSERT INTO case_library_entries (
        retrospective_id, prediction_snapshot, retrieval_keys, bm25_blob, created_at
      )
      VALUES (
        ${retrospectiveId}::uuid,
        ${JSON.stringify(predictionSnapshot)}::jsonb,
        ${JSON.stringify(retrievalKeys)}::jsonb,
        ${bm25Blob},
        NOW()
      )
      ON CONFLICT (retrospective_id) DO UPDATE SET
        prediction_snapshot = EXCLUDED.prediction_snapshot,
        retrieval_keys = EXCLUDED.retrieval_keys,
        bm25_blob = EXCLUDED.bm25_blob
      RETURNING id
    `)
    const caseLibraryEntryId = caseRows[0]!.id

    return { retrospectiveId, caseLibraryEntryId }
  })

  return {
    retrospectiveId: result.retrospectiveId,
    caseLibraryEntryId: result.caseLibraryEntryId,
    predictionOutcome: out.prediction_outcome,
    captureOutcome: out.capture_outcome,
    composite: out.composite,
  }
}

// re-export types referenced by callers
export type { RetrospectiveInput }
