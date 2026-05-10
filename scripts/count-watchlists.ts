import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'

const { db, sql: pg } = createDb('admin')
const rows = await db.execute<{ is_active: boolean; c: number }>(
  sql`SELECT is_active, COUNT(*)::int AS c FROM watch_lists GROUP BY is_active`,
)
for (const r of rows) console.log(`  is_active=${r.is_active} → ${r.c}`)
const sample = await db.execute<{ name: string }>(
  sql`SELECT name FROM watch_lists WHERE is_active = true ORDER BY created_at DESC LIMIT 5`,
)
console.log('  sample is_active:')
for (const r of sample) console.log(`    · ${r.name}`)
await pg.end()
