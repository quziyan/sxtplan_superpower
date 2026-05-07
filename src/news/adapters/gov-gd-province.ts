import type * as cheerio from 'cheerio'
import { GovScraperBaseAdapter } from './gov-scraper-base'
import { loadEnv } from '@/env'
import type { SearchHit } from '../types'

/**
 * GovGdProvinceAdapter — 广东省人民政府公示页爬虫 (Plan-D Task 13, ISC-A2γ.2).
 *
 * Inherits robots.txt + 1-rpm rate-limit + degraded-on-failure from
 * `GovScraperBaseAdapter`. Per-site contract:
 *   - baseUrl: `env.GOV_GD_PROVINCE_URL` (default `https://www.gd.gov.cn/gdywdt/sxtt/`).
 *   - listSelector: `.list_news li` — typical structure for gd.gov.cn news lists.
 *     (Selector is a reasonable offline pick; verify against live page when
 *     `GOV_SCRAPER_ENABLED=true` is rolled out.)
 *   - source.kind = `'gov'` (SearchHit.source.kind union); adapter.kind =
 *     `'gov-gd-province'` (SearchAdapter discriminator).
 */
export class GovGdProvinceAdapter extends GovScraperBaseAdapter {
  readonly key = 'gov-gd-province'
  readonly kind = 'gov-gd-province' as const
  protected baseUrl = loadEnv().GOV_GD_PROVINCE_URL
  protected listSelector = '.list_news li'

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
          source: { name: '广东省人民政府', kind: 'gov' as const },
          ...(date ? { publishedAt: date } : {}),
        }
      })
      .get()
      .filter((h) => h.title.length > 0)
  }
}
