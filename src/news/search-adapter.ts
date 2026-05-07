import { loadEnv } from '@/env'
import { makePool, type Pool } from '@/integrations/external-adapter'
import type { SearchAdapter, SearchHit, SearchOpts } from './types'
import { NotImplementedError } from './types'

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

class BingNewsSearchAdapter implements SearchAdapter {
  readonly kind = 'bing-news' as const
  readonly key = 'bing-news'
  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const env = loadEnv()
    if (!env.SEARCH_API_KEY) throw new Error('SEARCH_API_KEY not set for bing-news')
    const params = new URLSearchParams({
      q: keywords.join(' '),
      count: String(opts.count ?? 20),
      freshness: opts.freshness ?? 'Week',
      mkt: 'zh-CN',
    })
    const res = await fetch(`${env.SEARCH_API_BASE_URL}?${params}`, {
      headers: { 'Ocp-Apim-Subscription-Key': env.SEARCH_API_KEY },
    })
    if (!res.ok) throw new Error(`bing-news ${res.status}`)
    const data = await res.json() as {
      value: Array<{
        url: string; name: string; description: string; datePublished: string;
        provider?: Array<{ name: string }>;
      }>
    }
    return data.value.map((v): SearchHit => ({
      url: v.url, title: v.name, snippet: v.description, publishedAt: v.datePublished,
      source: { name: v.provider?.[0]?.name ?? 'Unknown', kind: 'mainstream' },
    }))
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
  mock:         () => new MockSearchAdapter(),
  'bing-news':  () => new BingNewsSearchAdapter(),
  rss:          () => new RssSearchAdapter(),
  ddg:          () => new DdgSearchAdapter(),
  aggregator:   () => new AggregatorSearchAdapter(),
}

const VALID_SEARCH_KEYS = new Set(Object.keys(SEARCH_FACTORIES))

function _initSearchPool(): Pool<SearchAdapter> {
  const env = loadEnv()
  // env.SEARCH_API_KIND is a zod enum — already validated. The Set check is
  // defense-in-depth in case the schema ever drifts from the factories.
  const defaultKey = VALID_SEARCH_KEYS.has(env.SEARCH_API_KIND) ? env.SEARCH_API_KIND : 'mock'
  const pool = makePool<SearchAdapter>({ factories: SEARCH_FACTORIES, defaultKey })
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
