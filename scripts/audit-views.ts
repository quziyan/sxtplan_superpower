import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
const { db, sql: pg } = createDb('admin')

const total = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM predictions`)
console.log(`总 predictions = ${total[0]!.c}\n`)

const byStatus = await db.execute<{ status: string; c: number }>(sql`
  SELECT status, COUNT(*)::int AS c FROM predictions GROUP BY status ORDER BY status
`)
console.log('按 status 分组:')
for (const r of byStatus) console.log(`  ${r.status.padEnd(12)} → ${r.c}`)

console.log('\n各 view 后端 filter 命中:')

const analyst = await db.execute<{ c: number }>(sql`
  SELECT COUNT(*)::int AS c FROM predictions p
  WHERE p.status = 'PROPOSED' AND EXISTS (SELECT 1 FROM news_evidence ne WHERE ne.prediction_id = p.id)
`)
console.log(`  Analyst (PROPOSED + hasEvidence) → ${analyst[0]!.c}`)

const decision = await db.execute<{ c: number }>(sql`
  SELECT COUNT(*)::int AS c FROM predictions WHERE status = 'VALIDATED'
`)
console.log(`  Decision (VALIDATED)             → ${decision[0]!.c}`)

const retro = await db.execute<{ c: number }>(sql`
  SELECT COUNT(*)::int AS c FROM retrospectives
`)
console.log(`  Reviewer (retrospectives table)  → ${retro[0]!.c}`)

const schedRange = await db.execute<{ c: number }>(sql`
  SELECT COUNT(*)::int AS c FROM predictions
  WHERE window_date >= NOW() - INTERVAL '7 days' AND window_date <= NOW() + INTERVAL '35 days'
`)
console.log(`  Schedule (date range -7~+35d)     → ${schedRange[0]!.c}`)

// 现在没人写的 status
const orphanStatuses = await db.execute<{ status: string; c: number }>(sql`
  SELECT status, COUNT(*)::int AS c FROM predictions
  WHERE status IN ('DISPATCHED', 'COMPLETED', 'EXPIRED')
  GROUP BY status
`)
console.log('\n潜在孤儿(production 无写入路径):')
for (const r of orphanStatuses) console.log(`  ${r.status.padEnd(12)} → ${r.c} (来自 seed/script,非自然产生)`)

await pg.end()
