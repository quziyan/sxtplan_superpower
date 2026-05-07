import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import {
  confidenceSnapshots,
  newsEvidence,
  newsItems,
  predictions,
  type Prediction,
} from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { InferenceError } from '@/inference/types'
import {
  PREDICTION_AGENT_SYSTEM,
  PredictionAgentOutputSchema,
  renderPredictionUserMsg,
  type PredictionAgentInput,
  type PredictionAgentOutput,
} from '@/inference/prompts/prediction-agent'

export type RunPredictionAgentInput = {
  predictionId: string
  kind: 'INCR' | 'FULL'
  newEvidenceNewsIds?: string[] // INCR 时传入新 News.id 列表(本函数会建 NewsEvidence)
}

type EvidenceRow = {
  news_id: string
  source_label: string
  source_kind: 'mainstream' | 'gov' | 'social' | 'foreign'
  title: string
  summary_zh: string | null
  raw_snippet: string | null
  published_at: Date | null
}

export async function runPredictionAgent(
  db: Db,
  input: RunPredictionAgentInput,
): Promise<PredictionAgentOutput> {
  // 1. Load prediction
  const [p] = await db.select().from(predictions).where(eq(predictions.id, input.predictionId))
  if (!p) throw new Error(`prediction ${input.predictionId} not found`)

  // 2. Load V/T classes
  const [vc] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, p.vehicleClassId))
  const [tc] = await db.select().from(taskClasses).where(eq(taskClasses.id, p.taskClassId))
  if (!vc || !tc) throw new Error(`class lookup failed for prediction ${p.id}`)

  // 3. Load region by (id, version)
  const regResult = await db.execute<{ name: string | null; admin_chain: string }>(sql`
    SELECT name,
           COALESCE(name, '即时框选') AS admin_chain
    FROM regions
    WHERE id = ${p.regionId}::uuid AND version = ${p.regionVersion}
    LIMIT 1
  `)
  const region = regResult[0]
  if (!region) throw new Error(`region ${p.regionId} v${p.regionVersion} not found`)
  const regionName = region.name ?? '即时区域'
  const adminChain = region.admin_chain // m2 简化:暂以 name 为 chain;m4 真正递归 parent

  // 4. Resolve evidence pool
  let evidenceRows: EvidenceRow[]

  if (input.kind === 'FULL') {
    const r = await db.execute<EvidenceRow>(sql`
      SELECT n.id AS news_id,
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
    evidenceRows = r as EvidenceRow[]
  } else {
    // INCR: 只看 newEvidenceNewsIds
    if (!input.newEvidenceNewsIds || input.newEvidenceNewsIds.length === 0) {
      throw new Error('INCR mode requires newEvidenceNewsIds')
    }
    const idList = input.newEvidenceNewsIds
    const r = await db.execute<EvidenceRow>(sql`
      SELECT n.id AS news_id,
             n.source_label,
             LOWER(n.source_kind::text) AS source_kind,
             n.title,
             n.summary_zh,
             n.raw_snippet,
             n.published_at
      FROM news_items n
      WHERE n.id = ANY(ARRAY[${sql.join(idList.map(id => sql`${id}::uuid`), sql`, `)}])
      ORDER BY n.published_at DESC NULLS LAST
    `)
    evidenceRows = r as EvidenceRow[]

    // 建立 NewsEvidence 链接(idempotent via ON CONFLICT DO NOTHING)
    for (const row of evidenceRows) {
      await db.execute(sql`
        INSERT INTO news_evidence (prediction_id, news_id, weight)
        VALUES (${p.id}::uuid, ${row.news_id}::uuid, 'MED')
        ON CONFLICT DO NOTHING
      `)
    }
  }

  // 5. Build agent input
  const agentInput: PredictionAgentInput = {
    vehicleClass: vc.name,
    taskClass: tc.name,
    region: { name: regionName, adminChain },
    windowDate: p.windowDate instanceof Date
      ? p.windowDate.toISOString().slice(0, 10)
      : String(p.windowDate).slice(0, 10),
    windowHalf: p.windowHalf,
    evidence: evidenceRows.map(r => ({
      id: r.news_id,
      sourceLabel: r.source_label,
      sourceKind: r.source_kind,
      title: r.title,
      summary: r.summary_zh ?? r.raw_snippet ?? '',
      publishedAt: r.published_at instanceof Date
        ? r.published_at.toISOString()
        : r.published_at ?? undefined,
    })),
  }

  // 6. Call LLM
  const llmRes = await infer({
    messages: [
      { role: 'system', content: PREDICTION_AGENT_SYSTEM },
      { role: 'user', content: renderPredictionUserMsg(agentInput) },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
  })

  // 7. Parse + validate
  const raw = extractJson<unknown>(llmRes.text)
  const parseResult = PredictionAgentOutputSchema.safeParse(raw)
  if (!parseResult.success) {
    throw new InferenceError('PARSE', `agent output invalid: ${parseResult.error.message}`)
  }
  const out = parseResult.data

  // 8. Write snapshot + update prediction (transactional)
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(confidenceSnapshots).values({
      predictionId: p.id,
      kind: input.kind,
      confidence: out.confidence,
      confidenceCiLow: out.ci_low,
      confidenceCiHigh: out.ci_high,
      evidenceIds: out.evidence_ids,
      reasoning: out.reasoning,
      operator: 'PredictionAgent',
    })
    if (input.kind === 'FULL') {
      await tx.update(predictions).set({
        confidenceNow: out.confidence,
        lastFullAt: now,
        updatedAt: now,
      }).where(eq(predictions.id, p.id))
    } else {
      await tx.update(predictions).set({
        confidenceNow: out.confidence,
        lastIncrAt: now,
        updatedAt: now,
      }).where(eq(predictions.id, p.id))
    }
  })

  return out
}

export type { Prediction }
