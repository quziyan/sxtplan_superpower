import type { Worker } from 'bullmq'
import { createDb, type Db } from '@/db/client'
import { runNewsExtractAgent } from '@/agents/news-extract-agent'
import type { infer as inferFnType } from '@/inference/client'
import { createBullMQWorker } from '../helpers/createBullMQWorker'

/**
 * News-extract worker (问题 #1 — 反向流):
 *
 *   Producer:tickNewsIngest 每条 ingest'd new 入一个 extract job
 *   Consumer:这里调 runNewsExtractAgent 决定从该 news 提取出几个 NEW
 *            prediction(linked to active watchlists),原子写库。
 *
 *   与 triage 的对比:
 *     triage  → (newsId, predictionId) → 更新 existing prediction 的 conf
 *     extract → newsId → 创建 NEW predictions(自带 evidence + snapshot)
 */
export type NewsExtractJobData = { newsId: string }

export type NewsExtractJobResult = {
  evaluated: number
  created: number
  merged: number
  llmDegraded: boolean
}

export async function processNewsExtractJob(
  db: Db,
  data: NewsExtractJobData,
  inferFn?: typeof inferFnType,
): Promise<NewsExtractJobResult> {
  const out = await runNewsExtractAgent(db, {
    newsId: data.newsId,
    ...(inferFn ? { inferFn } : {}),
  })
  return {
    evaluated: out.evaluated,
    created: out.created,
    merged: out.merged,
    llmDegraded: out.llmDegraded,
  }
}

export function createNewsExtractWorker(): Worker<NewsExtractJobData, NewsExtractJobResult> {
  const { db } = createDb('app')
  return createBullMQWorker<NewsExtractJobData, NewsExtractJobResult>({
    name: 'news-extract',
    handler: async (job) => processNewsExtractJob(db, job.data),
    options: { concurrency: 2 },  // 每条 LLM call ~5-10s,2 并发够用
  })
}
