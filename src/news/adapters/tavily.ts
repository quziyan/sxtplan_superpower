import { loadEnv } from '@/env'
import type { SearchAdapter, SearchHit, SearchOpts } from '../types'
import { enrichPublishedDates } from '../published-date-fetch'

/**
 * Tavily include_domains 白名单 — Plan-PP fix6 瘦身版。
 *
 * 仅保留 .cn / .com.cn / .gov.cn 系纯中文域。Tavily 按 host suffix 匹配,
 * 像 `36kr.com` 会被扩到 `eu.36kr.com`(36 氪英文版),引入大量噪声。
 * `.com.cn` / `.cn` 这种顶级中文 TLD 没有对应英文子域,安全。
 *
 * client-side `filterHits` 还有英文子域前缀黑名单兜底(en./eu./english./global./intl.)
 */
// Plan-PP fix6:Tavily include_domains 保留较宽 .com/.cn 集合 — Tavily 召回宽,
// client-side filterHits 用「英文子域前缀黑名单」兜底(`eu.36kr.com` 等子域会被丢)。
const TAVILY_CN_INCLUDE_DOMAINS = [
  // 央媒
  'xinhuanet.com', 'news.cn', 'people.com.cn', 'cctv.com',
  'chinanews.com.cn', 'china.com.cn',
  // 主流商业
  'sina.com.cn', 'qq.com', '163.com', 'sohu.com', 'ifeng.com',
  // 财经/科技
  'thepaper.cn', 'caixin.com', 'yicai.com',
  // 广东本地
  'nfnews.com', 'southcn.com', 'dayoo.com', 'gzdaily.cn', 'oeeee.com',
  // 政府门户
  'gov.cn', 'gd.gov.cn', 'gz.gov.cn',
]

const MAX_RESULTS_PER_KEYWORD = 10

/**
 * Tavily search adapter — m5 默认搜索源.
 *
 * Plan-PP fix3:**对每个 keyword 独立调 Tavily,合并去重(by URL)**。
 *   旧版 `keywords.join(' ')` 把所有词拼一个 query,丢失独立召回。
 *   新版每 keyword 串行调一次,合并集 → URL 去重 → 返回。
 *
 * REST API: POST https://api.tavily.com/search
 * 行为:
 *  - 无 API key / 空 keywords → 空数组 + degraded warn
 *  - 24h 缓存(per-keyword)
 *  - Fixed-window 3 calls/sec rate limit;若超额则该 keyword 跳过(warn)
 *  - HTTP 非 2xx / fetch 异常 → 该 keyword 返空,继续下一个
 */
export class TavilySearchAdapter implements SearchAdapter {
  readonly key = 'tavily'
  readonly kind = 'tavily' as const

  private cache = new Map<string, { hits: SearchHit[]; expiresAt: number }>()
  private callsInWindow = 0
  private windowStart = Date.now()

  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const env = loadEnv()
    const apiKey = env.TAVILY_API_KEY

    if (!apiKey) {
      console.warn('[tavily] no API key, returning empty hits (degraded)')
      return []
    }

    const cleanKeywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0)
    if (cleanKeywords.length === 0) return []

    const days = opts.freshnessDays ?? env.NEWS_FRESHNESS_DAYS

    const merged = new Map<string, SearchHit>()
    for (const kw of cleanKeywords) {
      const hits = await this.queryOne(kw, apiKey, days)
      for (const h of hits) {
        if (!h.url) continue
        if (!merged.has(h.url)) merged.set(h.url, h)
      }
    }
    const unique = Array.from(merged.values())
    // 兜底:Tavily 对许多 .gov.cn 不返 published_date,这里抓 HTML 提取。
    // 并发 4,单 URL 8s 超时。已有 publishedAt 的跳过。
    const enriched = await enrichPublishedDates(unique, 4)
    const withDate = enriched.filter((h) => h.publishedAt).length
    console.log(`[tavily] queried ${cleanKeywords.length} keywords → ${enriched.length} unique hits, ${withDate} with publishedAt (${enriched.length - withDate} unknown-date will be dropped)`)
    return enriched
  }

  private async queryOne(q: string, apiKey: string, days: number): Promise<SearchHit[]> {
    // Plan-PP fix5:exact-phrase boost — Tavily 是语义检索,加引号可提示引擎
    // 优先字面命中。已有引号则保留,避免双重引号(`""x""`)。
    const quoted = q.startsWith('"') && q.endsWith('"') ? q : `"${q}"`
    const cacheKey = JSON.stringify({ q: quoted, days })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.hits

    const now = Date.now()
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.callsInWindow = 0
    }
    if (this.callsInWindow >= 3) {
      console.warn(`[tavily] rate-limited (3/sec), skipping keyword "${q}"`)
      return []
    }
    this.callsInWindow++

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: quoted,
          search_depth: 'basic',
          max_results: MAX_RESULTS_PER_KEYWORD,
          topic: 'news',
          days,
          country: 'china',
          include_domains: TAVILY_CN_INCLUDE_DOMAINS,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        console.warn(`[tavily] HTTP ${res.status} for "${q}", returning empty (degraded)`)
        return []
      }
      const json = (await res.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }> }
      const results = json.results ?? []
      const hits: SearchHit[] = results.map((r) => {
        const domain = (() => {
          try { return new URL(r.url).hostname } catch { return 'tavily' }
        })()
        const hit: SearchHit = {
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.content ?? '',
          source: { name: domain, kind: 'mainstream' as const },
        }
        if (r.published_date) hit.publishedAt = r.published_date
        return hit
      })
      this.cache.set(cacheKey, { hits, expiresAt: Date.now() + 24 * 3600_000 })
      return hits
    } catch (e) {
      console.error(`[tavily] fetch error for "${q}": ${(e as Error).message}, returning empty (degraded)`)
      return []
    }
  }
}

