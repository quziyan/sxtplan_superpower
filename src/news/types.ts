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
}

export interface SearchAdapter {
  readonly kind: 'mock' | 'bing-news' | 'rss' | 'ddg' | 'aggregator'
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
