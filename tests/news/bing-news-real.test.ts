import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import { resetSearchAdapterPoolForTests, getSearchAdapter } from '@/news/search-adapter'

/**
 * Plan-D Task 7 — BingNewsSearchAdapter real-path tests.
 *
 * Covers the 4 paths spec'd in the plan: happy / no-key / rate-limited / HTTP 500.
 * Each path exercises the adapter via the env-selected pool (SEARCH_API_KIND=bing-news)
 * to also lock in the wiring contract.
 */
describe('BingNewsSearchAdapter real path', () => {
  let originalFetch: typeof globalThis.fetch
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    envSnapshot = {
      BING_NEWS_API_KEY: process.env.BING_NEWS_API_KEY,
      SEARCH_API_KIND: process.env.SEARCH_API_KIND,
    }
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()
  })

  test('happy path: API key set + fetch returns json → SearchHits', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key-xxx'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    const calls: Array<{ url: string; init: { headers: Record<string, string> } }> = []
    globalThis.fetch = (async (url: URL | string, init: { headers: Record<string, string> }) => {
      calls.push({ url: url.toString(), init })
      return new Response(JSON.stringify({
        value: [
          {
            name: 'test article',
            url: 'https://example/1',
            description: 'desc',
            provider: [{ name: 'X' }],
            datePublished: '2026-05-07',
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch

    const adapter = getSearchAdapter()
    const hits = await adapter.query(['广州警务'])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('test article')
    expect(hits[0]!.url).toBe('https://example/1')
    expect(hits[0]!.source.name).toBe('X')
    expect(calls[0]!.init.headers['Ocp-Apim-Subscription-Key']).toBe('test-key-xxx')
  })

  test('no API key: returns empty + warn, no fetch call', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = ''
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('{}')
    }) as unknown as typeof fetch

    const adapter = getSearchAdapter()
    const hits = await adapter.query(['X'])
    expect(hits).toEqual([])
    expect(fetchCalled).toBe(false)
  })

  test('rate-limited: 3 calls succeed, 4th returns empty', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return new Response(
        JSON.stringify({
          value: [
            {
              name: `r${callCount}`,
              url: `https://example/${callCount}`,
              description: '',
              provider: [],
              datePublished: '',
            },
          ],
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    // Distinct queries to bypass cache; same instance so rate-limit window is shared.
    const adapter = getSearchAdapter()
    const r1 = await adapter.query(['q1'])
    const r2 = await adapter.query(['q2'])
    const r3 = await adapter.query(['q3'])
    const r4 = await adapter.query(['q4']) // rate-limited

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(1)
    expect(r4).toEqual([])
    expect(callCount).toBe(3)
  })

  test('fetch HTTP 500: returns empty + warn', async () => {
    process.env.SEARCH_API_KIND = 'bing-news'
    process.env.BING_NEWS_API_KEY = 'test-key'
    resetEnvCacheForTests()
    resetSearchAdapterPoolForTests()

    globalThis.fetch = (async () => new Response('error', { status: 500 })) as unknown as typeof fetch

    const adapter = getSearchAdapter()
    const hits = await adapter.query(['X'])
    expect(hits).toEqual([])
  })
})
