import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes } from '@/auth/routes'
import { regionRoutes } from '@/modules/region/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { taskcardRoutes } from '@/modules/taskcard/routes'
import { predictionRoutes } from '@/modules/prediction/routes'
import { webhookRoutes } from '@/webhook/routes'
import { createDb } from '@/db/client'
import { loadEnv } from '@/env'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'

const env = loadEnv()
const { db } = createDb('app')

const app = new Hono()

app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  logger.info('request', { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start })
})

app.use('*', cors({
  origin: env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
  credentials: true,
}))

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
  }
  logger.error('unhandled', { err: err.message, stack: err.stack })
  return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

app.route('/auth', authRoutes(db))
app.route('/regions', regionRoutes(db))
app.route('/taxonomy', taxonomyRoutes(db))
app.route('/watchlists', watchlistRoutes(db))
app.route('/taskcards', taskcardRoutes(db))
app.route('/predictions', predictionRoutes(db))
app.route('/webhook', webhookRoutes(db))

logger.info('server starting', { port: env.PORT })

export default { port: env.PORT, fetch: app.fetch }
