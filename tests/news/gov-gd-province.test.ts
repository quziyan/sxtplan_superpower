import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GovGdProvinceAdapter } from '@/news/adapters/gov-gd-province'

// Fixture 匹配 D' 重写后的 parser:href 必须含 /content/post_NNNN.html,
// 标题 ≥ 5 字 + CJK,日期是 li 文本里的 YYYY-MM-DD。
const FIXTURE_HTML = `
  <html><body>
    <ul>
      <li><a href="https://www.gd.gov.cn/gdywdt/gdyw/content/post_1234567.html">广东出动专项行动 X 次</a> 2026-05-06</li>
      <li><a href="https://www.gd.gov.cn/gdywdt/bmdt/content/post_1234568.html">公安厅发布 Y 通告政策解读</a> 2026-05-07</li>
      <li><a href="/about.html">不该出现的非新闻链接</a></li>
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
    let fetchCount = 0
    globalThis.fetch = (async (url: unknown) => {
      const u = url!.toString()
      if (u.endsWith('/robots.txt')) return new Response('User-agent: *\n')
      fetchCount++
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    // 不传 keyword → 关键词过滤短路,返回所有解析出的命中
    const hits = await adapter.query([])
    // 默认 4 个 URL,fixture 同样 HTML × 4 → 8 个 hit(2 valid × 4 URLs);
    // /about.html 不匹配 /content/post_ pattern,被丢弃
    expect(hits.length).toBe(8)
    expect(fetchCount).toBe(4)
    expect(hits[0]!.title).toBe('广东出动专项行动 X 次')
    expect(hits[0]!.url).toContain('/content/post_1234567.html')
    // 新格式:ISO datetime with +08:00,而非纯 YYYY-MM-DD
    expect(hits[0]!.publishedAt).toBe('2026-05-06T00:00:00+08:00')
    expect(hits[0]!.source).toEqual({ name: '广东省人民政府', kind: 'gov' })
  })

  test('keyword filter: token 级 OR 命中', async () => {
    const adapter = new GovGdProvinceAdapter()
    ;(adapter as unknown as { lastFetch: number }).lastFetch = 0
    globalThis.fetch = (async (url: unknown) => {
      if (url!.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    // "公安 通告" 拆 token → "公安" / "通告",任一 token 命中即保留
    const hits = await adapter.query(['公安 通告'])
    // FIXTURE 第 2 条 "公安厅发布 Y 通告政策解读" 含 "公安" 和 "通告" 两个 token
    // 第 1 条 "广东出动专项行动 X 次" 都不含 → 被过滤
    expect(hits.every((h) => h.title.includes('公安') || h.title.includes('通告'))).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
  })

  test('rate-limit: 60s 内重复调用走缓存(0 ms,0 fetch)', async () => {
    const adapter = new GovGdProvinceAdapter()
    ;(adapter as unknown as { lastFetch: number }).lastFetch = 0
    let fetchCount = 0
    globalThis.fetch = (async (url: unknown) => {
      if (url!.toString().endsWith('/robots.txt')) return new Response('User-agent: *\n')
      fetchCount++
      return new Response(FIXTURE_HTML)
    }) as unknown as typeof globalThis.fetch

    const r1 = await adapter.query([])
    const fetched1 = fetchCount
    const r2 = await adapter.query(['公安'])
    const fetched2 = fetchCount
    expect(r1.length).toBeGreaterThan(0)
    expect(r2.length).toBeGreaterThan(0)
    // 第 2 次 query 走缓存,fetchCount 不变
    expect(fetched2).toBe(fetched1)
  })
})
