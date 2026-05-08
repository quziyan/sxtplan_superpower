import { loadEnv } from '@/env'
import { makePool, type Pool } from '@/integrations/external-adapter'
import type { SearchAdapter, SearchHit, SearchOpts } from './types'
import { NotImplementedError } from './types'
import { GovGdProvinceAdapter } from './adapters/gov-gd-province'
import { GovGzCityAdapter } from './adapters/gov-gz-city'
import { GovPublicSecurityAdapter } from './adapters/gov-public-security'
import { TavilySearchAdapter } from './adapters/tavily'

class MockSearchAdapter implements SearchAdapter {
  readonly kind = 'mock' as const
  readonly key = 'mock'
  async query(keywords: string[]): Promise<SearchHit[]> {
    return [{
      url: `https://mock.example/${encodeURIComponent(keywords.join('-'))}-${Date.now()}`,
      title: `[Mock] ${keywords.join(' / ')}`,
      snippet: `mock 摘要 for: ${keywords.join(', ')}`,
      publishedAt: new Date().toISOString(),
      source: { name: 'MOCK', kind: 'mainstream' },
    }]
  }
}

/**
 * BingNewsSearchAdapter — real Bing News Search v7 API client (Plan-D Task 7, A2-α).
 *
 * Replaces the m2 stub. Behavior:
 *   - No API key  → log warn + return [] (degraded fallback, never throws).
 *   - Cache hit   → return cached hits (24h TTL, keyed on {q, freshness}).
 *   - Rate limit  → ≤3 calls per 1s fixed window, per-instance; 4th call in window
 *                   returns [] (degraded).
 *   - HTTP !ok    → log warn + return [] (degraded).
 *   - fetch throw → log error + return [] (degraded).
 *   - Real success → map Bing JSON shape → SearchHit[], cache result.
 */
class BingNewsSearchAdapter implements SearchAdapter {
  readonly kind = 'bing-news' as const
  readonly key = 'bing-news'

  private cache = new Map<string, { hits: SearchHit[]; expiresAt: number }>()
  private callsInWindow = 0
  private windowStart = Date.now()

  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const env = loadEnv()
    const apiKey = env.BING_NEWS_API_KEY

    if (!apiKey) {
      console.warn('[bing-news] no API key, returning empty hits (degraded)')
      return []
    }

    const q = keywords.join(' ')
    const cacheKey = JSON.stringify({ q, freshness: opts.freshness })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.hits

    // Fixed-window rate limit: ≤3 calls per 1000ms wall clock.
    const now = Date.now()
    if (now - this.windowStart >= 1000) {
      this.windowStart = now
      this.callsInWindow = 0
    }
    if (this.callsInWindow >= 3) {
      console.warn('[bing-news] rate-limited, returning empty hits (degraded)')
      return []
    }
    this.callsInWindow++

    try {
      const url = new URL(env.SEARCH_API_BASE_URL)
      url.searchParams.set('q', q)
      url.searchParams.set('count', String(opts.count ?? 20))
      if (opts.freshness) url.searchParams.set('freshness', opts.freshness)
      const res = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      })
      if (!res.ok) {
        console.warn(`[bing-news] HTTP ${res.status}, returning empty hits (degraded)`)
        return []
      }
      const json = await res.json() as {
        value?: Array<{
          url: string; name: string; description: string; datePublished: string;
          provider?: Array<{ name: string }>;
        }>
      }
      const hits: SearchHit[] = (json.value ?? []).map((item): SearchHit => ({
        url: item.url,
        title: item.name,
        snippet: item.description,
        publishedAt: item.datePublished,
        source: { name: item.provider?.[0]?.name ?? 'Bing', kind: 'mainstream' },
      }))
      this.cache.set(cacheKey, { hits, expiresAt: Date.now() + 24 * 3600_000 })
      return hits
    } catch (e) {
      console.error(`[bing-news] fetch error: ${(e as Error).message}, returning empty (degraded)`)
      return []
    }
  }
}

class RssSearchAdapter implements SearchAdapter {
  readonly kind = 'rss' as const
  readonly key = 'rss'

  // 默认订阅源(EX-3 中文主流):新华社、人民网;m4 由配置驱动可插拔
  private readonly feeds: Array<{ url: string; name: string; kind: SearchHit['source']['kind'] }> = [
    { url: 'http://www.xinhuanet.com/politics/news_politics.xml', name: '新华社·时政', kind: 'mainstream' },
    { url: 'http://www.people.com.cn/rss/politics.xml',           name: '人民网·时政', kind: 'mainstream' },
  ]

  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const limit = opts.count ?? 20
    const lowerKeywords = keywords.map(k => k.toLowerCase())
    const hits: SearchHit[] = []
    for (const feed of this.feeds) {
      try {
        const xml = await (await fetch(feed.url)).text()
        const items = this.parseRssItems(xml)
        for (const item of items) {
          const haystack = `${item.title} ${item.description}`.toLowerCase()
          if (lowerKeywords.length === 0 || lowerKeywords.some(k => haystack.includes(k))) {
            hits.push({
              url: item.link, title: item.title, snippet: item.description.slice(0, 280),
              ...(item.pubDate ? { publishedAt: item.pubDate } : {}),
              source: { name: feed.name, kind: feed.kind },
            })
            if (hits.length >= limit) return hits
          }
        }
      } catch (e) {
        // 单个 feed 失败不影响其他 feeds
        console.error(`[rss] feed ${feed.url} failed:`, (e as Error).message)
      }
    }
    return hits
  }

  // 极简 RSS 2.0 解析(没引第三方库以保持 zero-dep)。生产可换 fast-xml-parser 或 rss-parser。
  private parseRssItems(xml: string): Array<{ title: string; link: string; description: string; pubDate?: string }> {
    const items: Array<{ title: string; link: string; description: string; pubDate?: string }> = []
    const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
    const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
    const tag = (block: string, name: string): string | undefined => {
      const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
      return m ? cdata(m[1]!) : undefined
    }
    for (const match of xml.matchAll(itemRegex)) {
      const block = match[1]!
      const title = tag(block, 'title') ?? ''
      const link = tag(block, 'link') ?? ''
      const description = tag(block, 'description') ?? ''
      const pubDate = tag(block, 'pubDate')
      if (title && link) items.push({ title, link, description, ...(pubDate ? { pubDate } : {}) })
    }
    return items
  }
}

class DdgSearchAdapter implements SearchAdapter {
  readonly kind = 'ddg' as const
  readonly key = 'ddg'
  async query(): Promise<SearchHit[]> {
    throw new NotImplementedError('ddg')
  }
}

class AggregatorSearchAdapter implements SearchAdapter {
  readonly kind = 'aggregator' as const
  readonly key = 'aggregator'
  async query(): Promise<SearchHit[]> {
    throw new NotImplementedError('aggregator')
  }
}

/**
 * SearchAdapter pool — retrofitted onto `makePool` (au-T7).
 *
 * Single-flight selection: env.SEARCH_API_KIND picks ONE active adapter.
 * Different from Camera (Map-registry shape with multiple adapters live
 * side-by-side); same shape as legacy m2 switch-factory it replaces.
 *
 * Public surface preserved verbatim:
 *   - `getSearchAdapter()` — returns the env-selected SearchAdapter.
 *
 * New helper:
 *   - `resetSearchAdapterPoolForTests()` — clears the cached pool so tests
 *     can mutate `process.env.SEARCH_API_KIND` between cases. (Pre-retrofit
 *     `getSearchAdapter()` was fresh-per-call, so tests didn't need it; the
 *     retrofit caches via `makePool`, hence this escape hatch.)
 *
 * Lazy init by design: the pool is built on first `getSearchAdapter()` call.
 * NO module-load auto-init — that would force `loadEnv()` at import time,
 * which the m2 design explicitly avoided.
 */

let _pool: Pool<SearchAdapter> | null = null

const SEARCH_FACTORIES: Record<string, () => SearchAdapter> = {
  mock:               () => new MockSearchAdapter(),
  'bing-news':        () => new BingNewsSearchAdapter(),
  rss:                () => new RssSearchAdapter(),
  ddg:                () => new DdgSearchAdapter(),
  aggregator:         () => new AggregatorSearchAdapter(),
  tavily:             () => new TavilySearchAdapter(),
  // Gov-site scrapers (Plan-D Tasks 13-15, A2-γ). Opt-in via GOV_SCRAPER_ENABLED.
  // Listed in factories so tests / direct lookups can resolve them; only added
  // to `alsoRegister` (below) when env flag is `'true'`.
  'gov-gd-province':     () => new GovGdProvinceAdapter(),
  'gov-gz-city':         () => new GovGzCityAdapter(),
  'gov-public-security': () => new GovPublicSecurityAdapter(),
}

const VALID_SEARCH_KEYS = new Set(Object.keys(SEARCH_FACTORIES))

function _initSearchPool(): Pool<SearchAdapter> {
  const env = loadEnv()
  // env.SEARCH_API_KIND is a zod enum — already validated. The Set check is
  // defense-in-depth in case the schema ever drifts from the factories.
  const defaultKey = VALID_SEARCH_KEYS.has(env.SEARCH_API_KIND) ? env.SEARCH_API_KIND : 'mock'
  const alsoRegister: string[] = []
  // Gov scrapers (Plan-D Tasks 13-15, A2-γ) are opt-in: only registered into the
  // active pool when `GOV_SCRAPER_ENABLED=true`. Mirrors the `simulated-gzp`
  // pattern in src/dispatch/adapter-pool.ts.
  if (env.GOV_SCRAPER_ENABLED === 'true') {
    alsoRegister.push('gov-gd-province')
    alsoRegister.push('gov-gz-city')
    alsoRegister.push('gov-public-security')
  }
  const pool = makePool<SearchAdapter>({
    factories: SEARCH_FACTORIES,
    defaultKey,
    ...(alsoRegister.length > 0 ? { alsoRegister } : {}),
  })
  pool.init()
  return pool
}

export function getSearchAdapter(): SearchAdapter {
  if (!_pool) _pool = _initSearchPool()
  return _pool.getDefault()
}

/**
 * Test helper: clears the cached pool so the next `getSearchAdapter()` call
 * re-reads env. Pair with `resetEnvCacheForTests()` + `process.env` mutation
 * to switch the active adapter mid-suite. Production code should never call this.
 */
export function resetSearchAdapterPoolForTests(): void {
  _pool = null
}

// Export classes for direct testing
export { AggregatorSearchAdapter, BingNewsSearchAdapter, DdgSearchAdapter, MockSearchAdapter, RssSearchAdapter }
