import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes } from '@/auth/routes'
import { regionRoutes } from '@/modules/region/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { taskcardRoutes } from '@/modules/taskcard/routes'
import { predictionRoutes } from '@/modules/prediction/routes'
import { retrospectiveRoutes } from '@/modules/retrospective/routes'
import { webhookRoutes } from '@/webhook/routes'
import { settingsRoutes } from '@/modules/settings/routes'
import { AppError } from '@/lib/errors'
import { getOssAdapter } from '@/media/oss-adapter-pool'
import type { Db } from '@/db/client'

const PLACEHOLDER_JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAA//9k=',
  'base64',
)

export function buildTestApp(db: Db) {
  const app = new Hono()
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode)
    }
    console.error(err)
    return c.json({ error: { code: 'INTERNAL', message: 'internal error' } }, 500)
  })
  app.get('/static/sim-media/:filename', (c) => {
    c.header('Content-Type', 'image/jpeg')
    return c.body(PLACEHOLDER_JPG)
  })
  app.get('/static/mock-oss/:key', async (c) => {
    const adapter = getOssAdapter()
    if (adapter.key !== 'mock') {
      return c.json({ error: 'mock OSS not active' }, 404)
    }
    const decodedKey = decodeURIComponent(c.req.param('key'))
    try {
      const stream = await adapter.getStream(decodedKey)
      c.header('Content-Type', 'image/jpeg')
      return c.body(stream as unknown as ReadableStream)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404)
    }
  })
  app.route('/auth', authRoutes(db))
  app.route('/regions', regionRoutes(db))
  app.route('/taxonomy', taxonomyRoutes(db))
  app.route('/watchlists', watchlistRoutes(db))
  app.route('/taskcards', taskcardRoutes(db))
  app.route('/predictions', predictionRoutes(db))
  app.route('/retrospectives', retrospectiveRoutes(db))
  app.route('/webhook', webhookRoutes(db))
  app.route('/settings', settingsRoutes(db))
  return app
}
