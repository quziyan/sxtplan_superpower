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

  test('Aggregator adapter throws NotImplementedError', async () => {
    const a = new AggregatorSearchAdapter()
    await expect(a.query()).rejects.toThrow(NotImplementedError)
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
