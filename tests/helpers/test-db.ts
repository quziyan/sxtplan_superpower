import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@/db/schema'

export async function createTestDb() {
  const url = process.env.DATABASE_ADMIN_URL ?? 'postgres://cnp:cnp_dev@localhost:5433/cnp'
  const sql = postgres(url, { max: 2, prepare: false })
  const db = drizzle(sql, { schema })
  await migrate(db, { migrationsFolder: './migrations' })
  return { db, sql, cleanup: async () => { await sql.end() } }
}
