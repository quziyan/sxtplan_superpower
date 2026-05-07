import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { webhookEnvelopes } from '@/db/schema/webhook'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

function uniqueKey(tag: string): string {
  return `${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 10)}`
}

describe('webhook_envelopes schema', () => {
  test('insert succeeds with required fields', async () => {
    const { db } = ctx
    const idem = uniqueKey('ok')
    const [row] = await db.insert(webhookEnvelopes).values({
      adapterKey: 'amap',
      idempotencyKey: idem,
      sigStatus: 'OK',
      rawHeadersJson: { 'x-sig': 'abc', 'content-type': 'application/json' },
      rawBody: '{"event":"ping"}',
    }).returning()
    expect(row!.adapterKey).toBe('amap')
    expect(row!.idempotencyKey).toBe(idem)
    expect(row!.status).toBe('RECEIVED')
    expect(row!.retryCount).toBe(0)
    expect(row!.processedAt).toBeNull()
  })

  test('duplicate (adapter_key, idempotency_key) is rejected by unique index', async () => {
    const { db } = ctx
    const idem = uniqueKey('dup')
    await db.insert(webhookEnvelopes).values({
      adapterKey: 'didi',
      idempotencyKey: idem,
      sigStatus: 'OK',
      rawHeadersJson: {},
      rawBody: 'first',
    })
    await expect(Promise.resolve(db.insert(webhookEnvelopes).values({
      adapterKey: 'didi',
      idempotencyKey: idem,
      sigStatus: 'OK',
      rawHeadersJson: {},
      rawBody: 'second',
    }))).rejects.toThrow()
  })

  test('invalid status enum value is rejected', async () => {
    const { db } = ctx
    await expect(Promise.resolve(db.insert(webhookEnvelopes).values({
      adapterKey: 'amap',
      idempotencyKey: uniqueKey('bogus'),
      sigStatus: 'OK',
      rawHeadersJson: {},
      rawBody: 'x',
      status: 'BOGUS' as unknown as 'RECEIVED',
    }))).rejects.toThrow()
  })
})
