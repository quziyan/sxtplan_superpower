import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GovGdProvinceAdapter } from '@/news/adapters/gov-gd-province'
import { GovGzCityAdapter } from '@/news/adapters/gov-gz-city'

// γ failure isolation (Plan-D Task 16, ISC-A2γ.4): when one gov site returns 500
// the other adapter must still parse its own response. This proves the
// `GovScraperBaseAdapter` "degraded-on-failure → []" contract isolates instances
// from each other (no shared state poisoning, no thrown exceptions leaking out).

// Fixture matches GovGzCityAdapter's `.gov-info li` selector — keep in lock-step
// with tests/news/gov-gz-city.test.ts.
const GZ_FIXTURE_HTML = `
  <html><body>
    <ul class="gov-info">
      <li><a href="/zwgk/2026/05/01/abc.html">广州市发布 A 公告</a><span class="date">2026-05-01</span></li>
      <li><a href="/zwgk/2026/05/02/def.html">广州市发布 B 通知</a><span class="date">2026-05-02</span></li>
    </ul>
  </body></html>
`

describe('Gov scrapers failure isolation', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('one site 500 does not affect other site', async () => {
    const gd = new GovGdProvinceAdapter()
    const gz = new GovGzCityAdapter()
    ;(gd as unknown as { lastFetch: number }).lastFetch = 0
    ;(gz as unknown as { lastFetch: number }).lastFetch = 0

    globalThis.fetch = (async (url: unknown) => {
      const u = url!.toString()
      if (u.includes('/robots.txt')) return new Response('User-agent: *\n')
      if (u.includes('gd.gov.cn')) return new Response('Server Error', { status: 500 })
      if (u.includes('gz.gov.cn')) return new Response(GZ_FIXTURE_HTML)
      return new Response('?', { status: 404 })
    }) as unknown as typeof globalThis.fetch

    const [gdHits, gzHits] = await Promise.all([gd.query(['']), gz.query([''])])

    // gd 500 → degraded empty
    expect(gdHits).toEqual([])
    // gz parsed unaffected by gd's failure
    expect(gzHits.length).toBeGreaterThan(0)
    expect(gzHits[0]!.title).toBe('广州市发布 A 公告')
  })
})
