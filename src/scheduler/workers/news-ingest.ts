import { eq, sql } from 'drizzle-orm'
import { createDb, type Db } from '@/db/client'
import { newsItems } from '@/db/schema/prediction'
import { watchLists } from '@/db/schema/watchlist'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { loadEnv } from '@/env'
import { findMatchingPredictions } from '@/news/matcher'
import { resolveKeywords } from '@/news/keyword-derive'
import { ingestHit } from '@/news/normalizer'
import { filterHits, rerankHits } from '@/news/relevance'
import { getSearchAdapter } from '@/news/search-adapter'
import type { SearchAdapter, SearchHit } from '@/news/types'
import type { infer as inferFnType } from '@/inference/client'
import { getNewsFreshnessDays } from '@/modules/settings/service'

/**
 * NewsIngest tick worker (Plan-E G2 + G4, m5).
 *
 * Pipeline per active watchlist:
 *   1. Resolve keywords (explicit `wl.keywords` overrides V/T/region-derived).
 *   2. Call SearchAdapter.query(keywords) → SearchHit[].
 *   3. ingestHit() handles dedup-by-URL + NOT-NULL columns (content_hash etc).
 *      Re-fetched URLs map to existing rows (isNew=false) — we skip them so
 *      we don't enqueue duplicate triage jobs for the same evidence.
 *   4. After insert, stamp `news.matched_regions = [wl.regionId]` so the
 *      matcher (which keys on matched_regions) can see this watchlist's
 *      region. This is the synchronous fast-path; m4 geocoder enrichment
 *      runs separately and may broaden matched_regions later.
 *   5. findMatchingPredictions(db, newsId) → MatchCandidate[]
 *   6. For each (prediction, news) pair, enqueue a triage job.
 *
 * Failure isolation: per-watchlist try/catch — one bad watchlist (e.g.
 * adapter throws, V/T missing) bumps `errors` and continues to the next.
 */

export type NewsTriageQueueLike = {
  add: (
    name: string,
    data: { predictionId: string; newsId: string },
  ) => Promise<unknown>
}

export type NewsIngestSearchAdapterLike = Pick<SearchAdapter, 'query'>

export type NewsIngestDeps = {
  db: Db
  triageQueue: NewsTriageQueueLike
  /** Override the SearchAdapter (e.g. tests). Defaults to env-selected adapter. */
  searchAdapter?: NewsIngestSearchAdapterLike
  /**
   * m5 UI 改进:scope to a single watchlist(用于 recompute-now 路由触发某 prediction
   * 关联 watchlist 的即时新闻拉取)。default 不传 = 扫所有 active watchlist(原 tick 行为)。
   */
  onlyWatchlistId?: string
  /**
   * Plan-M:rerank LLM 注入。default 不传 = 用真实 dashscope。测试可传 fake
   * 跳过 LLM 调用 / 强制 degraded 路径。
   */
  relevanceInferFn?: typeof inferFnType
  /**
   * Plan-M:跳过精排(只走规则过滤)。测试快路径 / 显式禁用 LLM 时用。
   */
  skipRerank?: boolean
}

export type NewsIngestTickResult = {
  watchlistsScanned: number
  newsFetched: number
  newsInserted: number
  triageJobsEnqueued: number
  errors: number
}

export async function tickNewsIngest(
  deps: NewsIngestDeps,
): Promise<NewsIngestTickResult> {
  const result: NewsIngestTickResult = {
    watchlistsScanned: 0,
    newsFetched: 0,
    newsInserted: 0,
    triageJobsEnqueued: 0,
    errors: 0,
  }

  const adapter: NewsIngestSearchAdapterLike =
    deps.searchAdapter ?? getSearchAdapter()

  // 单 tick 内只读一次 setting,避免每个 watchlist 都 round-trip。
  const freshnessDays = await getNewsFreshnessDays(deps.db)

  const activeWls = deps.onlyWatchlistId
    ? await deps.db
        .select()
        .from(watchLists)
        .where(eq(watchLists.id, deps.onlyWatchlistId))
    : await deps.db
        .select()
        .from(watchLists)
        .where(eq(watchLists.isActive, true))

  for (const wl of activeWls) {
    result.watchlistsScanned++
    try {
      // Load V / T rows for keyword-derive fallback. region.name comes from a
      // versioned regions row, so we read it via raw SQL on (id, version).
      const [vc] = await deps.db
        .select()
        .from(vehicleClasses)
        .where(eq(vehicleClasses.id, wl.vehicleClassId))
      const [tc] = await deps.db
        .select()
        .from(taskClasses)
        .where(eq(taskClasses.id, wl.taskClassId))
      if (!vc || !tc) {
        console.warn(
          `[news-ingest] watchlist ${wl.id}: V/T not found; skipping`,
        )
        result.errors++
        continue
      }
      const regRows = await deps.db.execute<{ name: string | null }>(sql`
        SELECT name FROM regions
        WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion}
        LIMIT 1
      `)
      const region =
        (regRows as unknown as Array<{ name: string | null }>)[0] ?? {
          name: null,
        }

      const keywords = resolveKeywords(wl, vc, tc, region)
      if (keywords.length === 0) continue

      const rawHits: SearchHit[] = await adapter.query(keywords, { freshnessDays })
      result.newsFetched += rawHits.length

      // 时间窗防御性过滤:Tavily server-side `days` 参数已经过滤过一遍,
      // 这里再做客户端 cutoff 兜底 — 处理 server 漏放/缓存命中老数据的情况。
      // 策略:hit.publishedAt 已知且早于 cutoff → 丢弃;null/undefined → 保留(graceful)。
      const freshnessMs = freshnessDays * 86_400_000
      const cutoff = Date.now() - freshnessMs
      const freshnessOk = rawHits.filter((h) => {
        if (!h.url || !h.title) return false
        if (h.publishedAt) {
          const ts = Date.parse(h.publishedAt)
          if (Number.isFinite(ts) && ts < cutoff) return false
        }
        return true
      })

      // Plan-M 三段式相关性过滤:粗召回 → 规则过滤 → LLM 精排
      const ruleFiltered = filterHits(freshnessOk)
      const regionLabel = region.name ?? '未知区域'
      let hits: SearchHit[]
      let rerankInfo = ''
      if (deps.skipRerank) {
        hits = ruleFiltered
        rerankInfo = ' rerank=skipped'
      } else {
        const rerankOpts = deps.relevanceInferFn ? { inferFn: deps.relevanceInferFn } : {}
        const reranked = await rerankHits(ruleFiltered, keywords.join(' '), regionLabel, rerankOpts)
        hits = reranked.hits
        rerankInfo = ` reranked=${reranked.kept}` + (reranked.degraded ? ' (LLM degraded)' : '')
      }

      console.log(
        `[news-ingest] watchlist=${wl.id.slice(0, 8)} ` +
        `raw=${rawHits.length} freshness_ok=${freshnessOk.length} ` +
        `rule_filtered=${ruleFiltered.length}${rerankInfo}`,
      )

      for (const hit of hits) {
        const { news, isNew } = await ingestHit(deps.db, hit)
        if (!isNew) continue // dup URL — already triaged on a prior tick
        result.newsInserted++

        // Stamp matched_regions with this watchlist's region so the synchronous
        // matcher can see it. m4 geocoder may later widen this list.
        await deps.db
          .update(newsItems)
          .set({ matchedRegions: [wl.regionId] })
          .where(eq(newsItems.id, news.id))

        const candidates = await findMatchingPredictions(deps.db, news.id)
        for (const cand of candidates) {
          await deps.triageQueue.add('triage', {
            predictionId: cand.predictionId,
            newsId: news.id,
          })
          result.triageJobsEnqueued++
        }
      }
    } catch (err) {
      console.error(`[news-ingest] watchlist ${wl.id} failed:`, err)
      result.errors++
    }
  }

  return result
}

export function defaultNewsIngestDeps(): NewsIngestDeps {
  // Lazy require so import-time does not pull BullMQ / Redis when tests stub
  // out the queue. `newsTriageQueue` is added to scheduler/queue.ts in Task 9.
  const queueMod = require('../queue') as {
    newsTriageQueue?: NewsTriageQueueLike
  }
  if (!queueMod.newsTriageQueue) {
    throw new Error(
      '[news-ingest] newsTriageQueue not found in scheduler/queue (Task 9 not landed yet)',
    )
  }
  const { db } = createDb('admin')
  return { db, triageQueue: queueMod.newsTriageQueue }
}

/**
 * Schedule the newsIngest tick. Default cadence reads
 * `env.NEWS_INGEST_INTERVAL_MIN` (default 15 minutes — long enough to stay
 * under per-key search-API rate budgets, short enough to keep news lag
 * bounded). Override `intervalMs` for tests / ops experiments.
 */
export function scheduleNewsIngestTick(
  deps: NewsIngestDeps = defaultNewsIngestDeps(),
  intervalMs?: number,
): ReturnType<typeof setInterval> {
  const ms = intervalMs ?? loadEnv().NEWS_INGEST_INTERVAL_MIN * 60_000
  const t = setInterval(() => {
    tickNewsIngest(deps).catch((err) => {
      console.error('[news-ingest-tick] failed:', err)
    })
  }, ms)
  ;(t as unknown as { unref?: () => void }).unref?.()
  return t
}
