import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { newsItems, newsEvidence } from '@/db/schema/prediction'
import { BadRequest, NotFound } from '@/lib/errors'

/**
 * Admin routes — 后台数据维护接口。
 *
 * 当前模块:
 *   news-items — 入库去重的库,可分页查询、按标题/URL 搜索、单条/批量删除
 *
 * 删除规则:
 *   - 若 news 有任何 news_evidence 引用,默认 409 拒绝(说明它被某条 prediction 引证)
 *   - 传 ?cascade=true 时,级联删 news_evidence(prediction 不会被删,但失去这条证据)
 *
 * 权限:目前所有登录用户都能访问;后续可加 ADMIN role 检查。
 */
type Vars = { auth: AuthContext }

export function adminRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  // ── news-items 列表 ─────────────────────────────────────────────────
  // GET /admin/news-items?q=&limit=&offset=&hasEvidence=true|false|all
  app.get('/news-items', authRequired(db), async (c) => {
    const q = c.req.query('q')?.trim()
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200)
    const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0
    const hasEvidence = c.req.query('hasEvidence') ?? 'all'

    const clauses = []
    if (q) {
      clauses.push(sql`(${newsItems.title} ILIKE ${'%' + q + '%'} OR ${newsItems.url} ILIKE ${'%' + q + '%'})`)
    }
    if (hasEvidence === 'true') {
      clauses.push(sql`EXISTS (SELECT 1 FROM news_evidence ne WHERE ne.news_id = ${newsItems.id})`)
    } else if (hasEvidence === 'false') {
      clauses.push(sql`NOT EXISTS (SELECT 1 FROM news_evidence ne WHERE ne.news_id = ${newsItems.id})`)
    }
    const where = clauses.length > 0 ? and(...clauses) : undefined

    const [countRow] = await db.select({ n: sql<number>`count(*)::int` })
      .from(newsItems)
      .where(where ?? sql`true`)
    const total = countRow?.n ?? 0

    const rows = await db.select({
      id: newsItems.id,
      url: newsItems.url,
      title: newsItems.title,
      sourceKind: newsItems.sourceKind,
      sourceLabel: newsItems.sourceLabel,
      summaryZh: newsItems.summaryZh,
      publishedAt: newsItems.publishedAt,
      fetchedAt: newsItems.fetchedAt,
      matchedRegions: newsItems.matchedRegions,
      evidenceCount: sql<number>`(SELECT COUNT(*)::int FROM news_evidence ne WHERE ne.news_id = ${newsItems.id})`.as('evidence_count'),
    })
      .from(newsItems)
      .where(where ?? sql`true`)
      .orderBy(desc(newsItems.fetchedAt))
      .limit(limit)
      .offset(offset)

    return c.json({ total, limit, offset, items: rows })
  })

  // ── 单条删除 ────────────────────────────────────────────────────────
  // DELETE /admin/news-items/:id?cascade=true|false
  app.delete('/news-items/:id', authRequired(db), async (c) => {
    const id = c.req.param('id')
    const cascade = c.req.query('cascade') === 'true'
    const [item] = await db.select().from(newsItems).where(eq(newsItems.id, id))
    if (!item) throw NotFound(`news item ${id} not found`)

    const evCountRow = (await db.select({ n: sql<number>`count(*)::int` })
      .from(newsEvidence).where(eq(newsEvidence.newsId, id)))[0]
    const evCount = evCountRow?.n ?? 0

    if (evCount > 0 && !cascade) {
      return c.json({
        error: { code: 'HAS_EVIDENCE', message: `news has ${evCount} evidence row(s); pass ?cascade=true to also delete them` },
        evidenceCount: evCount,
      }, 409)
    }

    await db.transaction(async (tx) => {
      if (evCount > 0) {
        await tx.delete(newsEvidence).where(eq(newsEvidence.newsId, id))
      }
      await tx.delete(newsItems).where(eq(newsItems.id, id))
    })
    return c.json({ ok: true, id, deletedEvidence: evCount })
  })

  // ── 批量删除 ────────────────────────────────────────────────────────
  // POST /admin/news-items/bulk-delete  { ids: string[], cascade?: boolean }
  const bulkSchema = z.object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    cascade: z.boolean().optional(),
  })
  app.post('/news-items/bulk-delete', authRequired(db),
    zValidator('json', bulkSchema),
    async (c) => {
      const { ids, cascade } = c.req.valid('json')
      const blockers = await db.select({
        newsId: newsEvidence.newsId,
        n: sql<number>`count(*)::int`,
      })
        .from(newsEvidence)
        .where(inArray(newsEvidence.newsId, ids))
        .groupBy(newsEvidence.newsId)

      if (blockers.length > 0 && !cascade) {
        return c.json({
          error: { code: 'HAS_EVIDENCE', message: `${blockers.length} item(s) have evidence rows; pass cascade=true to force` },
          blockers,
        }, 409)
      }

      const result = await db.transaction(async (tx) => {
        let deletedEv = 0
        if (cascade && blockers.length > 0) {
          const r = await tx.delete(newsEvidence).where(inArray(newsEvidence.newsId, ids)).returning({ id: newsEvidence.id })
          deletedEv = r.length
        }
        const delRows = await tx.delete(newsItems).where(inArray(newsItems.id, ids)).returning({ id: newsItems.id })
        return { deleted: delRows.length, deletedEvidence: deletedEv }
      })

      return c.json({ ok: true, ...result })
    },
  )

  // ── 清空所有(危险操作) ────────────────────────────────────────────
  // POST /admin/news-items/purge-all  { confirm: 'DELETE_ALL' }
  const purgeSchema = z.object({ confirm: z.literal('DELETE_ALL') })
  app.post('/news-items/purge-all', authRequired(db),
    zValidator('json', purgeSchema),
    async (c) => {
      const result = await db.transaction(async (tx) => {
        const ev = await tx.delete(newsEvidence).returning({ id: newsEvidence.id })
        const ni = await tx.delete(newsItems).returning({ id: newsItems.id })
        return { deletedEvidence: ev.length, deletedNews: ni.length }
      })
      return c.json({ ok: true, ...result })
    },
  )

  return app
}
