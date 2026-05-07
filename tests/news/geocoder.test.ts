import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { geocodeNews } from '@/news/geocoder'
import { newsItems } from '@/db/schema/prediction'
import { resetEnvCacheForTests } from '@/env'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[110, 20], [120, 20], [120, 30], [110, 30], [110, 20]]],
}

async function makeAdminRegion(db: typeof ctx.db, name: string): Promise<string> {
  const r = (await db.execute<{ id: string }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('ADMIN_NAMED', ${name}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id
  `))[0]!
  return r.id
}

async function makeNews(db: typeof ctx.db, title: string, summary: string): Promise<string> {
  const stamp = Date.now() + Math.random()
  const [n] = await db.insert(newsItems).values({
    url: `https://geo.example/${stamp}`,
    sourceKind: 'MAINSTREAM',
    sourceLabel: 'Test',
    title, summaryZh: summary,
    contentHash: `h-${stamp}`,
  }).returning()
  return n!.id
}

describe('geocodeNews — rule fallback', () => {
  beforeAll(() => {
    delete process.env.AMAP_GEOCODE_KEY
    process.env.AMAP_GEOCODE_KEY = ''
    resetEnvCacheForTests()
  })

  test('matches when news contains region name', async () => {
    const stamp = Date.now()
    const regionName = `测试粤西-${stamp}`
    const regionId = await makeAdminRegion(ctx.db, regionName)
    const newsId = await makeNews(ctx.db, `台风影响${regionName}沿海地区`, '相关详情')
    const r = await geocodeNews(ctx.db, newsId)
    expect(r.strategy).toBe('rule-fallback')
    expect(r.matchedRegionIds).toContain(regionId)

    // Verify persistence
    const [updated] = await ctx.db.select().from(newsItems).where(eq(newsItems.id, newsId))
    expect(updated!.matchedRegions).toContain(regionId)
  })

  test('returns empty when no name overlaps', async () => {
    const newsId = await makeNews(ctx.db, '完全不相关的新闻标题abcxyz', '与任何区域无关abcxyz')
    const r = await geocodeNews(ctx.db, newsId)
    expect(r.matchedRegionIds.length).toBe(0)
    expect(r.strategy).toBe('rule-fallback')
  })
})

describe('geocodeNews — AMAP path', () => {
  beforeAll(() => {
    process.env.AMAP_GEOCODE_KEY = 'fake-key-for-test'
    resetEnvCacheForTests()
  })
  afterAll(() => {
    delete process.env.AMAP_GEOCODE_KEY
    process.env.AMAP_GEOCODE_KEY = ''
    resetEnvCacheForTests()
  })

  test('AMAP returns coords → ST_Contains finds region', async () => {
    const stamp = Date.now()
    // Region polygon contains lon=115, lat=25 (within [110,120] x [20,30])
    const regionId = await makeAdminRegion(ctx.db, `amap-test-${stamp}`)
    const newsId = await makeNews(ctx.db, '茂名应急响应', '...')

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ geocodes: [{ location: '115.0,25.0' }] }),
    })) as unknown as typeof fetch
    try {
      const r = await geocodeNews(ctx.db, newsId)
      expect(r.strategy).toBe('amap')
      expect(r.matchedRegionIds).toContain(regionId)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('AMAP fetch failure returns empty array (no throw)', async () => {
    const stamp = Date.now()
    await makeAdminRegion(ctx.db, `amap-fail-${stamp}`)
    const newsId = await makeNews(ctx.db, '茂名应急', '...')

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    try {
      const r = await geocodeNews(ctx.db, newsId)
      expect(r.strategy).toBe('amap')
      expect(r.matchedRegionIds.length).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
