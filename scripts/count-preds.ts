import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
const { db, sql: pg } = createDb('admin')
const r = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM predictions`)
console.log('predictions=', r[0]!.c)
const r3 = await db.execute<{ source_name: string | null; cnt: number }>(sql`
  SELECT wl.name AS source_name, COUNT(p.id)::int AS cnt
  FROM predictions p LEFT JOIN watch_lists wl ON wl.id = p.source_id
  GROUP BY wl.name ORDER BY cnt DESC LIMIT 10
`)
for (const x of r3) console.log('  ', x.source_name ?? '(null)', '→', x.cnt)
await pg.end()
