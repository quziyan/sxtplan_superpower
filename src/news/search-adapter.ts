import { loadEnv } from '@/env'
import type { SearchAdapter, SearchHit, SearchOpts } from './types'
import { NotImplementedError } from './types'

class MockSearchAdapter implements SearchAdapter {
  readonly kind = 'mock' as const
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
  async query(): Promise<SearchHit[]> {
    throw new NotImplementedError('ddg')
  }
}

class AggregatorSearchAdapter implements SearchAdapter {
  readonly kind = 'aggregator' as const
  async query(): Promise<SearchHit[]> {
    throw new NotImplementedError('aggregator')
  }
}

export function getSearchAdapter(): SearchAdapter {
  const env = loadEnv()
  switch (env.SEARCH_API_KIND) {
    case 'bing-news': return new BingNewsSearchAdapter()
    case 'rss': return new RssSearchAdapter()
    case 'ddg': return new DdgSearchAdapter()
    case 'aggregator': return new AggregatorSearchAdapter()
    case 'mock':
    default: return new MockSearchAdapter()
  }
}

// Export classes for direct testing
export { AggregatorSearchAdapter, BingNewsSearchAdapter, DdgSearchAdapter, MockSearchAdapter, RssSearchAdapter }
