/**
 * 一次性种 15 条 evidence-backed 预测 — 每个 active watchlist 3 条,日期分布于
 * 今日 / +1 / +3 / +7 / +12 五个窗口,AM/PM 混搭,status 含 PROPOSED / VALIDATED /
 * APPROVED / REJECTED / COMPLETED 多种,带 1 条新闻 + 1 条 evidence + 1 条 snapshot
 * (满足「预测必须有新闻证据」的 source policy)。
 *
 * 用法:`bun scripts/seed-demo-predictions.ts`
 */
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { watchLists } from '@/db/schema/watchlist'
import { newsItems, predictions, confidenceSnapshots } from '@/db/schema/prediction'
import { users } from '@/db/schema/user'

type Status = 'PROPOSED' | 'VALIDATED' | 'APPROVED' | 'REJECTED' | 'COMPLETED'

// 五种窗口偏移天数 + AM/PM 安排
const SLOTS: Array<{ dayOffset: number; half: 'AM' | 'PM'; status: Status; confidence: number; reasoning: string }> = [
  { dayOffset: 0,  half: 'AM', status: 'PROPOSED',  confidence: 62, reasoning: '当日早高峰应急响应概率上升' },
  { dayOffset: 1,  half: 'PM', status: 'VALIDATED', confidence: 75, reasoning: '关联事件已被分析师推送决策者' },
  { dayOffset: 3,  half: 'AM', status: 'APPROVED',  confidence: 84, reasoning: '联合上级研判后批准派单' },
  { dayOffset: 7,  half: 'PM', status: 'REJECTED',  confidence: 28, reasoning: '相似事件已闭环,无需重复响应' },
  { dayOffset: 12, half: 'AM', status: 'COMPLETED', confidence: 91, reasoning: '历史窗口,outcome=HIT,作为回顾样本' },
]

async function main() {
  const { db, sql: pg } = createDb('admin')
  const [admin] = await db.select().from(users).where(eq(users.email, 'admin@cnp.local'))
  if (!admin) {
    console.error('✗ admin@cnp.local 不存在')
    await pg.end()
    process.exit(1)
  }

  const wls = await db.select().from(watchLists).where(eq(watchLists.isActive, true))
  console.log(`▾ active watchlists: ${wls.length}`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let total = 0

  for (const wl of wls) {
    console.log(`\n──→ ${wl.name}`)
    for (const slot of SLOTS) {
      const windowDate = new Date(today)
      windowDate.setDate(today.getDate() + slot.dayOffset)
      const expiresAt = new Date(windowDate)
      expiresAt.setDate(windowDate.getDate() + 1)

      // 新闻原文 — 与 watchlist 主题相关
      const url = `https://example.local/demo-${wl.id.slice(0,8)}-${slot.dayOffset}-${slot.half}`
      const title = `[demo] ${wl.name} · ${slot.reasoning.slice(0, 14)}`
      const contentHash = createHash('sha256').update(url + title).digest('hex')
      const [news] = await db.insert(newsItems).values({
        sourceKind: 'MAINSTREAM',
        sourceLabel: 'demo-seed',
        url,
        title,
        summaryZh: slot.reasoning,
        publishedAt: new Date(Date.now() - (slot.dayOffset > 0 ? 0 : 3600_000)),
        rawSnippet: slot.reasoning,
        contentHash,
      }).returning()
      if (!news) continue

      const kDays = Math.max(1, slot.dayOffset || 1)
      const [pred] = await db.insert(predictions).values({
        sourceKind: 'WATCHLIST',
        sourceId: wl.id,
        regionId: wl.regionId,
        regionVersion: wl.regionVersion,
        windowDate,
        windowHalf: slot.half,
        vehicleClassId: wl.vehicleClassId,
        taskClassId: wl.taskClassId,
        kDays,
        confidenceNow: slot.confidence,
        status: slot.status,
        expiresAt,
      }).returning()
      if (!pred) continue

      // evidence 行 — 用 raw SQL 避免 schema 引入。HIGH 权重 + cited=true。
      await db.execute(sql`
        INSERT INTO news_evidence (prediction_id, news_id, weight, cited, added_at)
        VALUES (${pred.id}, ${news.id}, 'HIGH', true, NOW())
      `)

      await db.insert(confidenceSnapshots).values({
        predictionId: pred.id,
        kind: 'FULL',
        confidence: slot.confidence,
        reasoning: slot.reasoning,
        evidenceIds: [news.id],
        operator: 'demo-seed',
        occurredAt: new Date(),
      })

      total++
      console.log(`  ✓ ${slot.status.padEnd(10)} ${windowDate.toISOString().slice(0,10)} ${slot.half} conf=${slot.confidence}`)
    }
  }

  console.log(`\n═════ ${total} predictions seeded ═════`)
  await pg.end()
}

await main()
