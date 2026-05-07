import type * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from './gov-scraper-base'
import { loadEnv } from '@/env'
import type { SearchHit } from '../types'

/**
 * GovPublicSecurityAdapter — 广东省政府信息公开 / 公安厅公示爬虫
 * (Plan-D Task 15, ISC-A2γ.4).
 *
 * Inherits robots.txt + 1-rpm rate-limit + degraded-on-failure from
 * `GovScraperBaseAdapter`. Per-site contract:
 *   - baseUrl: `env.GOV_PUBLIC_SECURITY_URL` (default `https://www.gd.gov.cn/zfxxgk/`).
 *   - listSelector: `.zfxxgk-list .item` — chosen offline as a plausible list
 *     class for 政府信息公开门户 pages. Verify against the live page when
 *     `GOV_SCRAPER_ENABLED=true` rolls out; the test fixture matches this
 *     selector exactly.
 *   - source.kind = `'gov'` (SearchHit.source.kind union); adapter.kind =
 *     `'gov-public-security'` (SearchAdapter discriminator).
 */
export class GovPublicSecurityAdapter extends GovScraperBaseAdapter {
  readonly key = 'gov-public-security'
  readonly kind = 'gov-public-security' as const
  protected baseUrl = loadEnv().GOV_PUBLIC_SECURITY_URL
  protected listSelector = '.zfxxgk-list .item'

  protected parser($: cheerio.CheerioAPI): SearchHit[] {
    return $(this.listSelector)
      .map((_, el): SearchHit => {
        const a = $(el).find('a')
        const href = a.attr('href') ?? '/'
        const date = $(el).find('.date').text().trim()
        return {
          title: a.text().trim(),
          url: new URL(href, this.baseUrl).toString(),
          snippet: '',
          source: { name: '广东省政府信息公开', kind: 'gov' as const },
          ...(date ? { publishedAt: date } : {}),
        }
      })
      .get()
      .filter((h) => h.title.length > 0)
  }
}
