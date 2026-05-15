import { eq, sql } from 'drizzle-orm'
import { createDb, type Db } from '@/db/client'
import { newsItems } from '@/db/schema/prediction'
import { watchLists } from '@/db/schema/watchlist'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { loadEnv } from '@/env'
import { findMatchingPredictions } from '@/news/matcher'
import { resolveKeywords } from '@/news/keyword-derive'
import { ingestHit } from '@/news/normalizer'
import { filterHits, rerankHits, type DropEntry } from '@/news/relevance'
import { getSearchAdapter } from '@/news/search-adapter'
import type { SearchAdapter, SearchHit } from '@/news/types'
import type { infer as inferFnType } from '@/inference/client'
import {
  getNewsFreshnessDays,
  getNewsRelevanceThreshold,
  getNewsMaxToRerank,
} from '@/modules/settings/service'

/**
 * NewsIngest tick worker (Plan-E G2 + G4, m5; Plan-PP stages 添加).
 *
 * Pipeline per active watchlist:
 *   1. SEARCH       SearchAdapter.query(keywords) → rawHits
 *   2. FRESHNESS    URL/title/cutoff 兜底过滤
 *   3. RULE_FILTER  CJK / blocklist / 短标题
 *   4. RERANK       LLM 打分,阈值截断(可 skip)
 *   5. INGEST       ingestHit 去重 + 写库 + matched_regions
 *   6. EXTRACT      由 spawn-from-news 路由 wrap(非 worker 内)
 *
 * 失败隔离:per-watchlist try/catch,单 wl 失败不影响其他 wl。
 *
 * **Plan-PP**:每 wl 一次的 tick 现在还输出 `stages: StageTrace[]` —— 含
 * 每阶段 in/out/duration/丢弃样本(每阶段每 wl ≤ 5 条),供前端 PipelinePanel
 * 渲染流水线漏斗 + 解释「20 条新闻为何变 0 条预测」。
 */

const DROP_SAMPLE_CAP = 5

export type StageName =
  | 'search'
  | 'freshness'
  | 'rule_filter'
  | 'rerank'
  | 'ingest'
  | 'extract'

/** Pipeline trace 中"保留"样本 — 通过本阶段、进入下阶段的代表条目。 */
export type KeptEntry = {
  url: string
  title: string
  /** Optional 解释:例如 rerank score、ingest 后的 news.id。 */
  detail?: string
}

/** 流水线 trace 单元 — 一阶段一条,append 顺序就是流水线顺序。*/
export type StageTrace = {
  name: StageName
  /** Optional 标签,例如 watchlist 名 — 多 wl 时用来区分。*/
  watchlistName?: string
  in: number
  out: number
  durationMs: number
  params?: Record<string, unknown>
  /** 被丢弃的代表样本,每阶段每运行 ≤ DROP_SAMPLE_CAP 条。 */
  dropped: DropEntry[]
  /** 通过本阶段、留下来的代表样本,每阶段每运行 ≤ DROP_SAMPLE_CAP 条。 */
  kept: KeptEntry[]
  /** Optional 备注(例如 LLM degraded、被跳过)。*/
  note?: string
}

export type NewsTriageQueueLike = {
  add: (
    name: string,
    data: { predictionId: string; newsId: string },
  ) => Promise<unknown>
}

export type NewsExtractQueueLike = {
  add: (name: string, data: { newsId: string }) => Promise<unknown>
}

export type NewsIngestSearchAdapterLike = Pick<SearchAdapter, 'query'>

export type NewsIngestDeps = {
  db: Db
  triageQueue: NewsTriageQueueLike
  extractQueue?: NewsExtractQueueLike
  searchAdapter?: NewsIngestSearchAdapterLike
  onlyWatchlistId?: string
  relevanceInferFn?: typeof inferFnType
  skipRerank?: boolean
}

/** Plan-PP step 1:LLM 精排后的 hit + 它来自哪个 watchlist 的标注。 */
export type HitWithWl = {
  hit: SearchHit
  watchlistId: string
}

export type NewsIngestTickResult = {
  watchlistsScanned: number
  newsFetched: number
  newsInserted: number
  triageJobsEnqueued: number
  errors: number
  /** 本轮真正新进库的 news.id 列表(isNew=true)。供需要"仅新数据"的下游用。*/
  newlyInsertedNewsIds: string[]
  /** 本轮 LLM 精排通过的所有 news.id(包括 duplicate)。 */
  processedNewsIds: string[]
  /** Plan-PP step 1:LLM 精排后的 hits + 来源 wl,用于 spawn-from-news 路由
   *  并行 extract(无需经过 ingest 拿 newsId)。 */
  rerankedHits: HitWithWl[]
  stages: StageTrace[]
}

function capDropped(arr: DropEntry[]): DropEntry[] {
  return arr.slice(0, DROP_SAMPLE_CAP)
}

function sampleKept<T extends { url: string; title: string }>(
  hits: T[],
  detailFn?: (h: T, idx: number) => string | undefined,
): KeptEntry[] {
  return hits.slice(0, DROP_SAMPLE_CAP).map((h, i) => {
    const e: KeptEntry = { url: h.url, title: h.title }
    if (detailFn) {
      const d = detailFn(h, i)
      if (d !== undefined) e.detail = d
    }
    return e
  })
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
    newlyInsertedNewsIds: [],
    processedNewsIds: [],
    rerankedHits: [],
    stages: [],
  }

  const adapter: NewsIngestSearchAdapterLike =
    deps.searchAdapter ?? getSearchAdapter()

  // 单 tick 内只读一次 setting
  const freshnessDays = await getNewsFreshnessDays(deps.db)
  const relevanceThreshold = await getNewsRelevanceThreshold(deps.db)
  const maxToRerank = await getNewsMaxToRerank(deps.db)

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
      const [vc] = await deps.db
        .select()
        .from(vehicleClasses)
        .where(eq(vehicleClasses.id, wl.vehicleClassId))
      const [tc] = await deps.db
        .select()
        .from(taskClasses)
        .where(eq(taskClasses.id, wl.taskClassId))
      if (!vc || !tc) {
        console.warn(`[news-ingest] watchlist ${wl.id}: V/T not found; skipping`)
        result.errors++
        continue
      }
      const regRows = await deps.db.execute<{ name: string | null }>(sql`
        SELECT name FROM regions
        WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion}
        LIMIT 1
      `)
      const region =
        (regRows as unknown as Array<{ name: string | null }>)[0] ?? { name: null }

      const keywords = resolveKeywords(wl, vc, tc, region)
      if (keywords.length === 0) continue

      // ── Stage 1: SEARCH ─────────────────────────────────────────────
      const t0 = performance.now()
      const rawHits: SearchHit[] = await adapter.query(keywords, { freshnessDays })
      const t1 = performance.now()
      result.newsFetched += rawHits.length
      result.stages.push({
        name: 'search',
        watchlistName: wl.name,
        in: 0,
        out: rawHits.length,
        durationMs: Math.round(t1 - t0),
        params: { keywords, freshnessDays },
        dropped: [],
        kept: sampleKept(rawHits),
      })

      // ── Stage 2: FRESHNESS ──────────────────────────────────────────
      const t2 = performance.now()
      const freshnessMs = freshnessDays * 86_400_000
      const cutoff = Date.now() - freshnessMs
      const freshnessOk: SearchHit[] = []
      const freshnessDropped: DropEntry[] = []
      for (const h of rawHits) {
        if (!h.url) {
          freshnessDropped.push({ url: '', title: h.title ?? '', reason: 'no-url' })
          continue
        }
        if (!h.title) {
          freshnessDropped.push({ url: h.url, title: '', reason: 'no-title' })
          continue
        }
        // Plan-PP fix3:严格卡发布时间。无 publishedAt → drop unknown-date。
        // Tavily adapter 已经做了 HTML 兜底抓取,到这里还没日期就真的没救了。
        if (!h.publishedAt) {
          freshnessDropped.push({ url: h.url, title: h.title, reason: 'unknown-date' })
          continue
        }
        const ts = Date.parse(h.publishedAt)
        if (!Number.isFinite(ts)) {
          freshnessDropped.push({
            url: h.url, title: h.title, reason: 'unknown-date',
            detail: `unparseable: ${h.publishedAt}`,
          })
          continue
        }
        if (ts < cutoff) {
          freshnessDropped.push({
            url: h.url, title: h.title, reason: 'expired',
            detail: h.publishedAt,
          })
          continue
        }
        freshnessOk.push(h)
      }
      const t3 = performance.now()
      result.stages.push({
        name: 'freshness',
        watchlistName: wl.name,
        in: rawHits.length,
        out: freshnessOk.length,
        durationMs: Math.round(t3 - t2),
        params: { freshnessDays, cutoffMs: cutoff },
        dropped: capDropped(freshnessDropped),
        kept: sampleKept(freshnessOk, (h) => h.publishedAt),
      })

      // ── Stage 3: RULE_FILTER ────────────────────────────────────────
      const t4 = performance.now()
      const { kept: ruleFiltered, dropped: ruleDropped } = filterHits(freshnessOk)
      const t5 = performance.now()
      result.stages.push({
        name: 'rule_filter',
        watchlistName: wl.name,
        in: freshnessOk.length,
        out: ruleFiltered.length,
        durationMs: Math.round(t5 - t4),
        params: { cn_domain_gate: true, whitelist_count: 30, blocklist_count: 21, cn_tld_suffixes: 6, min_title_len: 4 },
        dropped: capDropped(ruleDropped),
        kept: sampleKept(ruleFiltered),
      })

      // ── Stage 4: RERANK ─────────────────────────────────────────────
      const regionLabel = region.name ?? '未知区域'
      let hits: SearchHit[]
      const t6 = performance.now()
      if (deps.skipRerank) {
        hits = ruleFiltered
        const t7 = performance.now()
        result.stages.push({
          name: 'rerank',
          watchlistName: wl.name,
          in: ruleFiltered.length,
          out: ruleFiltered.length,
          durationMs: Math.round(t7 - t6),
          params: { skipped: true },
          dropped: [],
          kept: sampleKept(ruleFiltered),
          note: 'rerank=skipped',
        })
      } else {
        const rerankOpts = {
          threshold: relevanceThreshold,
          maxToRerank,
          ...(deps.relevanceInferFn ? { inferFn: deps.relevanceInferFn } : {}),
        }
        const reranked = await rerankHits(ruleFiltered, keywords.join(' '), regionLabel, rerankOpts)
        hits = reranked.hits
        const t7 = performance.now()
        result.stages.push({
          name: 'rerank',
          watchlistName: wl.name,
          in: ruleFiltered.length,
          out: reranked.kept,
          durationMs: Math.round(t7 - t6),
          params: {
            threshold: reranked.thresholdUsed,
            maxToRerank: reranked.maxToRerankUsed,
            degraded: reranked.degraded,
          },
          dropped: capDropped(reranked.dropped),
          kept: sampleKept(reranked.hits),
          ...(reranked.degraded ? { note: 'LLM degraded — filter-only fallback' } : {}),
        })
      }

      console.log(
        `[news-ingest] watchlist=${wl.id.slice(0, 8)} ` +
        `raw=${rawHits.length} freshness_ok=${freshnessOk.length} ` +
        `rule_filtered=${ruleFiltered.length} reranked=${hits.length}`,
      )

      // Plan-PP step 1:rerank 通过的每条 hit 记录到 result.rerankedHits 供
      // 并行 extract 路径直接消费(不依赖 ingest 后才能拿到的 newsId)
      for (const h of hits) {
        result.rerankedHits.push({ hit: h, watchlistId: wl.id })
      }

      // ── Stage 5: INGEST ─────────────────────────────────────────────
      const t8 = performance.now()
      const ingestDropped: DropEntry[] = []
      const ingestKept: KeptEntry[] = []
      let ingestNew = 0
      for (const hit of hits) {
        const { news, isNew } = await ingestHit(deps.db, hit)
        // Plan-PP fix(#3.1):无论 isNew 与否,都把 news.id 加入 processedNewsIds —
        // 后续抽取预测对所有通过 LLM 精排的新闻跑(不被去重阻塞)。
        result.processedNewsIds.push(news.id)
        if (!isNew) {
          ingestDropped.push({ url: hit.url, title: hit.title, reason: 'duplicate' })
          continue
        }
        ingestNew++
        result.newsInserted++
        result.newlyInsertedNewsIds.push(news.id)
        if (ingestKept.length < DROP_SAMPLE_CAP) {
          ingestKept.push({ url: hit.url, title: hit.title, detail: `news.id=${news.id.slice(0, 8)}` })
        }

        await deps.db
          .update(newsItems)
          .set({ matchedRegions: [wl.regionId] })
          .where(eq(newsItems.id, news.id))

        if (deps.extractQueue) {
          await deps.extractQueue.add('extract', { newsId: news.id })
        }

        const candidates = await findMatchingPredictions(deps.db, news.id)
        for (const cand of candidates) {
          await deps.triageQueue.add('triage', {
            predictionId: cand.predictionId,
            newsId: news.id,
          })
          result.triageJobsEnqueued++
        }
      }
      const t9 = performance.now()
      result.stages.push({
        name: 'ingest',
        watchlistName: wl.name,
        in: hits.length,
        out: ingestNew,
        durationMs: Math.round(t9 - t8),
        dropped: capDropped(ingestDropped),
        kept: ingestKept,
      })
    } catch (err) {
      console.error(`[news-ingest] watchlist ${wl.id} failed:`, err)
      result.errors++
    }
  }

  return result
}

export function defaultNewsIngestDeps(): NewsIngestDeps {
  const queueMod = require('../queue') as {
    newsTriageQueue?: NewsTriageQueueLike
    newsExtractQueue?: NewsExtractQueueLike
  }
  if (!queueMod.newsTriageQueue) {
    throw new Error(
      '[news-ingest] newsTriageQueue not found in scheduler/queue (Task 9 not landed yet)',
    )
  }
  const { db } = createDb('admin')
  return {
    db,
    triageQueue: queueMod.newsTriageQueue,
    ...(queueMod.newsExtractQueue ? { extractQueue: queueMod.newsExtractQueue } : {}),
  }
}

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
