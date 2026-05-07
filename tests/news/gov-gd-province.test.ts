import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GovGdProvinceAdapter } from '@/news/adapters/gov-gd-province'

const FIXTURE_HTML = `
  <html><body>
    <ul class="list_news">
      <li><a href="/news/2026/05/06/abc.html">广东出动 X 次专项</a><span class="date">2026-05-06</span></li>
      <li><a href="/news/2026/05/07/def.html">公安厅发布 Y 通告</a><span class="date">2026-05-07</span></li>
    </ul>
  </body></html>
`

describe('GovGdProvinceAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('parses fixture correctly', async () => {
    const adapter = new GovGdProvinceAdapter()
    ;(adapter as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (url: unknown) => {
      if (url!.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    const hits = await adapter.query([''])
    expect(hits).toHaveLength(2)
    expect(hits[0]!.title).toBe('广东出动 X 次专项')
    expect(hits[0]!.url).toContain('/news/2026/05/06/abc.html')
    expect(hits[0]!.publishedAt).toBe('2026-05-06')
    expect(hits[0]!.source).toEqual({ name: '广东省人民政府', kind: 'gov' })
  })
})
