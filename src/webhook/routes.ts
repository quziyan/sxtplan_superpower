import { Hono } from 'hono'
import type { Db } from '@/db/client'
import { loadEnv } from '@/env'
import { processIngest } from './ingest'

export function webhookRoutes(db: Db) {
  const app = new Hono()
  app.post('/:adapterKey', async (c) => {
    const env = loadEnv()
    const adapterKey = c.req.param('adapterKey')
    const rawBody = await c.req.text()
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })
    const r = await processIngest(db, env.WEBHOOK_HMAC_SECRET, {
      adapterKey,
      rawBody,
      headers,
    })
    if (r.status === 'INVALID_ADAPTER') return c.json({ error: 'unknown adapter' }, 404)
    if (r.status === 'INVALID_SIG') return c.json({ error: 'invalid signature' }, 401)
    return c.json({ ok: true, envelopeId: r.envelopeId, status: r.status })
  })
  return app
}
