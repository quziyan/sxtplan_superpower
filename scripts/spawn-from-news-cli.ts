/**
 * CLI 触发 spawn-from-news,绕过 HTTP/auth。每个 active watchlist 走完整
 * tickNewsIngest + runNewsExtractAgent 链路 — 跟 UI「📡 生成预测」按钮 1:1 等价。
 *
 * 用法:`bun scripts/spawn-from-news-cli.ts`
 */
import { eq } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { watchLists } from '@/db/schema/watchlist'
import { tickNewsIngest } from '@/scheduler/workers/news-ingest'
import { runNewsExtractAgent } from '@/agents/news-extract-agent'
import { newsTriageQueue, newsExtractQueue } from '@/scheduler/queue'

const SPAWN_EXTRACT_CONCURRENCY = 3

async function main() {
  // app role 够用 — 这里只读 watchlists + 写 news/prediction
  const { db, sql: pg } = createDb('app')
  const active = await db.select().from(watchLists).where(eq(watchLists.isActive, true))
  console.log(`▾ Active watchlists: ${active.length}`)

  let totalCreated = 0, totalMerged = 0, totalFetched = 0
  for (const wl of active) {
    console.log(`\n──→ ${wl.name}`)
    const t0 = Date.now()
    try {
      const ingest = await tickNewsIngest({
        db, triageQueue: newsTriageQueue, extractQueue: newsExtractQueue,
        onlyWatchlistId: wl.id,
      })
      console.log(`  newsFetched=${ingest.newsFetched} newsInserted=${ingest.newsInserted}`)
      let created = 0, merged = 0, degraded = 0, attempted = 0
      for (let i = 0; i < ingest.newlyInsertedNewsIds.length; i += SPAWN_EXTRACT_CONCURRENCY) {
        const batch = ingest.newlyInsertedNewsIds.slice(i, i + SPAWN_EXTRACT_CONCURRENCY)
        const results = await Promise.all(batch.map(async (newsId) => {
          try { return await runNewsExtractAgent(db, { newsId }) }
          catch (e) { console.warn(`    ✗ news=${newsId.slice(0, 8)}:`, (e as Error).message); return null }
        }))
        for (const r of results) {
          attempted++
          if (r === null) continue
          created += r.created
          merged += r.merged
          if (r.llmDegraded) degraded++
        }
      }
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`  ✓ extracted=${attempted} created=${created} merged=${merged} degraded=${degraded} (${sec}s)`)
      totalCreated += created
      totalMerged += merged
      totalFetched += ingest.newsFetched
    } catch (err) {
      console.error(`  ✗ wl=${wl.name}:`, (err as Error).message)
    }
  }

  console.log(`\n═════ TOTAL ═════`)
  console.log(`  watchlists processed: ${active.length}`)
  console.log(`  news fetched:         ${totalFetched}`)
  console.log(`  predictions created:  ${totalCreated}`)
  console.log(`  predictions merged:   ${totalMerged}`)
  await pg.end()
  // workers/agents may hold redis pools — force exit
  setTimeout(() => process.exit(0), 1000).unref()
}

await main()
