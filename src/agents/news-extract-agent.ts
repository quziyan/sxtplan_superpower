import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsItems, predictions, confidenceSnapshots, newsEvidence } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { watchLists } from '@/db/schema/watchlist'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import {
  NEWS_EXTRACT_SYSTEM,
  ExtractOutputSchema,
  renderExtractUserMsg,
  type ExtractOutput,
} from '@/inference/prompts/news-extract'

/**
 * news-to-prediction extractor agent (问题 #1 — 反向流):
 *
 *   输入:newsId(已 ingestHit 入库 + matched_regions 已 stamp)
 *   动作:
 *     1. 拉新闻完整体 + 拉所有 active watchlist + 解析 V/T/region 名
 *     2. 调一次 LLM(batch),让它对每个 watchlist 判 actionable + 推 windowDate
 *     3. 对每个 actionable 输出 → createPredictionFromNews 原子写
 *        prediction + news_evidence + confidence_snapshot
 *   返回:写入条数
 *
 * 与 triage 的区别:
 *   triage  = 给定 (现有 prediction, news) → 是否 MED+/HIGH(更新置信度)
 *   extract = 给定 news → 提取 N 个新预测(创建 prediction)
 *   两者互补,但当前架构反转后 extract 是主路径,triage 仍可用于
 *   增量证据更新现有 prediction(后续考虑)
 */

export type NewsExtractInput = {
  newsId: string
  inferFn?: typeof infer
}

export type NewsExtractResult = {
  newsId: string
  evaluated: number       // 评估了多少 watchlist
  created: number         // 真创建了多少 prediction
  llmDegraded: boolean    // LLM 失败时 fallback (created=0)
}

export async function runNewsExtractAgent(
  db: Db,
  input: NewsExtractInput,
): Promise<NewsExtractResult> {
  // 1. 拿新闻
  const [news] = await db.select().from(newsItems).where(eq(newsItems.id, input.newsId))
  if (!news) throw new Error(`news ${input.newsId} not found`)

  // 2. 拿所有 active watchlist + V/T/region 名
  const wls = await db.select().from(watchLists).where(eq(watchLists.isActive, true))
  if (wls.length === 0) {
    return { newsId: input.newsId, evaluated: 0, created: 0, llmDegraded: false }
  }

  // 解析 V/T 名 + region 名
  const wlEnriched = await Promise.all(wls.map(async (wl) => {
    const [v] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, wl.vehicleClassId))
    const [t] = await db.select().from(taskClasses).where(eq(taskClasses.id, wl.taskClassId))
    const regRows = await db.execute<{ name: string | null }>(sql`
      SELECT name FROM regions WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion} LIMIT 1
    `)
    const reg = (regRows as unknown as Array<{ name: string | null }>)[0] ?? { name: null }
    return { wl, vName: v?.name ?? '?', tName: t?.name ?? '?', regionName: reg.name ?? '?' }
  }))

  // 3. 调 LLM
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const userMsg = renderExtractUserMsg({
    news: {
      id: news.id, title: news.title,
      summary: news.summaryZh ?? news.rawSnippet ?? '',
      sourceLabel: news.sourceLabel,
      ...(news.publishedAt ? { publishedAt: news.publishedAt.toISOString() } : {}),
    },
    watchlists: wlEnriched.map(({ wl, vName, tName, regionName }) => ({
      id: wl.id,
      vehicleClass: vName, taskClass: tName, regionName,
      kRangeMin: wl.kRangeMin, kRangeMax: wl.kRangeMax,
    })),
    today: todayStr,
  })

  const inferFn = input.inferFn ?? infer
  let parsed: ExtractOutput
  try {
    const resp = await inferFn({
      messages: [
        { role: 'system', content: NEWS_EXTRACT_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      responseFormat: 'json_object',
    })
    const json = extractJson(resp.text)
    parsed = ExtractOutputSchema.parse(json)
  } catch (err) {
    console.warn(`[news-extract] LLM failed for news ${news.id}: ${(err as Error).message}`)
    return { newsId: input.newsId, evaluated: wls.length, created: 0, llmDegraded: true }
  }

  // 4. 对每个 extracted 输出原子写
  let created = 0
  for (const ext of parsed.extracted) {
    const wlEntry = wlEnriched.find((w) => w.wl.id === ext.watchlistId)
    if (!wlEntry) {
      console.warn(`[news-extract] LLM cited unknown watchlistId ${ext.watchlistId},skip`)
      continue
    }
    try {
      await createPredictionFromNews(db, {
        newsId: news.id,
        watchlist: wlEntry.wl,
        windowDate: ext.windowDate,
        windowHalf: ext.windowHalf,
        confidence: ext.confidence,
        reasoning: ext.reasoning,
      })
      created++
    } catch (err) {
      console.warn(`[news-extract] createPredictionFromNews failed for wl=${ext.watchlistId}: ${(err as Error).message}`)
    }
  }

  return { newsId: input.newsId, evaluated: wls.length, created, llmDegraded: false }
}

/**
 * 原子写入 — INSERT prediction + INSERT news_evidence + INSERT confidence_snapshot。
 * 三表 in 1 transaction(若任一失败,全部回滚)。
 *
 * 幂等键:(source_id=watchlistId, source_kind='WATCHLIST', window_date, window_half)。
 *  - 已存在同窗口的 prediction:跳过创建,但仍添加 news_evidence + 写新 snapshot
 *    (相当于「同一窗口的新证据进来了」— 不重建预测,而是丰富证据池)
 *  - 不存在:创建新行
 */
export type CreateInput = {
  newsId: string
  watchlist: typeof watchLists.$inferSelect
  windowDate: string  // YYYY-MM-DD
  windowHalf: 'AM' | 'PM'
  confidence: number
  reasoning: string
}

export async function createPredictionFromNews(db: Db, input: CreateInput): Promise<void> {
  const wd = new Date(input.windowDate + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const kDays = Math.max(0, Math.floor((wd.getTime() - today.getTime()) / 86_400_000))
  const expiresAt = new Date(wd.getTime() + 10 * 86_400_000)

  await db.transaction(async (tx) => {
    // 幂等查找 — 同 watchlist 同窗口已有 prediction?
    // 用 drizzle and()+eq() 让 Date 序列化由 Drizzle 处理(直接 raw sql 模板
    // 在 postgres-js 下 Date 会触发 "must be string or Buffer" 错误)
    const [existing] = await tx.select({ id: predictions.id }).from(predictions).where(
      and(
        eq(predictions.sourceKind, 'WATCHLIST'),
        eq(predictions.sourceId, input.watchlist.id),
        eq(predictions.windowDate, wd),
        eq(predictions.windowHalf, input.windowHalf),
      ),
    ).limit(1)

    let predId: string
    if (existing) {
      predId = existing.id
    } else {
      const [created] = await tx.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: input.watchlist.id,
        regionId: input.watchlist.regionId, regionVersion: input.watchlist.regionVersion,
        windowDate: wd, windowHalf: input.windowHalf,
        vehicleClassId: input.watchlist.vehicleClassId, taskClassId: input.watchlist.taskClassId,
        confidenceNow: input.confidence,
        kDays,
        cadenceMinutes: 1440,
        expiresAt,
      }).returning({ id: predictions.id })
      predId = created!.id
    }

    // news_evidence 链 — weight=HIGH 因为这是 LLM 主动从该新闻提取出来的预测
    // (相当于明确说「这条新闻就是预测的来源」)
    await tx.insert(newsEvidence).values({
      predictionId: predId, newsId: input.newsId,
      weight: 'HIGH', cited: true,
    }).onConflictDoNothing()

    // 初始 confidence snapshot
    await tx.insert(confidenceSnapshots).values({
      predictionId: predId,
      kind: 'FULL',
      confidence: input.confidence,
      reasoning: input.reasoning,
      operator: 'NewsExtract',
      evidenceIds: [input.newsId],
    })

    if (!existing) {
      // 新建 prediction 时同步 confidence_now(已在 insert 时设)
    } else {
      // 已存在:把 confidence_now 提升到新值(如果新值更高)
      await tx.update(predictions)
        .set({ confidenceNow: sql`GREATEST(${predictions.confidenceNow}, ${input.confidence})` })
        .where(eq(predictions.id, predId))
    }
  })
}
