import { eq, sql } from 'drizzle-orm'
import { loadEnv } from '@/env'
import type { Db } from '@/db/client'
import { newsItems } from '@/db/schema/prediction'

export type GeocodeResult = {
  newsId: string
  matchedRegionIds: string[]
  strategy: 'amap' | 'rule-fallback'
}

/**
 * For a given news item, find Region rows it geographically matches.
 * Primary: AMAP geocode title/summary → coordinates → ST_Contains.
 * Fallback (no AMAP key): rule-based — news text contains region.name as substring.
 *
 * Updates news_items.matched_regions in place.
 */
export async function geocodeNews(db: Db, newsId: string): Promise<GeocodeResult> {
  const env = loadEnv()
  const [news] = await db.select().from(newsItems).where(eq(newsItems.id, newsId))
  if (!news) throw new Error(`news ${newsId} not found`)

  const text = `${news.title} ${news.summaryZh ?? news.rawSnippet ?? ''}`

  let matchedRegionIds: string[] = []
  let strategy: GeocodeResult['strategy']

  if (env.AMAP_GEOCODE_KEY) {
    matchedRegionIds = await amapGeocode(db, text, env.AMAP_GEOCODE_KEY)
    strategy = 'amap'
  } else {
    matchedRegionIds = await ruleFallback(db, text)
    strategy = 'rule-fallback'
  }

  // Persist
  await db.update(newsItems)
    .set({ matchedRegions: matchedRegionIds })
    .where(eq(newsItems.id, newsId))

  return { newsId, matchedRegionIds, strategy }
}

/** AMAP: ask geocode/geo for the place, get lon/lat, find regions via ST_Contains. */
async function amapGeocode(db: Db, text: string, key: string): Promise<string[]> {
  // Naive: pull the first 80 chars as candidate place name. Real impl m4 would use
  // entity extraction (LLM or jieba). For m2 we just send the title.
  const candidate = text.slice(0, 80)
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(candidate)}&output=json&key=${key}`
  let lon: number | null = null, lat: number | null = null
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as { geocodes?: Array<{ location?: string }> }
    const loc = data.geocodes?.[0]?.location
    if (loc) {
      const [lonStr, latStr] = loc.split(',')
      lon = Number.parseFloat(lonStr ?? '')
      lat = Number.parseFloat(latStr ?? '')
    }
  } catch (e) {
    console.error(`[geocoder] AMAP request failed:`, (e as Error).message)
    return []
  }
  if (lon === null || lat === null || Number.isNaN(lon) || Number.isNaN(lat)) return []

  // Find regions whose geom contains the point. Only consider current versions (effective_to IS NULL).
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM regions
    WHERE effective_to IS NULL
      AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
  `)
  return (rows as Array<{ id: string }>).map(r => r.id)
}

/** Rule fallback: substring match. */
async function ruleFallback(db: Db, text: string): Promise<string[]> {
  // Pull all current ADMIN_NAMED regions with non-null name; check substring.
  const rows = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM regions
    WHERE effective_to IS NULL AND kind = 'ADMIN_NAMED' AND name IS NOT NULL
  `)
  const matched: string[] = []
  for (const row of rows as Array<{ id: string; name: string }>) {
    if (row.name && text.includes(row.name)) matched.push(row.id)
  }
  return matched
}
