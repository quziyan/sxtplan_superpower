import type { WatchList } from '@/db/schema/watchlist'
import type { VehicleClass, TaskClass } from '@/db/schema/taxonomy'

export type RegionLabel = { name: string | null }

/**
 * Derive keywords for a watchlist when its `keywords` array is empty.
 * Returns a deduplicated, non-empty-string list built from V/T/region names.
 *
 * Order:
 *  1. Vehicle class name
 *  2. Task class name
 *  3. Region name (if present)
 */
export function deriveKeywordsForWatchlist(
  _wl: WatchList,
  vc: VehicleClass,
  tc: TaskClass,
  region: RegionLabel,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (s: string | null | undefined): void => {
    if (!s) return
    const t = s.trim()
    if (!t) return
    if (seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  push(vc.name)
  push(tc.name)
  push(region.name)
  return out
}

/**
 * Resolve keywords: explicit (non-empty) overrides derived.
 */
export function resolveKeywords(
  wl: WatchList,
  vc: VehicleClass,
  tc: TaskClass,
  region: RegionLabel,
): string[] {
  if (Array.isArray(wl.keywords) && wl.keywords.length > 0) {
    return wl.keywords.filter((k) => k.trim().length > 0)
  }
  return deriveKeywordsForWatchlist(wl, vc, tc, region)
}
