import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import {
  getNewsFreshnessDays, setNewsFreshnessDays,
  getNewsRelevanceThreshold, setNewsRelevanceThreshold,
  getNewsMaxToRerank, setNewsMaxToRerank,
} from './service'

/**
 * Settings routes — 全局运行时配置。
 *
 *   GET /settings/news-freshness-days
 *   PUT /settings/news-freshness-days        { value: 1..365 }
 *   GET /settings/news-relevance-threshold
 *   PUT /settings/news-relevance-threshold   { value: 0..100 }
 *   GET /settings/news-max-to-rerank
 *   PUT /settings/news-max-to-rerank         { value: 1..100 }
 *
 * 任何登录用户都可读写(后续若需要,可加 roleRequired('ADMIN'))。
 */
type Vars = { auth: AuthContext }

const freshnessSchema = z.object({ value: z.number().int().min(1).max(365) })
const thresholdSchema = z.object({ value: z.number().int().min(0).max(100) })
const maxRerankSchema = z.object({ value: z.number().int().min(1).max(100) })

export function settingsRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  // ── freshness days ───────────────────────────────────────────────────
  app.get('/news-freshness-days', authRequired(db), async (c) => {
    return c.json({ value: await getNewsFreshnessDays(db) })
  })
  app.put('/news-freshness-days', authRequired(db),
    zValidator('json', freshnessSchema),
    async (c) => {
      const { value } = c.req.valid('json')
      await setNewsFreshnessDays(db, value)
      return c.json({ ok: true, value })
    },
  )

  // ── relevance threshold ──────────────────────────────────────────────
  app.get('/news-relevance-threshold', authRequired(db), async (c) => {
    return c.json({ value: await getNewsRelevanceThreshold(db) })
  })
  app.put('/news-relevance-threshold', authRequired(db),
    zValidator('json', thresholdSchema),
    async (c) => {
      const { value } = c.req.valid('json')
      await setNewsRelevanceThreshold(db, value)
      return c.json({ ok: true, value })
    },
  )

  // ── max to rerank ────────────────────────────────────────────────────
  app.get('/news-max-to-rerank', authRequired(db), async (c) => {
    return c.json({ value: await getNewsMaxToRerank(db) })
  })
  app.put('/news-max-to-rerank', authRequired(db),
    zValidator('json', maxRerankSchema),
    async (c) => {
      const { value } = c.req.valid('json')
      await setNewsMaxToRerank(db, value)
      return c.json({ ok: true, value })
    },
  )

  return app
}
