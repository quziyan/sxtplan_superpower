import * as cheerio from 'cheerio'
import type { SearchHit } from './types'

/**
 * 抓取 URL 的 HTML 并提取发布日期。Tavily 对许多 .gov.cn / 地方门户不返
 * published_date,这里兜底:fetch HTML → 多 selector 试 → 成功则返 ISO 字符串。
 *
 * 提取优先级:
 *  1. JSON-LD `datePublished`
 *  2. <meta property="article:published_time">
 *  3. <meta name="pubdate" | "PubDate" | "publishdate" | "publish_date">
 *  4. <meta itemprop="datePublished">
 *  5. <meta name="DC.date.issued" | "date">
 *  6. <time datetime="...">
 *  7. 正文文本中 `YYYY-MM-DD` / `YYYY年MM月DD日`(.gov.cn 旧站常见)
 *
 * 失败行为(均返 undefined):
 *  - HTTP 非 2xx / fetch 超时(8s) / cheerio 解析异常
 *  - 所有 selector 都没命中
 */
export async function fetchPublishedDate(url: string, timeoutMs = 8000): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CNP-NewsBot/1.0; +https://example.com/bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!res.ok) return undefined
    const html = await res.text()
    return extractDateFromHtml(html)
  } catch {
    return undefined
  }
}

export function extractDateFromHtml(html: string): string | undefined {
  let $: cheerio.CheerioAPI
  try { $ = cheerio.load(html) } catch { return undefined }

  // 1. JSON-LD
  const jsonLdBlocks = $('script[type="application/ld+json"]').toArray()
  for (const node of jsonLdBlocks) {
    try {
      const raw = $(node).text().trim()
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const found = findDatePublishedInJsonLd(parsed)
      if (found) {
        const iso = toIso(found)
        if (iso) return iso
      }
    } catch { /* ignore one bad block */ }
  }

  // 2-5. meta tags(顺序敏感,优先级高的先试)
  const metaCandidates = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="PubDate"]',
    'meta[name="publishdate"]',
    'meta[name="publish_date"]',
    'meta[itemprop="datePublished"]',
    'meta[property="og:published_time"]',
    'meta[name="DC.date.issued"]',
    'meta[name="date"]',
  ]
  for (const sel of metaCandidates) {
    const v = $(sel).attr('content')
    if (v) {
      const iso = toIso(v)
      if (iso) return iso
    }
  }

  // 6. <time datetime="...">
  const timeAttr = $('time[datetime]').first().attr('datetime')
  if (timeAttr) {
    const iso = toIso(timeAttr)
    if (iso) return iso
  }

  // 7. 正文文本兜底 — .gov.cn 旧站常把发布时间放在 div.info 之类元素里
  const text = $('body').text()
  const m = text.match(/(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})/)
  if (m) {
    const y = m[1]!, mo = m[2]!.padStart(2, '0'), d = m[3]!.padStart(2, '0')
    const iso = toIso(`${y}-${mo}-${d}`)
    if (iso) return iso
  }

  return undefined
}

function findDatePublishedInJsonLd(node: unknown): string | undefined {
  if (!node) return undefined
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findDatePublishedInJsonLd(x)
      if (r) return r
    }
    return undefined
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (typeof obj.datePublished === 'string') return obj.datePublished
    if (typeof obj.dateCreated === 'string') return obj.dateCreated
    if (typeof obj.uploadDate === 'string') return obj.uploadDate
    for (const v of Object.values(obj)) {
      const r = findDatePublishedInJsonLd(v)
      if (r) return r
    }
  }
  return undefined
}

function toIso(raw: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  const ts = Date.parse(s)
  if (Number.isFinite(ts)) return new Date(ts).toISOString()
  return undefined
}

/**
 * 共享:并发抓取 HTML 兜底 publishedAt — 只对原本没 publishedAt 的 hit 调
 * fetchPublishedDate。简易并发池(concurrency=N),保留输入顺序。
 * Tavily / Yunwu-DR 两个 adapter 都用。
 */
export async function enrichPublishedDates(hits: SearchHit[], concurrency = 4): Promise<SearchHit[]> {
  const todo = hits.map((h, i) => ({ idx: i, hit: h }))
  const result: SearchHit[] = new Array(hits.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= todo.length) return
      const { idx, hit } = todo[i]!
      if (hit.publishedAt) { result[idx] = hit; continue }
      const date = await fetchPublishedDate(hit.url)
      result[idx] = date ? { ...hit, publishedAt: date } : hit
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, todo.length) }, () => worker())
  await Promise.all(workers)
  return result
}
