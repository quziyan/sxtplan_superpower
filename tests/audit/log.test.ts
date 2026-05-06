import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { logAudit } from '@/audit/log'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('logAudit', () => {
  test('inserts row into audit.operation_audit', async () => {
    const { db } = ctx
    const reason = `looks good ${Date.now()}`
    await logAudit(db, {
      targetKind: 'prediction', action: 'approve',
      reason, before: { conf: 50 }, after: { conf: 50 },
    })
    const result = await db.execute(sql`
      SELECT action, reason, before FROM audit.operation_audit
      WHERE action = 'approve' AND reason = ${reason}
    `)
    expect(result.length).toBeGreaterThan(0)
    expect((result[0] as any).before).toEqual({ conf: 50 })
  })
})
