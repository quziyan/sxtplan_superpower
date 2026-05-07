import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes } from '@/auth/routes'
import { regionRoutes } from '@/modules/region/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { taskcardRoutes } from '@/modules/taskcard/routes'
import { predictionRoutes } from '@/modules/prediction/routes'
import { webhookRoutes } from '@/webhook/routes'
import { AppError } from '@/lib/errors'
import type { Db } from '@/db/client'

export function buildTestApp(db: Db) {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
    }
    console.error(err)
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
  })
  app.route('/auth', authRoutes(db))
  app.route('/regions', regionRoutes(db))
  app.route('/taxonomy', taxonomyRoutes(db))
  app.route('/watchlists', watchlistRoutes(db))
  app.route('/taskcards', taskcardRoutes(db))
  app.route('/predictions', predictionRoutes(db))
  app.route('/webhook', webhookRoutes(db))
  return app
}
