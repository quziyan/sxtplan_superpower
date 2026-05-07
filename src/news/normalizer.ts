import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsItems, type NewsItem } from '@/db/schema/prediction'
import type { SearchHit } from './types'

const SOURCE_KIND_MAP = {
  mainstream: 'MAINSTREAM',
  gov: 'GOV',
  social: 'SOCIAL',
  foreign: 'FOREIGN',
} as const

export async function ingestHit(db: Db, hit: SearchHit): Promise<{ news: NewsItem; isNew: boolean }> {
  // Dedup by URL (column has unique constraint)
  const [existing] = await db.select().from(newsItems).where(eq(newsItems.url, hit.url))
  if (existing) return { news: existing, isNew: false }

  const contentHash = createHash('sha256').update(hit.url + hit.title + hit.snippet).digest('hex')
  const summary = hit.snippet.slice(0, 280)

  const [created] = await db.insert(newsItems).values({
    url: hit.url,
    sourceKind: SOURCE_KIND_MAP[hit.source.kind],
    sourceLabel: hit.source.name,
    title: hit.title,
    summaryZh: summary,
    ...(hit.publishedAt ? { publishedAt: new Date(hit.publishedAt) } : {}),
    contentHash,
    rawSnippet: hit.snippet,
  }).returning()
  return { news: created!, isNew: true }
}
