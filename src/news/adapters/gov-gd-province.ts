import * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from './gov-scraper-base'
import { loadEnv } from '@/env'
import type { SearchHit, SearchOpts } from '../types'

/**
 * GovGdProvinceAdapter — 广东省人民政府门户站爬虫(D' 阶段重写)。
 *
 * env GOV_GD_PROVINCE_URL 接受逗号分隔的多个新闻列表 URL,默认 4 个:
 *   - /gdywdt/gdyw/   广东要闻
 *   - /gdywdt/bmdt/   部门动态
 *   - /gdywdt/dsdt/   地市动态
 *   - /gdywdt/zfjg/   政府机构
 *
 * DOM 结构(2026-05 实测):
 *   <ul><li><a href=".../content/post_NNNNNNN.html">标题</a> YYYY-MM-DD</li></ul>
 *
 * Override query():基类 query() 只支持单 URL + 1 rpm/instance,我们要多
 * URL 串行抓 + 都用同一个 1 rpm 限速桶(全部 fetch 视作一个 batch)。
 */
export class GovGdProvinceAdapter extends GovScraperBaseAdapter {
  readonly key = 'gov-gd-province'
  readonly kind = 'gov-gd-province' as const
  // baseUrl 仍取第一条用于 robots.txt 检查 — gd.gov.cn 整站
  protected baseUrl = (loadEnv().GOV_GD_PROVINCE_URL.split(',')[0] ?? '').trim()
  protected listSelector = 'ul li'  // 不直接用,query() 自己解析

  // 60s 内同一 query 只发一次 HTTP — 5 watchlist 共享同一抓取批次。
  // 缓存所有 raw hits(query 时再做关键词过滤),命中率 100%。
  private cachedHits: SearchHit[] | null = null
  private cacheExpiresAt = 0

  /** 内部:把 env 的逗号分隔 URL 字符串拆成数组。空段过滤。*/
  private getUrls(): string[] {
    return loadEnv().GOV_GD_PROVINCE_URL
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  override async query(keywords: string[], _opts: SearchOpts = {}): Promise<SearchHit[]> {
    const q = keywords.join(' ').trim()
    const urls = this.getUrls()
    if (urls.length === 0) return []

    // 60s 缓存命中 → 直接返回 raw,后面只做关键词过滤
    const now = Date.now()
    let allHits: SearchHit[]
    if (this.cachedHits !== null && this.cacheExpiresAt > now) {
      allHits = this.cachedHits
    } else if (now - this.lastFetch < this.minIntervalMs) {
      // 限速但缓存过期:此刻没数据可还
      console.warn(`[${this.key}] rate-limited (no cache), returning empty`)
      return []
    } else {
      if (!(await this.respectRobots())) {
        console.warn(`[${this.key}] robots.txt forbids, returning empty`)
        return []
      }
      this.lastFetch = now
      allHits = []
      for (const url of urls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          if (!res.ok) {
            console.warn(`[${this.key}] HTTP ${res.status} on ${url}`)
            continue
          }
          const html = await res.text()
          const $ = cheerio.load(html)
          const hitsForUrl = this.parseList($, url)
          allHits.push(...hitsForUrl)
        } catch (e) {
          console.error(`[${this.key}] fetch ${url} error: ${(e as Error).message}`)
        }
      }
      this.cachedHits = allHits
      this.cacheExpiresAt = now + this.minIntervalMs  // 60s
    }

    // 客户端关键词匹配(gov 站没原生搜索)— 任一 token 命中 title/snippet 即保留。
    // 把每个 keyword 按空格拆 token,任一 token 命中即算 hit(更宽容,gov 标题
    // 一般不会原样含整个查询短语)。
    const tokens = keywords
      .flatMap((kw) => kw.split(/\s+/))
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (tokens.length === 0) return allHits
    return allHits.filter((h) =>
      tokens.some((tok) => h.title.includes(tok) || (h.snippet ?? '').includes(tok)),
    )
  }

  /**
   * 实际 DOM 解析 — 不走 base.parser($) 抽象,因为我们要一次处理 4 个不同 URL,
   * 还要按 href 格式过滤(只取 /content/post_NNNNNNN.html 的真新闻条目)。
   */
  private parseList($: cheerio.CheerioAPI, sourceUrl: string): SearchHit[] {
    const hits: SearchHit[] = []
    $('ul li').each((_, el) => {
      const $el = $(el)
      const a = $el.find('a').first()
      const href = a.attr('href')
      const titleText = a.text().trim()
      if (!href || !titleText) return
      // 真新闻条目特征:href 含 /content/post_<digits>.html
      if (!/\/content\/post_\d+\.html/i.test(href)) return
      // 标题至少 5 字 + 含 CJK
      if (titleText.length < 5 || !/[一-鿿]/.test(titleText)) return

      // 完整 URL
      const fullUrl = href.startsWith('http') ? href : new URL(href, sourceUrl).toString()
      // 日期:从 li 的整体文本里抽 YYYY-MM-DD
      const liText = $el.text()
      const dateMatch = liText.match(/(\d{4})-(\d{2})-(\d{2})/)
      const publishedAt = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00+08:00` : undefined

      const hit: SearchHit = {
        title: titleText,
        url: fullUrl,
        snippet: titleText,  // 列表页无摘要,用标题做降级
        source: { name: '广东省人民政府', kind: 'gov' as const },
        ...(publishedAt ? { publishedAt } : {}),
      }
      hits.push(hit)
    })
    return hits
  }

  // 基类 parser 已成弃用 —— 我们 override 了 query(),不会再调它。
  // 这里 stub 是为了满足 abstract,不会被运行时调用。
  protected parser(_$: cheerio.CheerioAPI): SearchHit[] {
    return []
  }
}
