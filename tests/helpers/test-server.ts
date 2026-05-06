import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { authRoutes } from '@/auth/routes'
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
  return app
}
