import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { newsItems } from '@/db/schema/prediction'

export type MatchCandidate = {
  predictionId: string
  reason: 'region+vehicle+task' | 'region+vehicle' | 'region+task' | 'region-only'
}

/**
 * For a given news item id, find candidate predictions to triage.
 *
 * Algorithm:
 * 1. Read news.matched_regions (from Task 13 geocoder)
 * 2. For each region, find PROPOSED predictions whose regionId is in that list and not expired
 * 3. Filter further: vehicle_classes.name OR task_classes.name appears as substring in news.title|summary
 * 4. Return ordered: V+T match first, then V or T alone, then region-only
 */
export async function findMatchingPredictions(db: Db, newsId: string): Promise<MatchCandidate[]> {
  const [news] = await db.select().from(newsItems).where(eq(newsItems.id, newsId))
  if (!news) throw new Error(`news ${newsId} not found`)

  const regionIds = news.matchedRegions as string[]
  if (regionIds.length === 0) return []

  const text = `${news.title} ${news.summaryZh ?? news.rawSnippet ?? ''}`

  // Pull all PROPOSED, non-expired predictions in matched regions, plus their V/T names
  const rows = await db.execute<{
    pred_id: string
    vehicle_name: string
    task_name: string
  }>(sql`
    SELECT p.id AS pred_id,
           v.name AS vehicle_name,
           t.name AS task_name
    FROM predictions p
    JOIN vehicle_classes v ON v.id = p.vehicle_class_id
    JOIN task_classes t ON t.id = p.task_class_id
    WHERE p.status = 'PROPOSED'
      AND p.expires_at > NOW()
      AND p.region_id = ANY(ARRAY[${sql.join(regionIds.map(id => sql`${id}::uuid`), sql`, `)}])
  `)

  const candidates: MatchCandidate[] = []
  for (const r of rows as Array<{ pred_id: string; vehicle_name: string; task_name: string }>) {
    const hasV = text.includes(r.vehicle_name)
    const hasT = text.includes(r.task_name)
    let reason: MatchCandidate['reason']
    if (hasV && hasT) reason = 'region+vehicle+task'
    else if (hasV) reason = 'region+vehicle'
    else if (hasT) reason = 'region+task'
    else reason = 'region-only'
    candidates.push({ predictionId: r.pred_id, reason })
  }
  // Sort: stronger matches first
  const order: MatchCandidate['reason'][] = ['region+vehicle+task', 'region+vehicle', 'region+task', 'region-only']
  candidates.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason))
  return candidates
}
