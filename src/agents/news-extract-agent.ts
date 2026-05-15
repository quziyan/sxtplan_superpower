import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsItems, predictions, confidenceSnapshots, newsEvidence } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { watchLists } from '@/db/schema/watchlist'
import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { resolveKeywords } from '@/news/keyword-derive'
import { ingestHit } from '@/news/normalizer'
import { resolveOrCreateRegion } from '@/news/location-resolver'
import type { SearchHit } from '@/news/types'
import { resolveEffectiveFollowedLevel2 } from '@/modules/taxonomy/service'
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
  /** 旧入口:已存在 news_items 的 id。仍支持(BullMQ worker 异步路径用)。 */
  newsId?: string
  /** Plan-PP step 2 新入口:直接传 hit(SearchHit),不依赖 news_items 存在。
   *  写 news_evidence 时内部 ingestHit 自动 find-or-create。优先级 > newsId。 */
  hit?: SearchHit
  /** Plan-PP:用户 ID — 从用户关注的 V 列表里选 vehicleClassId。空 = 不抽取。 */
  userId?: string
  /** 显式注入候选 V 列表(测试 / 旁路 userId 时用)。优先级 > userId 派生。 */
  followedVehicleClasses?: Array<{ id: string; name: string }>
  inferFn?: typeof infer
}

export type NewsExtractResult = {
  newsId: string
  evaluated: number       // 评估了多少 watchlist
  created: number         // 新建的 prediction 数(幂等键不命中)
  merged: number          // 合并到已有的 prediction 数(幂等键命中)
  llmDegraded: boolean    // LLM 失败时 fallback (created=merged=0)
}

export async function runNewsExtractAgent(
  db: Db,
  input: NewsExtractInput,
): Promise<NewsExtractResult> {
  // 1. 拿新闻数据 — Plan-PP step 2:优先用 hit(无需 DB lookup);否则用 newsId 走旧路径
  let newsDataForLlm: { title: string; summary: string; sourceLabel: string; publishedAt?: string }
  let resolvedHit: SearchHit | null = null
  let resolvedNewsId: string | null = null
  if (input.hit) {
    resolvedHit = input.hit
    newsDataForLlm = {
      title: input.hit.title,
      summary: input.hit.snippet ?? '',
      sourceLabel: input.hit.source.name,
      ...(input.hit.publishedAt ? { publishedAt: input.hit.publishedAt } : {}),
    }
  } else if (input.newsId) {
    const [news] = await db.select().from(newsItems).where(eq(newsItems.id, input.newsId))
    if (!news) throw new Error(`news ${input.newsId} not found`)
    resolvedNewsId = news.id
    newsDataForLlm = {
      title: news.title,
      summary: news.summaryZh ?? news.rawSnippet ?? '',
      sourceLabel: news.sourceLabel,
      ...(news.publishedAt ? { publishedAt: news.publishedAt.toISOString() } : {}),
    }
  } else {
    throw new Error('runNewsExtractAgent requires either input.hit or input.newsId')
  }
  const newsIdForLog = resolvedNewsId ?? `hit:${resolvedHit?.url.slice(0, 40) ?? '?'}`

  // 2a. Plan-PP:解析用户关注的 V 集合(level-1 自动展开为 level-2 子集)
  let follows: Array<{ id: string; name: string }> = []
  if (input.followedVehicleClasses && input.followedVehicleClasses.length > 0) {
    follows = input.followedVehicleClasses
  } else if (input.userId) {
    const followedIds = await resolveEffectiveFollowedLevel2(db, input.userId)
    if (followedIds.length > 0) {
      const rows = await db.select({ id: vehicleClasses.id, name: vehicleClasses.name })
        .from(vehicleClasses).where(inArray(vehicleClasses.id, followedIds))
      follows = rows.map((r) => ({ id: r.id, name: r.name }))
    }
  }
  if (follows.length === 0) {
    // Q4=A:空关注 → 不抽取
    return { newsId: resolvedNewsId ?? '', evaluated: 0, created: 0, merged: 0, llmDegraded: false }
  }

  // 2b. 拿所有 active watchlist 提供 T/R/keywords lens(V 由 follows 决定)
  const wls = await db.select().from(watchLists).where(eq(watchLists.isActive, true))
  if (wls.length === 0) {
    return { newsId: resolvedNewsId ?? '', evaluated: 0, created: 0, merged: 0, llmDegraded: false }
  }

  const wlEnriched = await Promise.all(wls.map(async (wl) => {
    const [v] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, wl.vehicleClassId))
    const [t] = await db.select().from(taskClasses).where(eq(taskClasses.id, wl.taskClassId))
    const regRows = await db.execute<{ name: string | null }>(sql`
      SELECT name FROM regions WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion} LIMIT 1
    `)
    const reg = (regRows as unknown as Array<{ name: string | null }>)[0] ?? { name: null }
    const keywords = v && t ? resolveKeywords(wl, v, t, { name: reg.name }) : []
    return {
      wl, vName: v?.name ?? '?', tName: t?.name ?? '?',
      regionName: reg.name ?? '?', keywords,
    }
  }))

  // 3. 调 LLM
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const userMsg = renderExtractUserMsg({
    news: { id: resolvedNewsId ?? 'pending-ingest', ...newsDataForLlm },
    follows,
    watchlists: wlEnriched.map(({ wl, tName, regionName, keywords }) => ({
      id: wl.id,
      taskClass: tName, regionName,
      kRangeMin: wl.kRangeMin, kRangeMax: wl.kRangeMax,
      ...(keywords.length > 0 ? { keywords } : {}),
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
    console.warn(`[news-extract] LLM failed for ${newsIdForLog}: ${(err as Error).message}`)
    return { newsId: resolvedNewsId ?? '', evaluated: wls.length, created: 0, merged: 0, llmDegraded: true }
  }

  // 4. 对每个 extracted 输出原子写
  // Plan-PP step 2:若是 hit 路径且尚无 newsId,在写第一条 prediction 前 find-or-create
  let writeNewsId = resolvedNewsId
  if (!writeNewsId && resolvedHit && parsed.extracted.length > 0) {
    const ing = await ingestHit(db, resolvedHit)
    writeNewsId = ing.news.id
  }

  const followsSet = new Set(follows.map((f) => f.id))
  let created = 0, merged = 0
  for (const ext of parsed.extracted) {
    const wlEntry = wlEnriched.find((w) => w.wl.id === ext.watchlistId)
    if (!wlEntry) {
      console.warn(`[news-extract] LLM cited unknown watchlistId ${ext.watchlistId},skip`)
      continue
    }
    if (!followsSet.has(ext.vehicleClassId)) {
      console.warn(`[news-extract] LLM cited unfollowed vehicleClassId ${ext.vehicleClassId},skip`)
      continue
    }
    // Plan-PP fix13:预测是面向未来的,windowDate 必须 >= today。
    // LLM 偶尔会基于新闻原文里的"过去的事件"输出过期日期,这里硬卡。
    if (ext.windowDate < todayStr) {
      console.warn(`[news-extract] LLM 输出过期 windowDate=${ext.windowDate} < today=${todayStr},skip (wl=${ext.watchlistId})`)
      continue
    }
    if (!writeNewsId) {
      console.warn(`[news-extract] no resolved newsId for ${newsIdForLog},skip write`)
      continue
    }
    // Plan-PP fix9:解析 LLM 抽到的地名 → 真实 region(失败 fallback 到 wl 的 region)
    let resolvedRegionId: string | undefined
    let resolvedRegionVersion: number | undefined
    if (ext.locationFine || ext.locationDistrict) {
      try {
        const resolved = await resolveOrCreateRegion(db, {
          ...(ext.locationFine ? { locationFine: ext.locationFine } : {}),
          ...(ext.locationDistrict ? { locationDistrict: ext.locationDistrict } : {}),
        })
        if (resolved) {
          resolvedRegionId = resolved.id
          resolvedRegionVersion = resolved.version
          console.log(`[news-extract] location resolved: "${ext.locationFine ?? ext.locationDistrict}" → region ${resolved.id.slice(0,8)} (${resolved.source})`)
        }
      } catch (err) {
        console.warn(`[news-extract] location-resolver failed for "${ext.locationFine ?? ext.locationDistrict}": ${(err as Error).message}`)
      }
    }
    try {
      const r = await createPredictionFromNews(db, {
        newsId: writeNewsId,
        watchlist: wlEntry.wl,
        vehicleClassId: ext.vehicleClassId,
        ...(resolvedRegionId && resolvedRegionVersion !== undefined
          ? { regionId: resolvedRegionId, regionVersion: resolvedRegionVersion }
          : {}),
        windowDate: ext.windowDate,
        windowHalf: ext.windowHalf,
        confidence: ext.confidence,
        reasoning: ext.reasoning,
      })
      if (r.action === 'created') created++; else merged++
    } catch (err) {
      console.warn(`[news-extract] createPredictionFromNews failed for wl=${ext.watchlistId} v=${ext.vehicleClassId}: ${(err as Error).message}`)
    }
  }

  return { newsId: writeNewsId ?? '', evaluated: wls.length, created, merged, llmDegraded: false }
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
  /** Plan-PP:覆盖 wl.vehicleClassId,使用 LLM 从用户 follows 里选的 V */
  vehicleClassId?: string
  /** Plan-PP fix9:覆盖 wl.regionId/regionVersion,使用 location-resolver 解析出的真实区域 */
  regionId?: string
  regionVersion?: number
  windowDate: string  // YYYY-MM-DD
  windowHalf: 'AM' | 'PM'
  confidence: number
  reasoning: string
}

export type CreateResult = {
  predictionId: string
  action: 'created' | 'merged'
}

export async function createPredictionFromNews(db: Db, input: CreateInput): Promise<CreateResult> {
  const wd = new Date(input.windowDate + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const kDays = Math.max(0, Math.floor((wd.getTime() - today.getTime()) / 86_400_000))
  const expiresAt = new Date(wd.getTime() + 10 * 86_400_000)

  // Plan-PP:V 用 LLM 选的(若提供),否则 fallback 到 wl.vehicleClassId
  const vehicleClassId = input.vehicleClassId ?? input.watchlist.vehicleClassId
  // Plan-PP fix9:region 用 location-resolver 解析的(若提供),否则 fallback 到 wl 的
  const regionId = input.regionId ?? input.watchlist.regionId
  const regionVersion = input.regionVersion ?? input.watchlist.regionVersion

  let result: CreateResult = { predictionId: '', action: 'created' }
  await db.transaction(async (tx) => {
    // Plan-PP step 4:dedup 仅合并到 active(未结案)预测;终态(COMPLETED/EXPIRED/
    // REJECTED)的同 key prediction 不被合并 → 新建一条,避免给死预测灌新证据
    const [existing] = await tx.select({ id: predictions.id }).from(predictions).where(
      and(
        eq(predictions.vehicleClassId, vehicleClassId),
        eq(predictions.taskClassId, input.watchlist.taskClassId),
        eq(predictions.regionId, regionId),
        eq(predictions.regionVersion, regionVersion),
        eq(predictions.windowDate, wd),
        eq(predictions.windowHalf, input.windowHalf),
        inArray(predictions.status, ['PROPOSED', 'VALIDATED', 'APPROVED', 'DISPATCHED']),
      ),
    ).limit(1)

    let predId: string
    if (existing) {
      predId = existing.id
      result = { predictionId: predId, action: 'merged' }
    } else {
      const [created] = await tx.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: input.watchlist.id,
        regionId, regionVersion,
        windowDate: wd, windowHalf: input.windowHalf,
        vehicleClassId,                                              // Plan-PP:LLM-chosen V
        taskClassId: input.watchlist.taskClassId,
        confidenceNow: input.confidence,
        kDays,
        cadenceMinutes: 1440,
        expiresAt,
      }).returning({ id: predictions.id })
      predId = created!.id
      result = { predictionId: predId, action: 'created' }
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
  return result
}
