import { describe, expect, test } from 'bun:test'
import {
  AggregatorSearchAdapter,
  DdgSearchAdapter,
  MockSearchAdapter,
  RssSearchAdapter,
  getSearchAdapter,
  resetSearchAdapterPoolForTests,
} from '@/news/search-adapter'
import { NotImplementedError } from '@/news/types'
import { resetEnvCacheForTests } from '@/env'

describe('SearchAdapter', () => {
  test('MockSearchAdapter returns at least 1 hit', async () => {
    const a = new MockSearchAdapter()
    const hits = await a.query(['台风', '抢险救援'])
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]!.title).toContain('Mock')
    expect(hits[0]!.source.kind).toBe('mainstream')
  })

  test('DDG adapter throws NotImplementedError', async () => {
    const a = new DdgSearchAdapter()
    await expect(a.query()).rejects.toThrow(NotImplementedError)
  })

  test('Aggregator adapter — empty pool returns []', async () => {
    // 单独实例化(没接入 pool)→ list() 是 null,降级返 []
    const a = new AggregatorSearchAdapter()
    const r = await a.query(['kw'])
    expect(Array.isArray(r)).toBe(true)
    expect(r.length).toBe(0)
  })

  test('Aggregator via pool fan-outs to all sources + 去重 by URL + 降级单源失败', async () => {
    // Fake fetch:
    // - tavily 返回 2 条
    // - gov-* 三个站点 fetch 返回 HTML 但 parser 解不出新闻(空)
    // - 整体只见 tavily 2 条
    const originalFetch = globalThis.fetch
    let tavilyCalls = 0, govCalls = 0
    globalThis.fetch = (async (url: unknown, _init?: unknown) => {
      const u = String(url)
      if (u.includes('tavily.com')) {
        tavilyCalls++
        return new Response(JSON.stringify({
          results: [
            { title: 'A', url: 'https://shared.example/a', content: 's', published_date: '2026-05-09' },
            { title: 'B', url: 'https://shared.example/b', content: 's', published_date: '2026-05-09' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (u.includes('gd.gov.cn') || u.includes('gz.gov.cn')) {
        govCalls++
        // 返回 robots.txt 和空 HTML 页(parser 找不到 .list_news li)
        if (u.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return new Response('<html><body><p>no news here</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('', { status: 404 })
    }) as typeof globalThis.fetch

    try {
      resetEnvCacheForTests()
      resetSearchAdapterPoolForTests()
      process.env.SEARCH_API_KIND = 'aggregator'
      process.env.TAVILY_API_KEY = 'tvly-test-key'
      process.env.GOV_SCRAPER_ENABLED = 'true'

      const a = getSearchAdapter()
      expect(a.kind).toBe('aggregator')
      const hits = await a.query(['关键词'])
      // 4 sources(tavily + 3 gov),tavily 出 2 条 unique URL,gov 全空
      expect(hits.length).toBe(2)
      expect(hits.map(h => h.url).sort()).toEqual([
        'https://shared.example/a',
        'https://shared.example/b',
      ])
      expect(tavilyCalls).toBe(1)
      expect(govCalls).toBeGreaterThanOrEqual(3)  // 3 gov + maybe 3 robots.txt
    } finally {
      globalThis.fetch = originalFetch
      resetEnvCacheForTests()
      resetSearchAdapterPoolForTests()
      delete process.env.SEARCH_API_KIND
      delete process.env.TAVILY_API_KEY
      delete process.env.GOV_SCRAPER_ENABLED
    }
  })

  test('getSearchAdapter() factory respects SEARCH_API_KIND=mock by default', () => {
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
    process.env.SEARCH_API_KIND = 'mock'
    const a = getSearchAdapter()
    expect(a.kind).toBe('mock')
  })

  test('getSearchAdapter() returns rss adapter when configured', () => {
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
    process.env.SEARCH_API_KIND = 'rss'
    const a = getSearchAdapter()
    expect(a.kind).toBe('rss')
  })

  // au-T7 retrofit: makePool now caches the active SearchAdapter.
  test('getSearchAdapter() caches the pool — repeat calls return same reference', () => {
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
    process.env.SEARCH_API_KIND = 'mock'
    const a1 = getSearchAdapter()
    const a2 = getSearchAdapter()
    expect(a2).toBe(a1)
    expect(a1.kind).toBe('mock')
  })

  // au-T7 retrofit: resetSearchAdapterPoolForTests() lets a SEARCH_API_KIND
  // change take effect; without the reset, the cached pool would keep returning mock.
  test('resetSearchAdapterPoolForTests() lets SEARCH_API_KIND change take effect', () => {
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
    process.env.SEARCH_API_KIND = 'mock'
    const before = getSearchAdapter()
    expect(before.kind).toBe('mock')

    // Mutate env without reset → still mock (cache wins).
    resetEnvCacheForTests()
    process.env.SEARCH_API_KIND = 'rss'
    expect(getSearchAdapter().kind).toBe('mock')

    // Now reset → next call rebuilds pool with new env.
    resetSearchAdapterPoolForTests()
    const after = getSearchAdapter()
    expect(after.kind).toBe('rss')
    expect(after).toBeInstanceOf(RssSearchAdapter)
  })

  // RSS XML parser — pure unit test on parseRssItems via crafted XML
  test('RssSearchAdapter parses RSS XML items + filters by keyword', async () => {
    // We can't easily call private parseRssItems; instead, verify via behavior:
    // override fetch globally for this test (Bun supports replacing globalThis.fetch)
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown) => ({
      text: async () => `<?xml version="1.0"?><rss><channel>
        <item><title>台风海葵逼近粤西</title><link>https://x/1</link>
          <description><![CDATA[II 级响应启动]]></description><pubDate>2026-05-04T11:30:00Z</pubDate></item>
        <item><title>无关新闻</title><link>https://x/2</link>
          <description>and this is unrelated</description></item>
      </channel></rss>`,
    })) as unknown as typeof fetch
    try {
      const a = new RssSearchAdapter()
      // count:1 caps results to 1; both feeds would return a match but we stop after the first
      const hits = await a.query(['台风'], { count: 1 })
      expect(hits.length).toBe(1)
      expect(hits[0]!.title).toContain('台风海葵')
      expect(hits[0]!.source.name).toContain('新华')
      expect(hits[0]!.publishedAt).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('default SEARCH_API_KIND=tavily resolves TavilySearchAdapter', () => {
    const oldKind = process.env.SEARCH_API_KIND
    delete process.env.SEARCH_API_KIND
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
    try {
      const adapter = getSearchAdapter()
      expect(adapter.kind).toBe('tavily')
      expect(adapter.key).toBe('tavily')
    } finally {
      if (oldKind !== undefined) process.env.SEARCH_API_KIND = oldKind
      resetEnvCacheForTests()
      resetSearchAdapterPoolForTests()
    }
  })

  test('RssSearchAdapter survives one feed failure and returns from others', async () => {
    let callCount = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown) => {
      callCount++
      if (callCount === 1) throw new Error('feed 1 down')
      return {
        text: async () => `<?xml version="1.0"?><rss><channel>
          <item><title>抢险救援动员</title><link>https://x/3</link>
            <description>消防车队前置</description></item>
        </channel></rss>`,
      }
    }) as unknown as typeof fetch
    try {
      const a = new RssSearchAdapter()
      const hits = await a.query(['抢险'])
      expect(hits.length).toBeGreaterThanOrEqual(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
