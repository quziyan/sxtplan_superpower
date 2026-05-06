import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './client'

async function main() {
  const { db, sql } = createDb('admin')
  console.log('[migrate] running migrations from ./migrations')
  await migrate(db, { migrationsFolder: './migrations' })
  await sql.end()
  console.log('[migrate] done')
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
