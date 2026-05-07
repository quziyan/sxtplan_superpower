import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { computeSignature } from '@/webhook/signature'
import { resetEnvCacheForTests } from '@/env'
import { buildTestApp } from '../helpers/test-server'
import { createTestDb } from '../helpers/test-db'

const SECRET = 'test-secret-32-chars-min-required-xx'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let app: ReturnType<typeof buildTestApp>

beforeAll(async () => {
  process.env.SESSION_SECRET = '0'.repeat(64)
  process.env.WEBHOOK_HMAC_SECRET = SECRET
  resetEnvCacheForTests()
  ctx = await createTestDb()
  app = buildTestApp(ctx.db)
})
afterAll(async () => {
  await ctx.cleanup()
  resetEnvCacheForTests()
})

describe('webhook routes', () => {
  test('valid signature → 200 PROCESSED with envelopeId', async () => {
    const body = JSON.stringify({ event: 'test', n: 1 })
    const sig = computeSignature(body, SECRET)
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
        'x-idempotency-key': `valid-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; envelopeId: string; status: string }
    expect(json.ok).toBe(true)
    expect(json.status).toBe('PROCESSED')
    expect(json.envelopeId).toBeTruthy()
  })

  test('bad signature → 401', async () => {
    const body = JSON.stringify({ event: 'bad' })
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'deadbeef'.repeat(8), // 64 hex chars but wrong
        'x-idempotency-key': `bad-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  test('duplicate idempotency-key → second returns DUPLICATE', async () => {
    const body = JSON.stringify({ event: 'dup', n: 2 })
    const sig = computeSignature(body, SECRET)
    const idem = `dup-${Date.now()}-${Math.random()}`
    const headers = {
      'content-type': 'application/json',
      'x-signature': sig,
      'x-idempotency-key': idem,
    }
    const r1 = await app.request('/webhook/mock', { method: 'POST', headers, body })
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { status: string; envelopeId: string }
    expect(j1.status).toBe('PROCESSED')

    const r2 = await app.request('/webhook/mock', { method: 'POST', headers, body })
    expect(r2.status).toBe(200)
    const j2 = (await r2.json()) as { status: string; envelopeId: string }
    expect(j2.status).toBe('DUPLICATE')
    expect(j2.envelopeId).toBe(j1.envelopeId)
  })

  test('unknown adapter → 404', async () => {
    const body = JSON.stringify({ event: 'x' })
    const sig = computeSignature(body, SECRET)
    const res = await app.request('/webhook/nonexistent-adapter', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': sig,
        'x-idempotency-key': `unk-${Date.now()}`,
      },
      body,
    })
    expect(res.status).toBe(404)
  })

  test('missing signature header → 401', async () => {
    const body = JSON.stringify({ event: 'no-sig' })
    const res = await app.request('/webhook/mock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': `nosig-${Date.now()}-${Math.random()}`,
      },
      body,
    })
    expect(res.status).toBe(401)
  })
})
