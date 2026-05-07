import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsEvidence, newsItems, predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { InferenceError } from '@/inference/types'
import {
  NEWS_TRIAGE_SYSTEM,
  NewsTriageOutputSchema,
  renderNewsTriageUserMsg,
  type NewsTriageInput,
  type NewsTriageOutput,
} from '@/inference/prompts/news-triage-agent'

export type RunNewsTriageInput = {
  newsId: string
  predictionId: string
}

export async function runNewsTriageAgent(
  db: Db,
  input: RunNewsTriageInput,
): Promise<NewsTriageOutput> {
  // 1. Load news
  const [n] = await db.select().from(newsItems).where(eq(newsItems.id, input.newsId))
  if (!n) throw new Error(`news ${input.newsId} not found`)

  // 2. Load prediction + V/T
  const [p] = await db.select().from(predictions).where(eq(predictions.id, input.predictionId))
  if (!p) throw new Error(`prediction ${input.predictionId} not found`)
  const [vc] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, p.vehicleClassId))
  const [tc] = await db.select().from(taskClasses).where(eq(taskClasses.id, p.taskClassId))
  if (!vc || !tc) throw new Error('class lookup failed')

  // 3. Region (id, version)
  const reg = (await db.execute<{ name: string | null }>(sql`
    SELECT name FROM regions WHERE id = ${p.regionId}::uuid AND version = ${p.regionVersion} LIMIT 1
  `))[0]
  if (!reg) throw new Error(`region ${p.regionId} v${p.regionVersion} not found`)
  const regionName = reg.name ?? '即时区域'

  // 4. Build input
  const sourceKind = n.sourceKind.toLowerCase() as NewsTriageInput['news']['sourceKind']
  const triageInput: NewsTriageInput = {
    prediction: {
      vehicleClass: vc.name,
      taskClass: tc.name,
      region: { name: regionName, adminChain: regionName },
      windowDate: p.windowDate instanceof Date
        ? p.windowDate.toISOString().slice(0, 10)
        : String(p.windowDate).slice(0, 10),
      windowHalf: p.windowHalf,
    },
    news: {
      sourceLabel: n.sourceLabel,
      sourceKind,
      title: n.title,
      summary: n.summaryZh ?? n.rawSnippet ?? '',
      ...(n.publishedAt ? { publishedAt: n.publishedAt.toISOString() } : {}),
    },
  }

  // 5. LLM
  const llmRes = await infer({
    messages: [
      { role: 'system', content: NEWS_TRIAGE_SYSTEM },
      { role: 'user', content: renderNewsTriageUserMsg(triageInput) },
    ],
    responseFormat: 'json_object',
    temperature: 0.1,
  })

  // 6. Parse + validate
  const raw = extractJson<unknown>(llmRes.text)
  const parseResult = NewsTriageOutputSchema.safeParse(raw)
  if (!parseResult.success) {
    throw new InferenceError('PARSE', `triage output invalid: ${parseResult.error.message}`)
  }
  const out = parseResult.data

  // 7. If relevant, persist link
  if (out.relevant) {
    await db.execute(sql`
      INSERT INTO news_evidence (prediction_id, news_id, weight, cited)
      VALUES (${input.predictionId}::uuid, ${input.newsId}::uuid, ${out.weight}, TRUE)
      ON CONFLICT DO NOTHING
    `)
  }

  return out
}
