import { describe, expect, test } from 'bun:test'

const RUN_INTEGRATION = process.env.INTEGRATION_TESTS === 'true'

describe.skipIf(!RUN_INTEGRATION)('tavily integration (real Tavily API)', () => {
  test('TAVILY_API_KEY set + real query returns ≥ 1 result', async () => {
    if (!process.env.TAVILY_API_KEY) {
      throw new Error('TAVILY_API_KEY required for integration test')
    }
    const { TavilySearchAdapter } = await import('@/news/adapters/tavily')
    const adapter = new TavilySearchAdapter()
    const hits = await adapter.query(['广州市公安局新闻'])
    expect(Array.isArray(hits)).toBe(true)
    if (hits.length > 0) {
      expect(hits[0]!.title).toBeTruthy()
      expect(hits[0]!.url).toMatch(/^https?:\/\//)
    }
  }, 30000)
})
