import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes } from '@/auth/routes'
import { regionRoutes } from '@/modules/region/routes'
import { taxonomyRoutes } from '@/modules/taxonomy/routes'
import { watchlistRoutes } from '@/modules/watchlist/routes'
import { taskcardRoutes } from '@/modules/taskcard/routes'
import { predictionRoutes } from '@/modules/prediction/routes'
import { retrospectiveRoutes } from '@/modules/retrospective/routes'
import { webhookRoutes } from '@/webhook/routes'
import { demoRoutes } from '@/__demo/routes'
import { createDb } from '@/db/client'
import { loadEnv } from '@/env'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { getOssAdapter } from '@/media/oss-adapter-pool'

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

// Static dev endpoint serving placeholder JPG bytes for simulated media URLs.
// Used by SimulatedGuangzhouPoliceCamAdapter and similar in-process simulators
// that emit fake media URLs the MediaFetcher must dereference.
const PLACEHOLDER_JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAA//9k=',
  'base64',
)

app.get('/static/sim-media/:filename', (c) => {
  c.header('Content-Type', 'image/jpeg')
  return c.body(PLACEHOLDER_JPG)
})

// Static dev endpoint backing MockOssAdapter.signedUrl. Only active when
// OSS_ADAPTER_KEY=mock — production aliyun config gets a 404 so a stray
// request can't accidentally probe internal storage layout.
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

// Plan-C T37 / Slice 0 — customer demo helpers. Mounted only outside
// production so a misconfigured prod deploy can't expose `/__demo/*`.
// See `src/__demo/routes.ts` for the route docs.
if (env.NODE_ENV !== 'production') {
  app.route('/__demo', demoRoutes(db))
  logger.info('demo routes mounted', { path: '/__demo' })
}

logger.info('server starting', { port: env.PORT })

export default { port: env.PORT, fetch: app.fetch }
