/**
 * 完整重置 — wipe 所有 prediction-related + watchlists,然后种 5 条真实风格 watchlist。
 * 不跑 news 流水线;预测重生让 UI「📡 生成预测」按钮 或 spawn-from-news API 完成。
 *
 * 用法:`bun scripts/reset-and-seed.ts`
 */
import { eq, sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { watchLists } from '@/db/schema/watchlist'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { users } from '@/db/schema/user'

type WatchListSeed = {
  name: string
  vehicle: string
  task: string
  regionName: string
  keywords: string[]
}

const WATCHLIST_SEEDS: WatchListSeed[] = [
  { name: '天河区治安巡逻监视', vehicle: '治安巡逻车', task: '街面治安巡逻', regionName: '广州市天河区',
    keywords: ['天河', '治安巡逻', '广州 公安'] },
  { name: '海珠区交警执法监视', vehicle: '交警执法车', task: '路面交通执法', regionName: '广州市海珠区',
    keywords: ['海珠 交警', '广州 交通执法', '机动车违法'] },
  { name: '越秀区刑侦专项监视', vehicle: '刑侦专项车', task: '专项行动', regionName: '广州市越秀区',
    keywords: ['越秀 刑侦', '广州 打击犯罪', '专项行动'] },
  { name: '番禺区综治排查监视', vehicle: '综治巡防车', task: '综合治理巡查', regionName: '广州市番禺区',
    keywords: ['番禺 综治', '广州 矛盾排查', '基层治理'] },
  { name: '白云区城管执法监视', vehicle: '城管执法车', task: '城管执法巡查', regionName: '广州市白云区',
    keywords: ['白云 城管', '广州 占道经营', '违建查处'] },
]

async function main() {
  const { db, sql: pg } = createDb('admin')

  console.log('▾ Wiping prediction + watchlist tables …')
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
      watch_lists,
      task_cards,
      webhook_envelopes,
      case_library_entries
    RESTART IDENTITY CASCADE
  `)
  console.log('  ✓ wiped')

  // 取 admin 当 createdBy
  const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@cnp.local'))
  if (!adminUser) {
    console.error('✗ admin@cnp.local 不存在,先 `bun src/db/seed-bootstrap.ts`')
    await pg.end()
    process.exit(1)
  }

  console.log('▾ Seeding 5 watchlists …')
  let ok = 0
  for (const seed of WATCHLIST_SEEDS) {
    const [v] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.name, seed.vehicle)).limit(1)
    const [t] = await db.select().from(taskClasses).where(eq(taskClasses.name, seed.task)).limit(1)
    if (!v || !t) {
      console.warn(`  ✗ skip ${seed.name}: V=${seed.vehicle}/T=${seed.task} 不在 taxonomy`)
      continue
    }
    const reg = await db.execute<{ id: string; version: number }>(sql`
      SELECT id, version FROM regions WHERE name = ${seed.regionName} ORDER BY version DESC LIMIT 1
    `)
    const r = reg[0]
    if (!r) {
      console.warn(`  ✗ skip ${seed.name}: region="${seed.regionName}" 找不到`)
      continue
    }
    await db.insert(watchLists).values({
      name: seed.name,
      description: `真实数据驱动 — ${seed.task} / ${seed.regionName}`,
      vehicleClassId: v.id, taskClassId: t.id,
      regionId: r.id, regionVersion: r.version,
      kRangeMin: 3, kRangeMax: 14,
      isActive: true,
      keywords: seed.keywords,
      createdBy: adminUser.id,
    })
    ok++
    console.log(`  ✓ ${seed.name}`)
  }
  console.log(`  ✓ seeded ${ok}/${WATCHLIST_SEEDS.length} watchlists`)
  await pg.end()
}

await main()
