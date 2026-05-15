import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
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
import { adminRoutes } from '@/modules/admin/routes'
import { demoRoutes } from '@/__demo/routes'
import { createDb } from '@/db/client'
import { loadEnv } from '@/env'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { getOssAdapter } from '@/media/oss-adapter-pool'

const env = loadEnv()
const { db } = createDb('app')

// Plan-PP docker:全部 API 路由挂在 `/api/*` 下,根路径用静态文件兜底服务前端 SPA。
// 这样单容器即可同时跑后端 + 前端,前端 `BASE='/api'` 与生产路径一致。
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

const api = new Hono()

api.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

const PLACEHOLDER_JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAA//9k=',
  'base64',
)

api.get('/static/sim-media/:filename', (c) => {
  c.header('Content-Type', 'image/jpeg')
  return c.body(PLACEHOLDER_JPG)
})

api.get('/static/mock-oss/:key', async (c) => {
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

api.route('/auth', authRoutes(db))
api.route('/regions', regionRoutes(db))
api.route('/taxonomy', taxonomyRoutes(db))
api.route('/watchlists', watchlistRoutes(db))
api.route('/taskcards', taskcardRoutes(db))
api.route('/predictions', predictionRoutes(db))
api.route('/retrospectives', retrospectiveRoutes(db))
api.route('/webhook', webhookRoutes(db))
api.route('/settings', settingsRoutes(db))
api.route('/admin', adminRoutes(db))

const debugRoutesEnabled = env.NODE_ENV !== 'production' && process.env.DEBUG_ROUTES === 'true'
if (debugRoutesEnabled) {
  api.route('/__demo', demoRoutes(db))
  logger.info('demo routes mounted (DEBUG_ROUTES=true)', { path: '/api/__demo' })
} else {
  logger.info('demo routes NOT mounted (set DEBUG_ROUTES=true to enable in dev)')
}

// API namespace 挂载
app.route('/api', api)

// Plan-PP docker:静态文件兜底 — 服务 frontend/dist。SPA fallback 让任意未匹配
// 路径(/admin, /analyst 等假 URL)返回 index.html,由前端 router 接管。
// Plan-PP fix11:缓存策略 — /assets/* hash 命名 → immutable;index.html → no-cache
const FRONTEND_DIST = process.env.FRONTEND_DIST ?? './frontend/dist'
app.use('/assets/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('/*', serveStatic({ root: FRONTEND_DIST }))
app.get('*', async (c) => {
  try {
    const html = await Bun.file(`${FRONTEND_DIST}/index.html`).text()
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    return c.html(html)
  } catch {
    return c.text('frontend dist not built — run `cd frontend && bun run build`', 503)
  }
})

logger.info('server starting', { port: env.PORT })

export default { port: env.PORT, fetch: app.fetch }
