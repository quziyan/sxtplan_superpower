import { loadEnv } from '@/env'
import type { SearchAdapter, SearchHit, SearchOpts } from '../types'

/**
 * Tavily search adapter — m5 默认搜索源.
 *
 * REST API: POST https://api.tavily.com/search
 * Body: { api_key, query, search_depth?, max_results?, include_domains? }
 * Response: { results: [{ title, url, content, score, published_date }] }
 *
 * 行为:
 * - 无 API key → 空数组 + degraded warn,不发请求
 * - 24h 缓存(keyed on JSON.stringify({q, freshness}))
 * - Fixed-window 3 calls/sec rate limit(per-instance)
 * - HTTP 非 2xx → 空数组 + warn
 * - fetch 异常 → 空数组 + error log
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

    const q = keywords.join(' ').trim()
    if (!q) return []

    const cacheKey = JSON.stringify({ q, freshness: opts.freshness })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.hits

    const now = Date.now()
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.callsInWindow = 0
    }
    if (this.callsInWindow >= 3) {
      console.warn('[tavily] rate-limited (3/sec), returning empty hits (degraded)')
      return []
    }
    this.callsInWindow++

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          search_depth: 'basic',
          max_results: 20,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        console.warn(`[tavily] HTTP ${res.status}, returning empty hits (degraded)`)
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
      console.error(`[tavily] fetch error: ${(e as Error).message}, returning empty (degraded)`)
      return []
    }
  }
}
