import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { watchLists } from '@/db/schema/watchlist'
import { createTestDb } from '../../helpers/test-db'
import {
  tickNewsIngest,
  type NewsTriageQueueLike,
} from '@/scheduler/workers/news-ingest'

/**
 * The schema has no per-test data isolation, so prior test runs may have
 * leaked active watchlists into the db. tickNewsIngest scans ALL active
 * watchlists, which (a) blows out the per-call adapter budget for our
 * fakeAdapter and (b) lets a leaked watchlist swallow our test news (since
 * `ingestHit` is URL-keyed, the first watchlist to process a given URL
 * stamps `matched_regions` and the rest skip as duplicates). Deactivating
 * everything pre-test gives each test a clean slate without dropping rows
 * that other suites might still be inspecting.
 */
async function deactivateAllWatchlists(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
): Promise<void> {
  await db.execute(sql`UPDATE watch_lists SET is_active = FALSE`)
}

async function seedWatchlistAndPrediction(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  opts: { withKeywords?: string[] },
): Promise<{
  watchlistId: string
  predictionId: string
  regionId: string
  vName: string
  tName: string
}> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const userId = crypto.randomUUID()
  // Plan-M:fixture 名称要带 CJK 字符,否则 filterHits 的中文规则会丢弃
  // 从 fakeAdapter 返回的 title(因为 title 内嵌 vName/tName)。同时缓解
  // 长期 fixture 污染问题:V/T 表里塞英文字串。
  const vName = `测试车型 ${stamp}`
  const tName = `测试任务 ${stamp}`

  // regions row uses raw SQL because of PostGIS ST_GeomFromGeoJSON.
  const regionRows = await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions(version, kind, name, geom, effective_from)
    VALUES(
      1, 'AD_HOC', ${'NI_REG_' + stamp},
      ST_GeomFromGeoJSON(${'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'}),
      NOW()
    )
    RETURNING id, version
  `)
  const region = (regionRows as unknown as Array<{ id: string; version: number }>)[0]!

  const [vc] = await db
    .insert(vehicleClasses)
    .values({ name: vName, level: 1 })
    .returning()
  const [tc] = await db
    .insert(taskClasses)
    .values({ name: tName, level: 1 })
    .returning()

  await db.execute(sql`
    INSERT INTO users(id, email, password_hash, display_name)
    VALUES(${userId}::uuid, ${'ni-' + stamp + '@x.com'}, 'x', 'NI')
    ON CONFLICT DO NOTHING
  `)

  const [wl] = await db
    .insert(watchLists)
    .values({
      name: `NI ${stamp}`,
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      regionId: region.id,
      regionVersion: region.version,
      kRangeMin: 1,
      kRangeMax: 14,
      isActive: true,
      keywords: opts.withKeywords ?? [],
      createdBy: userId,
    })
    .returning()

  const [pred] = await db
    .insert(predictions)
    .values({
      sourceKind: 'WATCHLIST',
      sourceId: wl!.id,
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      regionId: region.id,
      regionVersion: region.version,
      windowDate: new Date('2026-12-31'),
      windowHalf: 'AM',
      kDays: 7,
      cadenceMinutes: 60,
      confidenceNow: 50,
      status: 'PROPOSED',
      expiresAt: new Date(Date.now() + 86400_000),
    })
    .returning()

  return {
    watchlistId: wl!.id,
    predictionId: pred!.id,
    regionId: region.id,
    vName,
    tName,
  }
}

describe('tickNewsIngest', () => {
  test('1 watchlist + adapter returns 2 news → 2 news_items inserted + matcher finds candidates', async () => {
    const ctx = await createTestDb()
    try {
      await deactivateAllWatchlists(ctx.db)
      const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      const seeded = await seedWatchlistAndPrediction(ctx.db, {
        withKeywords: ['ingest-test-' + stamp],
      })

      const triageQ: NewsTriageQueueLike = { add: async () => undefined }
      // 问题 #1 反向流:news-ingest 现在 enqueue 到 extractQueue。
      const extractCalls: Array<{ newsId: string }> = []
      const extractQ = { add: async (_: string, d: { newsId: string }) => { extractCalls.push(d); return undefined } }

      const fakeAdapter = {
        query: async () => [
          {
            title: `${seeded.vName} ${seeded.tName} 1 ${stamp}`,
            url: `https://example.test/1?t=${stamp}_a`,
            snippet: 's1',
            source: { name: 'example.test', kind: 'mainstream' as const },
          },
          {
            title: `${seeded.vName} ${seeded.tName} 2 ${stamp}`,
            url: `https://example.test/2?t=${stamp}_b`,
            snippet: 's2',
            source: { name: 'example.test', kind: 'mainstream' as const },
          },
        ],
      }

      const r = await tickNewsIngest({
        db: ctx.db,
        triageQueue: triageQ,
        extractQueue: extractQ,
        searchAdapter: fakeAdapter,
        skipRerank: true,
      })
      expect(r.newsFetched).toBeGreaterThanOrEqual(2)
      expect(r.newsInserted).toBeGreaterThanOrEqual(2)
      // 每条 ingest'd news 都入 extract 队列(>= 2 条 newsId)
      expect(extractCalls.length).toBeGreaterThanOrEqual(2)
    } finally {
      await ctx.cleanup()
    }
  })

  test('idempotent: same URL fetched twice → no duplicate news_items', async () => {
    const ctx = await createTestDb()
    try {
      await deactivateAllWatchlists(ctx.db)
      await seedWatchlistAndPrediction(ctx.db, { withKeywords: ['x'] })

      const triageQ: NewsTriageQueueLike = { add: async () => undefined }
      const url = `https://dedup.test/${Date.now()}-${Math.random()}`
      const fakeAdapter = {
        query: async () => [
          {
            title: '去重测试新闻',  // CJK 必需(filterHits 中文规则)
            url,
            snippet: '广州',
            source: { name: 'dedup.test', kind: 'mainstream' as const },
          },
        ],
      }

      const r1 = await tickNewsIngest({
        db: ctx.db,
        triageQueue: triageQ,
        searchAdapter: fakeAdapter,
        skipRerank: true,
      })
      expect(r1.newsInserted).toBeGreaterThanOrEqual(1)

      // Re-fetch the same URL — UNIQUE constraint should reject the dup.
      await tickNewsIngest({
        db: ctx.db,
        triageQueue: triageQ,
        searchAdapter: fakeAdapter,
        skipRerank: true,
      })

      const dups = await ctx.db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM news_items WHERE url = ${url}
      `)
      const dupRows = dups as unknown as Array<{ n: number }>
      expect(dupRows[0]!.n).toBe(1)
    } finally {
      await ctx.cleanup()
    }
  })

  test('failure isolation: adapter throws on watchlist A → other watchlists still process', async () => {
    const ctx = await createTestDb()
    try {
      await deactivateAllWatchlists(ctx.db)
      const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      await seedWatchlistAndPrediction(ctx.db, {
        withKeywords: ['kw-A-' + stamp],
      })
      await seedWatchlistAndPrediction(ctx.db, {
        withKeywords: ['kw-B-' + stamp],
      })

      let callIdx = 0
      const fakeAdapter = {
        query: async () => {
          callIdx++
          if (callIdx === 1) throw new Error('synthetic adapter failure')
          return [
            {
              title: '广州警方B类新闻',  // CJK 必需
              url: `https://b.test/${Date.now()}-${Math.random()}`,
              snippet: '',
              source: { name: 'b.test', kind: 'mainstream' as const },
            },
          ]
        },
      }
      const triageQ: NewsTriageQueueLike = { add: async () => undefined }

      const r = await tickNewsIngest({
        db: ctx.db,
        triageQueue: triageQ,
        searchAdapter: fakeAdapter,
        skipRerank: true,
      })
      expect(r.errors).toBeGreaterThanOrEqual(1)
      expect(r.newsInserted).toBeGreaterThanOrEqual(1)
    } finally {
      await ctx.cleanup()
    }
  })

  test('keywords 显式 vs 派生 fallback: 空 keywords → 用 V/T/region 名', async () => {
    const ctx = await createTestDb()
    try {
      await deactivateAllWatchlists(ctx.db)
      const seeded = await seedWatchlistAndPrediction(ctx.db, {
        withKeywords: [],
      })
      const queryArgs: string[][] = []
      const fakeAdapter = {
        query: async (kw: string[]) => {
          queryArgs.push(kw)
          return []
        },
      }
      const triageQ: NewsTriageQueueLike = { add: async () => undefined }

      await tickNewsIngest({
        db: ctx.db,
        triageQueue: triageQ,
        searchAdapter: fakeAdapter,
        skipRerank: true,
      })

      // The watchlist we seeded with empty keywords should have V (NIVehicle…)
      // and T (NITask…) appear in the derived keywords.
      const myArgs = queryArgs.find((kw) => kw.includes(seeded.vName))
      expect(myArgs).toBeDefined()
      expect(myArgs!).toContain(seeded.tName)
    } finally {
      await ctx.cleanup()
    }
  })

  // 时效窗口防御性过滤:NEWS_FRESHNESS_DAYS=30 时,publishedAt 早于 30 天前的命中应被丢弃。
  // null/undefined publishedAt 视为新鲜(graceful — 大量中文站缺失发布日期元数据)。
  test('freshness filter: publishedAt 早于 NEWS_FRESHNESS_DAYS 的命中被丢弃', async () => {
    const ctx = await createTestDb()
    try {
      await deactivateAllWatchlists(ctx.db)
      const stamp = `fresh-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      const seeded = await seedWatchlistAndPrediction(ctx.db, {
        withKeywords: ['fresh-test-' + stamp],
      })

      const triageQ: NewsTriageQueueLike = { add: async () => undefined }

      const now = Date.now()
      const oneYearAgo = new Date(now - 365 * 86_400_000).toISOString()
      const fiveDaysAgo = new Date(now - 5 * 86_400_000).toISOString()
      const fakeAdapter = {
        query: async () => [
          // 早于 30 天 — 应丢
          {
            title: `${seeded.vName} 老新闻 ${stamp}`,
            url: `https://stale.test/old?t=${stamp}`,
            snippet: 'old', publishedAt: oneYearAgo,
            source: { name: 'stale.test', kind: 'mainstream' as const },
          },
          // 5 天前 — 应留
          {
            title: `${seeded.vName} 新新闻 ${stamp}`,
            url: `https://fresh.test/new?t=${stamp}`,
            snippet: 'new', publishedAt: fiveDaysAgo,
            source: { name: 'fresh.test', kind: 'mainstream' as const },
          },
          // 缺日期 — graceful 留(server-side `days` 过滤已经过一遍)
          {
            title: `${seeded.vName} 无日期 ${stamp}`,
            url: `https://nopub.test/x?t=${stamp}`,
            snippet: 'no date',
            source: { name: 'nopub.test', kind: 'mainstream' as const },
          },
        ],
      }

      const r = await tickNewsIngest({
        db: ctx.db, triageQueue: triageQ, searchAdapter: fakeAdapter,
        skipRerank: true,
      })
      // 3 fetched(adapter raw count),但只 2 应该被 insert(老的丢)
      expect(r.newsFetched).toBe(3)
      expect(r.newsInserted).toBe(2)
    } finally {
      await ctx.cleanup()
    }
  })
})
