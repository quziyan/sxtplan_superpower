import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { logAudit } from '@/audit/log'
import { createTestDb } from '../helpers/test-db'

describe('logAudit Db | PgTransaction 联合', () => {
  test('logAudit 在事务内写 audit 行,提交后可见', async () => {
    const ctx = await createTestDb()
    const reason = `tx-commit-${Date.now()}`
    await ctx.db.transaction(async (tx) => {
      await logAudit(tx, {
        targetKind: 'test',
        action: 'TEST_TX_AUDIT',
        reason,
      })
    })
    const rows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM audit.operation_audit
      WHERE action = 'TEST_TX_AUDIT' AND reason = ${reason}
    `)
    expect((rows[0] as any).n).toBe(1)
    await ctx.cleanup()
  })

  test('logAudit 在 rollback 事务中不留 audit 行', async () => {
    const ctx = await createTestDb()
    const reason = `tx-rollback-${Date.now()}`
    try {
      await ctx.db.transaction(async (tx) => {
        await logAudit(tx, {
          targetKind: 'test',
          action: 'TEST_ROLLBACK',
          reason,
        })
        throw new Error('intentional rollback')
      })
    } catch {}
    const rows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int n FROM audit.operation_audit
      WHERE action = 'TEST_ROLLBACK' AND reason = ${reason}
    `)
    expect((rows[0] as any).n).toBe(0)
    await ctx.cleanup()
  })
})
