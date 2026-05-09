import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { getNewsFreshnessDays, setNewsFreshnessDays } from './service'

/**
 * Settings routes — 单一全局运行时配置。
 *
 *   GET /settings/news-freshness-days   → { value: number }      (DB 或 env fallback)
 *   PUT /settings/news-freshness-days   { value: 1..365 } → 200  | 400 越界
 *
 * 任何登录用户都可读写(后续若需要,可加 roleRequired('ADMIN'))。
 */
type Vars = { auth: AuthContext }

const putSchema = z.object({ value: z.number().int().min(1).max(365) })

export function settingsRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.get('/news-freshness-days', authRequired(db), async (c) => {
    const value = await getNewsFreshnessDays(db)
    return c.json({ value })
  })

  app.put(
    '/news-freshness-days',
    authRequired(db),
    zValidator('json', putSchema),
    async (c) => {
      const { value } = c.req.valid('json')
      await setNewsFreshnessDays(db, value)
      return c.json({ ok: true, value })
    },
  )

  return app
}
