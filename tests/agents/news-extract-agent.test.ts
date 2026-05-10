import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { hashPassword } from '@/auth/password'
import { roles, userRoles, users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { watchLists } from '@/db/schema/watchlist'
import { confidenceSnapshots, newsEvidence, newsItems, predictions } from '@/db/schema/prediction'
import { runNewsExtractAgent, createPredictionFromNews } from '@/agents/news-extract-agent'
import { createTestDb } from '../helpers/test-db'
import type { infer as inferFnType } from '@/inference/client'

let ctx: Awaited<ReturnType<typeof createTestDb>>

const poly = { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]] }

async function deactivateAllWatchlists(db: typeof ctx.db) {
  await db.execute(sql`UPDATE watch_lists SET is_active = FALSE`)
}

async function seedWatchlist(label: string): Promise<{ wlId: string; userId: string }> {
  const stamp = `extract-${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const reg = (await ctx.db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${'extract-region-' + stamp}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [v] = await ctx.db.insert(vehicleClasses).values({ name: '测试治安车' + stamp, level: 1 }).returning()
  const [t] = await ctx.db.insert(taskClasses).values({ name: '测试巡逻任务' + stamp, level: 1 }).returning()
  const userId = crypto.randomUUID()
  await ctx.db.execute(sql`
    INSERT INTO users(id, email, password_hash, display_name)
    VALUES(${userId}::uuid, ${'extract-' + stamp + '@x'}, ${await hashPassword('p')}, '测试')
  `)
  const [wl] = await ctx.db.insert(watchLists).values({
    name: '测试 watchlist ' + stamp,
    vehicleClassId: v!.id, taskClassId: t!.id,
    regionId: reg.id, regionVersion: reg.version,
    kRangeMin: 1, kRangeMax: 14,
    isActive: true,
    keywords: ['kw'],
    createdBy: userId,
  }).returning()
  return { wlId: wl!.id, userId }
}

async function seedNews(label: string): Promise<string> {
  const stamp = `news-${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  const [news] = await ctx.db.insert(newsItems).values({
    url: `https://test.example/${stamp}`,
    title: '广州警方启动五一治安巡逻专项行动',
    sourceLabel: '广东省人民政府',
    sourceKind: 'GOV',
    summaryZh: '广州市公安局启动五一假期治安巡逻专项行动,部署多地警力。',
    contentHash: stamp,
  }).returning()
  return news!.id
}

beforeAll(async () => {
  ctx = await createTestDb()
})

afterAll(async () => { await ctx.cleanup() })

describe('news-extract agent — happy path + fallback', () => {
  test('LLM 输出 1 个 actionable → 创建 1 个 prediction + evidence + snapshot', async () => {
    await deactivateAllWatchlists(ctx.db)
    const { wlId } = await seedWatchlist('happy')
    const newsId = await seedNews('happy')

    const fakeInfer: typeof inferFnType = async () => ({
      text: JSON.stringify({
        extracted: [{
          watchlistId: wlId,
          windowDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
          windowHalf: 'AM',
          confidence: 78,
          reasoning: '新闻明确报道五一假期治安巡逻部署,高度匹配该 watchlist',
        }],
      }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })

    const r = await runNewsExtractAgent(ctx.db, { newsId, inferFn: fakeInfer })
    expect(r.created).toBe(1)
    expect(r.llmDegraded).toBe(false)

    // 验证 prediction 真创建
    const preds = await ctx.db.select().from(predictions).where(eq(predictions.sourceId, wlId))
    expect(preds.length).toBe(1)
    expect(preds[0]!.confidenceNow).toBe(78)

    // 验证 news_evidence 链了
    const ev = await ctx.db.select().from(newsEvidence).where(eq(newsEvidence.predictionId, preds[0]!.id))
    expect(ev.length).toBe(1)
    expect(ev[0]!.weight).toBe('HIGH')
    expect(ev[0]!.cited).toBe(true)
    expect(ev[0]!.newsId).toBe(newsId)

    // 验证 confidence_snapshot 写了
    const snaps = await ctx.db.select().from(confidenceSnapshots).where(eq(confidenceSnapshots.predictionId, preds[0]!.id))
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.confidence).toBe(78)
    expect(snaps[0]!.operator).toBe('NewsExtract')
    expect(snaps[0]!.evidenceIds).toEqual([newsId])
  })

  test('LLM 输出空 extracted → 不创建任何 prediction', async () => {
    await deactivateAllWatchlists(ctx.db)
    await seedWatchlist('empty')
    const newsId = await seedNews('empty')

    const fakeInfer: typeof inferFnType = async () => ({
      text: JSON.stringify({ extracted: [] }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })

    const r = await runNewsExtractAgent(ctx.db, { newsId, inferFn: fakeInfer })
    expect(r.created).toBe(0)
    expect(r.llmDegraded).toBe(false)
  })

  test('LLM 调用失败 → degraded fallback,created=0,不抛', async () => {
    await deactivateAllWatchlists(ctx.db)
    await seedWatchlist('fail')
    const newsId = await seedNews('fail')

    const failInfer: typeof inferFnType = async () => { throw new Error('LLM down') }
    const r = await runNewsExtractAgent(ctx.db, { newsId, inferFn: failInfer })
    expect(r.created).toBe(0)
    expect(r.llmDegraded).toBe(true)
  })

  test('LLM 引用不存在的 watchlistId → skip + 警告,不抛', async () => {
    await deactivateAllWatchlists(ctx.db)
    await seedWatchlist('unknown')
    const newsId = await seedNews('unknown')

    const fakeInfer: typeof inferFnType = async () => ({
      text: JSON.stringify({
        extracted: [{
          watchlistId: '00000000-0000-0000-0000-000000000000',  // 假 UUID
          windowDate: '2026-12-31',
          windowHalf: 'AM',
          confidence: 50,
          reasoning: '引用不存在的 watchlist',
        }],
      }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })

    const r = await runNewsExtractAgent(ctx.db, { newsId, inferFn: fakeInfer })
    expect(r.created).toBe(0)
    expect(r.llmDegraded).toBe(false)
  })

  test('幂等:同一 (watchlist, windowDate, windowHalf) 二次提取 → 不重建,只追加证据 + snapshot', async () => {
    await deactivateAllWatchlists(ctx.db)
    const { wlId } = await seedWatchlist('idempotent')
    const newsId1 = await seedNews('idem-1')
    const newsId2 = await seedNews('idem-2')

    const winDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    const makeFake = (newsId: string, conf: number): typeof inferFnType => async () => ({
      text: JSON.stringify({
        extracted: [{
          watchlistId: wlId, windowDate: winDate, windowHalf: 'AM',
          confidence: conf, reasoning: 'reasoning ' + newsId,
        }],
      }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })

    await runNewsExtractAgent(ctx.db, { newsId: newsId1, inferFn: makeFake(newsId1, 60) })
    await runNewsExtractAgent(ctx.db, { newsId: newsId2, inferFn: makeFake(newsId2, 80) })

    // prediction 仍是 1 行(幂等),confidence 提升到 max(60, 80) = 80
    const preds = await ctx.db.select().from(predictions).where(eq(predictions.sourceId, wlId))
    expect(preds.length).toBe(1)
    expect(preds[0]!.confidenceNow).toBe(80)

    // evidence 累计到 2 条
    const ev = await ctx.db.select().from(newsEvidence).where(eq(newsEvidence.predictionId, preds[0]!.id))
    expect(ev.length).toBe(2)
    // snapshots 也 2 条(每次提取写一个)
    const snaps = await ctx.db.select().from(confidenceSnapshots).where(eq(confidenceSnapshots.predictionId, preds[0]!.id))
    expect(snaps.length).toBe(2)
  })
})

describe('createPredictionFromNews — direct service test', () => {
  test('原子写 prediction + evidence + snapshot 三表', async () => {
    await deactivateAllWatchlists(ctx.db)
    const { wlId } = await seedWatchlist('direct')
    const newsId = await seedNews('direct')

    const [wl] = await ctx.db.select().from(watchLists).where(eq(watchLists.id, wlId))
    const wd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

    await createPredictionFromNews(ctx.db, {
      newsId, watchlist: wl!,
      windowDate: wd, windowHalf: 'PM',
      confidence: 65, reasoning: '直接 service 测试',
    })

    const preds = await ctx.db.select().from(predictions).where(eq(predictions.sourceId, wlId))
    expect(preds.length).toBe(1)
    expect(preds[0]!.windowHalf).toBe('PM')
    expect(preds[0]!.confidenceNow).toBe(65)
  })
})
