export type SearchHit = {
  url: string
  title: string
  snippet: string
  publishedAt?: string
  source: { name: string; kind: 'mainstream' | 'gov' | 'social' | 'foreign' }
}

export type SearchOpts = {
  count?: number
  freshness?: 'Day' | 'Week' | 'Month'
  /**
   * 显式覆盖时效窗口(天)。优先级:opts.freshnessDays > DB 设置 > env NEWS_FRESHNESS_DAYS。
   * 用于运行时(news-ingest tick)注入每次拉取的窗口长度。
   */
  freshnessDays?: number
}

// Gov-site scraper kinds (Plan-D Task 12, A2-γ). Concrete subclasses (Tasks 13-15)
// pick one each: gd-province / gz-city / gd-public-security.
export type GovScraperKind = 'gov-gd-province' | 'gov-gz-city' | 'gov-public-security' | 'gov-test'

export interface SearchAdapter {
  readonly kind: 'mock' | 'bing-news' | 'tavily' | 'yunwu-dr' | 'rss' | 'ddg' | 'aggregator' | GovScraperKind
  // `key` mirrors `kind` and exists to satisfy the `ExternalAdapter` contract used by
  // the makePool template (au-T5). Kept distinct from `kind` so existing literal-union
  // type narrowing on `kind` keeps working for callers/tests.
  readonly key: string
  query(keywords: string[], opts?: SearchOpts): Promise<SearchHit[]>
}

export class NotImplementedError extends Error {
  constructor(kind: string) {
    super(`SearchAdapter kind '${kind}' not implemented in m2 — deferred to m4`)
  }
}
