import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import { TavilySearchAdapter } from '@/news/adapters/tavily'

describe('TavilySearchAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    envSnapshot = { TAVILY_API_KEY: process.env.TAVILY_API_KEY }
    resetEnvCacheForTests()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('happy path: API key set + fetch returns results → SearchHits', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    const calls: any[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: url.toString(), init })
      return new Response(JSON.stringify({
        results: [
          { title: '广州专项整治', url: 'https://news.example.com/a', content: 'snippet here', score: 0.9, published_date: '2026-05-07' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['广州', '专项'])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('广州专项整治')
    expect(hits[0]!.url).toBe('https://news.example.com/a')
    expect(hits[0]!.source.name).toBe('news.example.com')
    expect(hits[0]!.source.kind).toBe('mainstream')
    expect(hits[0]!.publishedAt).toBe('2026-05-07')

    const body = JSON.parse(calls[0].init.body)
    expect(body.api_key).toBe('tvly-test-key')
    expect(body.query).toBe('广州 专项')
  })

  test('no API key: returns empty + warn, no fetch call', async () => {
    process.env.TAVILY_API_KEY = ''
    resetEnvCacheForTests()
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; return new Response('{}') }) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
    expect(fetchCalled).toBe(false)
  })

  test('rate-limited: 3 calls succeed, 4th returns empty', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    let callCount = 0
    globalThis.fetch = (async () => {
      callCount++
      return new Response(JSON.stringify({
        results: [{ title: `r${callCount}`, url: 'https://x/', content: '', score: 0.1 }],
      }), { status: 200 })
    }) as any

    const adapter = new TavilySearchAdapter()
    const r1 = await adapter.query(['q1'])
    const r2 = await adapter.query(['q2'])
    const r3 = await adapter.query(['q3'])
    const r4 = await adapter.query(['q4'])

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(1)
    expect(r4).toEqual([])
    expect(callCount).toBe(3)
  })

  test('fetch HTTP 500: returns empty + warn', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key'
    resetEnvCacheForTests()
    globalThis.fetch = (async () => new Response('error', { status: 500 })) as any

    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
  })
})
