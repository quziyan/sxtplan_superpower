/**
 * 局部 wipe — 清掉 prediction 相关全量数据,保留 watchlist / V / T / region / users。
 * 为「重新生成预测」流程做铺垫:wipe 后调 spawn-from-news 重建。
 *
 * 用法:`bun scripts/wipe-prediction-data.ts`
 */
import { sql } from 'drizzle-orm'
import { createDb } from '@/db/client'

async function main() {
  // admin connection — app role lacks TRUNCATE privilege
  const { db, sql: pg } = createDb('admin')
  const close = () => pg.end()
  console.log('▾ Wiping prediction-related tables …')
  await db.execute(sql`
    TRUNCATE TABLE
      media_assets,
      dispatch_results,
      dispatch_tasks,
      retrospectives,
      news_evidence,
      confidence_snapshots,
      predictions,
      news_items,
      webhook_envelopes,
      case_library_entries
    RESTART IDENTITY CASCADE
  `)
  const [predCount] = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM predictions`)
  const [wlCount] = await db.execute<{ c: number }>(sql`SELECT COUNT(*)::int AS c FROM watch_lists`)
  console.log(`  ✓ wiped. predictions=${predCount!.c} | watch_lists kept=${wlCount!.c}`)
  await close()
}

await main()
