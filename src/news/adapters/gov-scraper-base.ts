import * as cheerio from 'cheerio'
import type { GovScraperKind, SearchAdapter, SearchHit, SearchOpts } from '../types'

/**
 * GovScraperBaseAdapter — abstract base for Chinese-government website scrapers
 * (Plan-D Task 12, A2-γ).
 *
 * Concrete subclasses (Tasks 13-15) supply: `key`, `kind`, `baseUrl`, `listSelector`,
 * and a `parser($)` hook that turns a cheerio root into `SearchHit[]`. The base
 * class enforces:
 *   - 1 request per minute per instance (gov-friendly rate limit).
 *   - robots.txt check with 24h cache (Disallow on path → returns []).
 *   - 15s fetch timeout.
 *   - Degraded-on-failure: any error / non-2xx / disallowed → `[]` (never throws).
 *   - Client-side query filter (gov sites have no native search API).
 */
export abstract class GovScraperBaseAdapter implements SearchAdapter {
  abstract readonly key: string
  abstract readonly kind: GovScraperKind

  protected abstract baseUrl: string
  protected abstract listSelector: string

  // 1 request / 60s / instance.
  protected lastFetch = 0
  protected readonly minIntervalMs = 60_000

  // robots.txt cache (24h TTL on success, 1h on transient error).
  protected robotsCache: { allowed: boolean; expiresAt: number } | null = null

  /** Per-site DOM parser. Receives a cheerio root, returns SearchHit[]. */
  protected abstract parser($: cheerio.CheerioAPI): SearchHit[]

  async query(keywords: string[], _opts: SearchOpts = {}): Promise<SearchHit[]> {
    const q = keywords.join(' ')

    // 1. Rate limit
    const now = Date.now()
    if (now - this.lastFetch < this.minIntervalMs) {
      console.warn(`[${this.key}] rate-limited (last fetch ${now - this.lastFetch}ms ago), returning empty`)
      return []
    }

    // 2. robots.txt check
    if (!(await this.respectRobots())) {
      console.warn(`[${this.key}] robots.txt forbids, returning empty`)
      return []
    }

    // 3. Fetch + parse
    try {
      this.lastFetch = now
      const res = await fetch(this.baseUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) {
        console.warn(`[${this.key}] HTTP ${res.status}, returning empty`)
        return []
      }
      const html = await res.text()
      const $ = cheerio.load(html)
      const hits = this.parser($)
      // Gov scrapers have no native search; filter client-side on title/snippet.
      return hits.filter(
        (h) => !q || (h.title?.includes(q) ?? false) || (h.snippet?.includes(q) ?? false),
      )
    } catch (e) {
      console.error(`[${this.key}] error: ${(e as Error).message}, returning empty`)
      return []
    }
  }

  protected async respectRobots(): Promise<boolean> {
    if (this.robotsCache && this.robotsCache.expiresAt > Date.now()) {
      return this.robotsCache.allowed
    }
    try {
      const robotsUrl = new URL('/robots.txt', this.baseUrl).toString()
      const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) {
        // No robots.txt → treat as allowed.
        this.robotsCache = { allowed: true, expiresAt: Date.now() + 24 * 3600_000 }
        return true
      }
      const txt = await res.text()
      // Simple Disallow check on the path of baseUrl. (RFC-correct parsing deferred.)
      const path = new URL(this.baseUrl).pathname
      const disallowed = txt.split('\n').some((line) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('Disallow:')) return false
        const disallowedPath = trimmed.split(':')[1]?.trim() || '/'
        return path.startsWith(disallowedPath)
      })
      this.robotsCache = { allowed: !disallowed, expiresAt: Date.now() + 24 * 3600_000 }
      return !disallowed
    } catch {
      // robots fetch errored → assume allowed but cache shorter (1h).
      this.robotsCache = { allowed: true, expiresAt: Date.now() + 1 * 3600_000 }
      return true
    }
  }
}
