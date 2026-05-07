import type * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from './gov-scraper-base'
import { loadEnv } from '@/env'
import type { SearchHit } from '../types'

/**
 * GovGzCityAdapter — 广州市人民政府信息公开门户爬虫 (Plan-D Task 14, ISC-A2γ.3).
 *
 * Inherits robots.txt + 1-rpm rate-limit + degraded-on-failure from
 * `GovScraperBaseAdapter`. Per-site contract:
 *   - baseUrl: `env.GOV_GZ_CITY_URL` (default `https://www.gz.gov.cn/zwgk/zfxxgkml/`).
 *   - listSelector: `.gov-info li` — chosen offline as a plausible Chinese gov
 *     info-disclosure list shape. Verify against the live page when
 *     `GOV_SCRAPER_ENABLED=true` rolls out; the test fixture matches this
 *     selector exactly so the adapter contract is locked.
 *   - source.kind = `'gov'` (SearchHit.source.kind union); adapter.kind =
 *     `'gov-gz-city'` (SearchAdapter discriminator).
 */
export class GovGzCityAdapter extends GovScraperBaseAdapter {
  readonly key = 'gov-gz-city'
  readonly kind = 'gov-gz-city' as const
  protected baseUrl = loadEnv().GOV_GZ_CITY_URL
  protected listSelector = '.gov-info li'

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
          source: { name: '广州市人民政府', kind: 'gov' as const },
          ...(date ? { publishedAt: date } : {}),
        }
      })
      .get()
      .filter((h) => h.title.length > 0)
  }
}
