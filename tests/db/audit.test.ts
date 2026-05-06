import { describe, expect, test } from 'bun:test'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { operationAudit } from '@/db/schema/audit'
import * as schema from '@/db/schema'

const APP_URL = process.env.DATABASE_URL ?? 'postgres://cnp_app:cnp_app_pwd@localhost:5433/cnp'

describe('audit (INSERT-only enforced by DB role)', () => {
  test('cnp_app can INSERT', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    const db = drizzle(sql, { schema })
    const [row] = await db.insert(operationAudit).values({
      targetKind: 'prediction', action: 'test_insert',
    }).returning()
    expect(row!.id).toBeDefined()
    await sql.end()
  })

  test('cnp_app cannot UPDATE', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    // Wrap in a plain Promise — Bun's rejects.toThrow hangs on postgres query objects directly
    await expect(
      Promise.resolve(sql`UPDATE audit.operation_audit SET action='changed' WHERE TRUE`)
    ).rejects.toThrow(/permission denied/)
    await sql.end()
  })

  test('cnp_app cannot DELETE', async () => {
    const sql = postgres(APP_URL, { max: 2, prepare: false })
    // Wrap in a plain Promise — Bun's rejects.toThrow hangs on postgres query objects directly
    await expect(
      Promise.resolve(sql`DELETE FROM audit.operation_audit WHERE TRUE`)
    ).rejects.toThrow(/permission denied/)
    await sql.end()
  })
})
