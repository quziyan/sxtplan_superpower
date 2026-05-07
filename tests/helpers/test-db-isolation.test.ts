import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

/**
 * Goal-state assertions for ISC-C2 (test-db transactional isolation).
 *
 * These tests document the desired isolation semantics. They use a local
 * `createIsolatedDb` helper that opens a long-running outer transaction
 * (via drizzle's `db.transaction(...)` parked inside a held promise) and
 * ROLLBACKs at cleanup. They prove that:
 *   1. two isolated handles cannot see each other's writes;
 *   2. data inserted via an isolated handle is gone after cleanup;
 *   3. drizzle's nested `db.transaction(...)` works inside the outer tx
 *      (drizzle 0.36 maps it to SAVEPOINT automatically).
 *
 * Why not put this in tests/helpers/test-db.ts? Most existing tests use
 * `expect(...).rejects.toThrow()` against CHECK constraints, which aborts
 * a shared outer tx (Postgres 25P02). Migrating those 350 tests to nested
 * SAVEPOINT-per-assertion is out of scope for this task. The helper here
 * is kept local until that migration lands.
 */

const URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://cnp:cnp_dev@localhost:5433/cnp'

type IsolatedCtx = {
  db: any
  cleanup: () => Promise<void>
}

async function createIsolatedDb(): Promise<IsolatedCtx> {
  const conn = postgres(URL, { max: 2, prepare: false })
  const rawDb = drizzle(conn, { schema })

  let txDb!: any
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => {
    resolveReady = r
  })

  let triggerRollback!: () => void
  const rollbackSignal = new Promise<never>((_, reject) => {
    triggerRollback = () => reject(new Error('__ISO_ROLLBACK__'))
  })

  const txSettled = rawDb
    .transaction(async (tx) => {
      txDb = tx
      resolveReady()
      await rollbackSignal
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === '__ISO_ROLLBACK__') return
      throw err
    })

  await ready

  return {
    db: txDb,
    cleanup: async () => {
      triggerRollback()
      await txSettled
      await conn.end()
    },
  }
}

describe('test-db 事务隔离 (goal-state for ISC-C2)', () => {
  test('两个独立的隔离 db 不相互可见 (待 createTestDb 迁移)', async () => {
    const a = await createIsolatedDb()
    const b = await createIsolatedDb()
    const idA = crypto.randomUUID()
    try {
      await a.db.execute(sql`
        INSERT INTO regions(id, version, kind, name, geom, effective_from)
        VALUES(${idA}, 1, 'ADMIN_NAMED', 'TEST_ISOLATION_A',
               ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
      `)
      const seen = (await b.db.execute(sql`
        SELECT COUNT(*)::int n FROM regions WHERE name = 'TEST_ISOLATION_A'
      `)) as Array<{ n: number }>
      expect((seen[0] as any).n).toBe(0)
    } finally {
      await a.cleanup()
      await b.cleanup()
    }
  })

  test('cleanup 后数据消失 (待 createTestDb 迁移)', async () => {
    const ctx = await createIsolatedDb()
    const id = crypto.randomUUID()
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, geom, effective_from)
      VALUES(${id}, 1, 'ADMIN_NAMED', 'TEST_CLEANUP_B',
             ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326), NOW())
    `)
    await ctx.cleanup()

    const fresh = await createIsolatedDb()
    try {
      const seen = (await fresh.db.execute(sql`
        SELECT COUNT(*)::int n FROM regions WHERE name = 'TEST_CLEANUP_B'
      `)) as Array<{ n: number }>
      expect((seen[0] as any).n).toBe(0)
    } finally {
      await fresh.cleanup()
    }
  })

  test('内嵌 db.transaction 能成功(SAVEPOINT 兼容)', async () => {
    const ctx = await createIsolatedDb()
    let inner = false
    try {
      await ctx.db.transaction(async (tx: any) => {
        inner = true
        await tx.execute(sql`SELECT 1`)
      })
      expect(inner).toBe(true)
    } finally {
      await ctx.cleanup()
    }
  })
})
