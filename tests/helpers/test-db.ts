import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@/db/schema'
import type { Db } from '@/db/client'

export type TestDbContext = {
  db: Db
  /** raw drizzle handle (alias of `db` in this implementation). Reserved for
   *  future migration: when `createTestDb` becomes tx-wrapped, `rawDb` will
   *  point at the unwrapped handle. Today they are identical. */
  rawDb: Db
  sql: ReturnType<typeof postgres>
  cleanup: () => Promise<void>
}

/**
 * createTestDb hands back a drizzle handle backed by a small admin connection
 * pool. Today it does NOT wrap the test in a long-running BEGIN/ROLLBACK
 * transaction — most existing tests deliberately trigger DB errors via
 * `expect(...).rejects.toThrow()` against CHECK constraints, which would
 * poison a shared outer transaction and cascade-fail the rest of the file.
 *
 * Migrating to true tx isolation requires per-test SAVEPOINT wrapping (e.g.
 * a custom `t.test()` helper or an explicit `withSavepoint(...)` block per
 * error-raising query). That is tracked separately and is out of scope for
 * the m4 helper-isolation task.
 *
 * The shape `{ db, rawDb, sql, cleanup }` matches the future tx-isolated
 * contract, so callers can already destructure `rawDb` defensively.
 */
export async function createTestDb(): Promise<TestDbContext> {
  const url = process.env.DATABASE_ADMIN_URL ?? 'postgres://cnp:cnp_dev@localhost:5433/cnp'
  const sql = postgres(url, { max: 2, prepare: false })
  const db = drizzle(sql, { schema })
  await migrate(db, { migrationsFolder: './migrations' })
  return {
    db,
    rawDb: db,
    sql,
    cleanup: async () => {
      await sql.end()
    },
  }
}
