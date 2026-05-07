import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from '@/news/adapters/gov-scraper-base'
import type { SearchHit } from '@/news/types'

// Concrete test subclass — minimal parser that pulls items via `.item` selector.
class TestScraperAdapter extends GovScraperBaseAdapter {
  readonly key = 'test-scraper'
  readonly kind = 'gov-test' as const
  protected baseUrl = 'https://example.com/news'
  protected listSelector = '.item'
  protected parser($: cheerio.CheerioAPI): SearchHit[] {
    return $('.item')
      .map(
        (_, el) =>
          ({
            title: $(el).find('h2').text(),
            url: $(el).find('a').attr('href') ?? '',
            snippet: $(el).find('p').text(),
            source: { name: 'test', kind: 'gov' as const },
            publishedAt: '2026-05-08',
          }) satisfies SearchHit,
      )
      .get()
  }
}

describe('GovScraperBaseAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('rate-limit: second call within 60s returns empty', async () => {
    const a = new TestScraperAdapter()
    globalThis.fetch = (async () =>
      new Response('<div class="item"><h2>T1</h2></div>')) as unknown as typeof fetch
    // Pretend we just fetched — should hit the rate-limit branch.
    ;(a as unknown as { lastFetch: number }).lastFetch = Date.now()
    const hits = await a.query([''])
    expect(hits).toEqual([])
  })

  test('robots.txt Disallow: / → returns empty', async () => {
    const a = new TestScraperAdapter()
    ;(a as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /\n')
      }
      return new Response('<div class="item"><h2>T1</h2></div>')
    }) as unknown as typeof fetch
    const hits = await a.query([''])
    expect(hits).toEqual([])
  })

  test('happy path: robots.txt OK + parser returns hits', async () => {
    const a = new TestScraperAdapter()
    ;(a as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(
        '<div class="item"><h2>Title 1</h2><a href="/news/1">link</a><p>snippet</p></div>',
      )
    }) as unknown as typeof fetch
    const hits = await a.query([''])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('Title 1')
  })
})
