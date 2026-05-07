import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GovGzCityAdapter } from '@/news/adapters/gov-gz-city'

// Fixture matches the adapter's `.gov-info li` selector. Selector is an offline
// pick; when GOV_SCRAPER_ENABLED rolls out, verify against the live page and
// adjust both adapter + fixture together.
const FIXTURE_HTML = `
  <html><body>
    <ul class="gov-info">
      <li><a href="/zwgk/2026/05/01/abc.html">广州市发布 A 公告</a><span class="date">2026-05-01</span></li>
      <li><a href="/zwgk/2026/05/02/def.html">广州市发布 B 通知</a><span class="date">2026-05-02</span></li>
    </ul>
  </body></html>
`

describe('GovGzCityAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('parses fixture correctly', async () => {
    const adapter = new GovGzCityAdapter()
    ;(adapter as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (url: unknown) => {
      if (url!.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    const hits = await adapter.query([''])
    expect(hits).toHaveLength(2)
    expect(hits[0]!.title).toBe('广州市发布 A 公告')
    expect(hits[0]!.url).toContain('/zwgk/2026/05/01/abc.html')
    expect(hits[0]!.publishedAt).toBe('2026-05-01')
    expect(hits[0]!.source).toEqual({ name: '广州市人民政府', kind: 'gov' })
  })
})
