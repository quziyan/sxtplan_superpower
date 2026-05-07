import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GovPublicSecurityAdapter } from '@/news/adapters/gov-public-security'

// Fixture matches the adapter's `.zfxxgk-list .item` selector. Selector chosen
// offline to mirror typical 政府信息公开 page shape — verify against the live
// page when GOV_SCRAPER_ENABLED rolls out.
const FIXTURE_HTML = `
  <html><body>
    <div class="zfxxgk-list">
      <div class="item"><a href="/zfxxgk/2026/05/01/abc.html">公安厅发布 P 通告</a><span class="date">2026-05-01</span></div>
      <div class="item"><a href="/zfxxgk/2026/05/02/def.html">公安厅发布 Q 公示</a><span class="date">2026-05-02</span></div>
    </div>
  </body></html>
`

describe('GovPublicSecurityAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('parses fixture correctly', async () => {
    const adapter = new GovPublicSecurityAdapter()
    ;(adapter as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (url: unknown) => {
      if (url!.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    const hits = await adapter.query([''])
    expect(hits).toHaveLength(2)
    expect(hits[0]!.title).toBe('公安厅发布 P 通告')
    expect(hits[0]!.url).toContain('/zfxxgk/2026/05/01/abc.html')
    expect(hits[0]!.publishedAt).toBe('2026-05-01')
    expect(hits[0]!.source).toEqual({ name: '广东省政府信息公开', kind: 'gov' })
  })
})
