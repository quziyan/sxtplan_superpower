import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { webhookEnvelopes } from '@/db/schema/webhook'
import {
  incrementRetry,
  markFailed,
  markProcessed,
  persistEnvelope,
  RETRY_LIMIT,
  type IngestEnvelope,
} from '@/webhook/envelope'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

function uniqueKey(tag: string): string {
  return `${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 10)}`
}

function makeEnvelope(overrides: Partial<IngestEnvelope> = {}): IngestEnvelope {
  return {
    adapterKey: 'amap',
    idempotencyKey: uniqueKey('env'),
    sigStatus: 'OK',
    rawHeaders: { 'x-sig': 'abc', 'content-type': 'application/json' },
    rawBody: '{"event":"test"}',
    ...overrides,
  }
}

async function countByKey(db: typeof ctx.db, adapterKey: string, idem: string): Promise<number> {
  const rows = await db.select().from(webhookEnvelopes).where(
    and(eq(webhookEnvelopes.adapterKey, adapterKey), eq(webhookEnvelopes.idempotencyKey, idem)),
  )
  return rows.length
}

describe('persistEnvelope', () => {
  test('first insert returns isDuplicate=false and persists row', async () => {
    const { db } = ctx
    const e = makeEnvelope()
    const res = await persistEnvelope(db, e)
    expect(res.isDuplicate).toBe(false)
    expect(typeof res.id).toBe('string')

    const [row] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, res.id))
    expect(row!.adapterKey).toBe(e.adapterKey)
    expect(row!.idempotencyKey).toBe(e.idempotencyKey)
    expect(row!.status).toBe('RECEIVED')
    expect(row!.rawBody).toBe(e.rawBody)
  })

  test('second call with same (adapterKey, idempotencyKey) returns same id, isDuplicate=true, no second row', async () => {
    const { db } = ctx
    const e = makeEnvelope()
    const first = await persistEnvelope(db, e)
    const second = await persistEnvelope(db, { ...e, rawBody: '{"event":"DIFFERENT"}' })

    expect(second.isDuplicate).toBe(true)
    expect(second.id).toBe(first.id)
    expect(await countByKey(db, e.adapterKey, e.idempotencyKey)).toBe(1)

    // Original row body unchanged (idempotent insert, not upsert).
    const [row] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, first.id))
    expect(row!.rawBody).toBe(e.rawBody)
  })

  test('different adapter, same idempotencyKey is NOT a duplicate', async () => {
    const { db } = ctx
    const idem = uniqueKey('cross-adapter')
    const a = await persistEnvelope(db, makeEnvelope({ adapterKey: 'amap', idempotencyKey: idem }))
    const b = await persistEnvelope(db, makeEnvelope({ adapterKey: 'didi', idempotencyKey: idem }))

    expect(a.isDuplicate).toBe(false)
    expect(b.isDuplicate).toBe(false)
    expect(a.id).not.toBe(b.id)
    expect(await countByKey(db, 'amap', idem)).toBe(1)
    expect(await countByKey(db, 'didi', idem)).toBe(1)
  })
})

describe('markProcessed', () => {
  test('sets PROCESSED + processedDispatchId + processedAt', async () => {
    const { db } = ctx
    const { id } = await persistEnvelope(db, makeEnvelope())
    const dispatchId = '00000000-0000-0000-0000-000000000abc'
    await markProcessed(db, id, dispatchId)

    const [row] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, id))
    expect(row!.status).toBe('PROCESSED')
    expect(row!.processedDispatchId).toBe(dispatchId)
    expect(row!.processedAt).not.toBeNull()
  })
})

describe('markFailed', () => {
  test('sets PROCESSING_FAILED + error message', async () => {
    const { db } = ctx
    const { id } = await persistEnvelope(db, makeEnvelope())
    await markFailed(db, id, 'parse error: bad json')

    const [row] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, id))
    expect(row!.status).toBe('PROCESSING_FAILED')
    expect(row!.error).toBe('parse error: bad json')
  })
})

describe('incrementRetry', () => {
  test('first increment returns 1 / not at limit; reaches limit at RETRY_LIMIT', async () => {
    const { db } = ctx
    const { id } = await persistEnvelope(db, makeEnvelope())

    const r1 = await incrementRetry(db, id)
    expect(r1.retryCount).toBe(1)
    expect(r1.reachedLimit).toBe(false)

    let last = r1
    for (let i = 2; i <= RETRY_LIMIT; i++) {
      last = await incrementRetry(db, id)
      expect(last.retryCount).toBe(i)
    }
    expect(last.retryCount).toBe(RETRY_LIMIT)
    expect(last.reachedLimit).toBe(true)

    // DB confirms persisted count.
    const [row] = await db.select().from(webhookEnvelopes).where(eq(webhookEnvelopes.id, id))
    expect(row!.retryCount).toBe(RETRY_LIMIT)
  })
})
