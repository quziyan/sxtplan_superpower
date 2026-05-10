import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { loadEnv } from '@/env'
import {
  NEWS_RELEVANCE_SYSTEM,
  RerankOutputSchema,
  renderRerankUserMsg,
  type RerankOutput,
} from '@/inference/prompts/news-relevance'
import type { SearchHit } from './types'

/**
 * 三段式新闻相关性流水线 — Plan-M。
 *
 *   粗召回(Tavily/gov adapter ~20 hit)
 *     → 过滤(filterHits,规则 0-LLM)
 *     → 精排(rerankHits,1 次 LLM batch 评分)
 *     → top-K(阈值截断)
 *     → news-ingest 写库 + 后续 triage
 *
 * 设计:
 *  - filterHits 是 hot path,纯规则,O(N) 扫一遍。CJK 字符 + 域名黑名单 +
 *    Title/snippet 长度校验。
 *  - rerankHits 一次 LLM batch 调用对 ≤ 20 条评分,失败降级返原列表(不崩)。
 *  - 阈值通过 env RELEVANCE_THRESHOLD(默认 50)控制 keep。
 */

// 黑名单:Tavily 实测对中文 query 偶尔返英文/美国主流媒体,直接屏蔽。
// 若想白名单中文权威源,可后续单独维护一个允许列表。
const ENGLISH_DOMAIN_BLOCKLIST = new Set([
  'cbsnews.com', 'latimes.com', 'newsweek.com', 'nytimes.com',
  'washingtonpost.com', 'bbc.com', 'cnn.com', 'foxnews.com',
  'reuters.com', 'apnews.com', 'usatoday.com', 'wsj.com',
  'bloomberg.com', 'theguardian.com',
])

function hasCjk(s: string): boolean {
  // CJK 统一表意 + 扩展 A;够覆盖现代中文
  return /[一-鿿㐀-䶿]/.test(s)
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') }
  catch { return '' }
}

/**
 * 规则过滤 — pure / 同步。Drop:
 *  - title 和 snippet 都没有 CJK 字符(非中文新闻)
 *  - hostname 在英文媒体黑名单
 *  - title 太短(< 4 chars)— 抓取异常
 */
export function filterHits(hits: SearchHit[]): SearchHit[] {
  return hits.filter((h) => {
    if (!h.title || h.title.length < 4) return false
    if (!hasCjk(h.title) && !hasCjk(h.snippet ?? '')) return false
    const host = hostnameOf(h.url)
    if (ENGLISH_DOMAIN_BLOCKLIST.has(host)) return false
    return true
  })
}

export type RerankOpts = {
  threshold?: number
  /** 上限:超过此数的 hit 不送 LLM(成本控制),按原序前 N */
  maxToRerank?: number
  /** 测试 / 失败注入 */
  inferFn?: typeof infer
}

/**
 * LLM 精排 — 1 次 batch 调用,失败降级返 input(filter-only output)。
 * 返回按 LLM 评分降序、过阈值后的 SearchHit[]。
 */
export async function rerankHits(
  hits: SearchHit[],
  query: string,
  region: string,
  opts: RerankOpts = {},
): Promise<{ hits: SearchHit[]; raw: number; kept: number; degraded: boolean }> {
  if (hits.length === 0) {
    return { hits: [], raw: 0, kept: 0, degraded: false }
  }
  const env = loadEnv()
  const threshold = opts.threshold ?? env.RELEVANCE_THRESHOLD
  const maxToRerank = opts.maxToRerank ?? 20
  const candidates = hits.slice(0, maxToRerank)
  const inferFn = opts.inferFn ?? infer

  let parsed: RerankOutput
  try {
    const userMsg = renderRerankUserMsg({
      query, region,
      hits: candidates.map((h, i) => ({
        idx: i,
        title: h.title,
        snippet: h.snippet ?? '',
        sourceLabel: h.source.name,
      })),
    })
    const resp = await inferFn({
      messages: [
        { role: 'system', content: NEWS_RELEVANCE_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      responseFormat: 'json_object',
    })
    const json = extractJson(resp.text)
    parsed = RerankOutputSchema.parse(json)
  } catch (err) {
    console.warn(`[rerank] LLM failed, fallback filter-only: ${(err as Error).message}`)
    return { hits: candidates, raw: candidates.length, kept: candidates.length, degraded: true }
  }

  // 按 idx 关联回原 hit + 降序排序 + 阈值截断
  const scoreByIdx = new Map<number, number>()
  for (const s of parsed.scores) scoreByIdx.set(s.idx, s.relevance)

  const scored = candidates
    .map((h, i) => ({ hit: h, score: scoreByIdx.get(i) ?? 0 }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
  return {
    hits: scored.map((s) => s.hit),
    raw: candidates.length,
    kept: scored.length,
    degraded: false,
  }
}
