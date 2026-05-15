import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { createWatchList, getWatchList, listWatchLists, setWatchListActive, updateWatchListKeywords, updateWatchListName, deleteWatchList } from './service'
import { predictions } from '@/db/schema/prediction'
import { NotFound } from '@/lib/errors'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { deriveKeywordsForWatchlist, resolveKeywords } from '@/news/keyword-derive'

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  // Plan-PP fix:V/T/R/regionVersion 全部可选;不传走「通用」兜底
  vehicleClassId: z.string().uuid().optional(),
  taskClassId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  regionVersion: z.number().int().positive().optional(),
  kRangeMin: z.number().int().positive().optional(),
  kRangeMax: z.number().int().positive().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
})

const setActiveSchema = z.object({ isActive: z.boolean() })

const updateKeywordsSchema = z.object({ keywords: z.array(z.string().min(1).max(60)).max(20) })

type Vars = { auth: AuthContext }

export function watchlistRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.get('/', authRequired(db), async (c) => {
    const activeOnly = c.req.query('active') === 'true'
    return c.json(await listWatchLists(db, { activeOnly }))
  })

  app.post('/', authRequired(db), zValidator('json', createSchema), async (c) => {
    const auth = c.get('auth')
    const body = c.req.valid('json')
    const input: import('./service').CreateWatchListInput = {
      name: body.name,
      createdBy: auth.user.id,
    }
    if (body.vehicleClassId !== undefined) input.vehicleClassId = body.vehicleClassId
    if (body.taskClassId !== undefined) input.taskClassId = body.taskClassId
    if (body.regionId !== undefined) input.regionId = body.regionId
    if (body.regionVersion !== undefined) input.regionVersion = body.regionVersion
    if (body.description !== undefined) input.description = body.description
    if (body.kRangeMin !== undefined) input.kRangeMin = body.kRangeMin
    if (body.kRangeMax !== undefined) input.kRangeMax = body.kRangeMax
    if (body.keywords !== undefined) input.keywords = body.keywords
    const wl = await createWatchList(db, input)
    return c.json(wl, 201)
  })

  app.get('/:id', authRequired(db), async (c) => {
    const wl = await getWatchList(db, c.req.param('id'))
    if (!wl) throw NotFound(`watchlist ${c.req.param('id')} not found`)
    return c.json(wl)
  })

  app.patch('/:id/active', authRequired(db), zValidator('json', setActiveSchema), async (c) => {
    const wl = await setWatchListActive(db, c.req.param('id'), c.req.valid('json').isActive)
    return c.json(wl)
  })

  // Plan-PP follow-up:更新 watchlist 名(inline 编辑)
  app.patch('/:id/name', authRequired(db),
    zValidator('json', z.object({ name: z.string().min(1).max(100) })),
    async (c) => {
      try {
        const wl = await updateWatchListName(db, { id: c.req.param('id'), name: c.req.valid('json').name })
        return c.json(wl)
      } catch (e) {
        if ((e as Error).message.includes('not found')) throw NotFound(`watchlist ${c.req.param('id')} not found`)
        throw e
      }
    },
  )

  // Plan-PP follow-up:删除 watchlist。若有 prediction 引用(sourceId=wl.id),
  // 默认 409 拒绝(说明这个 wl 已经产生了预测,删除会留下"无源"预测)。
  // 传 ?cascade=true 时,把这些 prediction 的 sourceId 不动(predictions 不被
  // 自动删,管理员去 admin 后台单独清理)— 这里只删 watchlist 本身。
  app.delete('/:id', authRequired(db), async (c) => {
    const id = c.req.param('id')
    const cascade = c.req.query('cascade') === 'true'
    const wl = await getWatchList(db, id)
    if (!wl) throw NotFound(`watchlist ${id} not found`)
    const predCountRow = (await db.select({ n: sql<number>`count(*)::int` })
      .from(predictions).where(eq(predictions.sourceId, id)))[0]
    const predCount = predCountRow?.n ?? 0
    if (predCount > 0 && !cascade) {
      return c.json({
        error: { code: 'HAS_PREDICTIONS', message: `watchlist 有 ${predCount} 条 prediction 引用;传 ?cascade=true 强删(predictions 保留)` },
        predictionCount: predCount,
      }, 409)
    }
    await deleteWatchList(db, id)
    return c.json({ ok: true, id, predictionCount: predCount })
  })

  app.patch('/:id/keywords', authRequired(db), zValidator('json', updateKeywordsSchema), async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')
    try {
      const wl = await updateWatchListKeywords(db, { id, keywords: body.keywords })
      return c.json(wl)
    } catch (e) {
      if ((e as Error).message.includes('not found')) throw NotFound(`watchlist ${id} not found`)
      throw e
    }
  })

  // Plan-PP follow-up:返回该 watchlist 实际会用的 keywords —— 若 explicit 非空
  // 直接返;否则返 V/T/region 派生的 fallback。前端用来:
  //  (a) 展示「当前实际搜索关键词」,即便 explicit 为空
  //  (b) 一键把 derived 保存为 explicit
  app.get('/:id/resolved-keywords', authRequired(db), async (c) => {
    const id = c.req.param('id')
    const wl = await getWatchList(db, id)
    if (!wl) throw NotFound(`watchlist ${id} not found`)
    const [vc] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.id, wl.vehicleClassId))
    const [tc] = await db.select().from(taskClasses).where(eq(taskClasses.id, wl.taskClassId))
    if (!vc || !tc) throw NotFound(`watchlist ${id}: V/T row missing`)
    const regRows = await db.execute<{ name: string | null }>(sql`
      SELECT name FROM regions WHERE id = ${wl.regionId}::uuid AND version = ${wl.regionVersion} LIMIT 1
    `)
    const region = (regRows as unknown as Array<{ name: string | null }>)[0] ?? { name: null }
    const explicit = (wl.keywords ?? []).filter((k) => k.trim().length > 0)
    const derived = deriveKeywordsForWatchlist(wl, vc, tc, region)
    const resolved = resolveKeywords(wl, vc, tc, region)
    return c.json({
      explicit,
      derived,
      resolved,
      source: explicit.length > 0 ? 'explicit' as const : 'derived' as const,
    })
  })

  return app
}
