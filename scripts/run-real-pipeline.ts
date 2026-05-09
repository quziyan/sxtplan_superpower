/**
 * 一次性脚本:清空分析师工作台数据 → 种 5 条真实风格 watchlist + 12 条 PROPOSED 预测
 *  → 同步驱动 (newsIngest → triage → refresh) 三段流水线 → 真 Tavily + 真 LLM →
 *  报告产出 → 若证据覆盖率 < 阈值,自动扩源 + 调低阈值再跑一轮。
 *
 * 依赖外部:Tavily (.env TAVILY_API_KEY) + dashscope (.env LLM_API_KEY)。
 * 全程不 mock,每条新闻真请求,每次 triage 真 LLM,真置信度快照真写库。
 *
 * 用法:`bun scripts/run-real-pipeline.ts`
 *
 * 执行时间:约 5–15 分钟(取决于 LLM/Tavily 网络往返)
 */
import { eq, sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { watchLists } from '@/db/schema/watchlist'
import { predictions } from '@/db/schema/prediction'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { users } from '@/db/schema/user'
import { tickNewsIngest, type NewsTriageQueueLike } from '@/scheduler/workers/news-ingest'
import { processNewsTriageJob, type RefreshQueueLike, type NewsTriageJobData } from '@/scheduler/workers/news-triage'
import { processRefreshJob, type RefreshJobData } from '@/scheduler/workers/refresh'

// ─── 1. 清空目标表(保留 V/T/region/users/roles/taxonomy)─────────────
async function wipe(db: ReturnType<typeof createDb>['db']): Promise<void> {
  console.log('▾ Wiping analyst tables …')
  // 注:audit.operation_audit 在独立 schema,不参与 wipe(保留历史)
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
}

// ─── 2. 种 5 条真实风格 watchlist ────────────────────────────────────
type WatchListSeed = {
  name: string
  vehicle: string  // canonical 中文名
  task: string
  regionName: string
  keywords: string[]
}

const WATCHLIST_SEEDS: WatchListSeed[] = [
  {
    name: '天河区治安巡逻监视',
    vehicle: '治安巡逻车', task: '街面治安巡逻', regionName: '广州市天河区',
    keywords: ['天河', '治安巡逻', '广州 公安'],
  },
  {
    name: '海珠区交警执法监视',
    vehicle: '交警执法车', task: '路面交通执法', regionName: '广州市海珠区',
    keywords: ['海珠 交警', '广州 交通执法', '机动车违法'],
  },
  {
    name: '越秀区刑侦专项监视',
    vehicle: '刑侦专项车', task: '专项行动', regionName: '广州市越秀区',
    keywords: ['越秀 刑侦', '广州 打击犯罪', '专项行动'],
  },
  {
    name: '番禺区综治排查监视',
    vehicle: '综治巡防车', task: '综合治理巡查', regionName: '广州市番禺区',
    keywords: ['番禺 综治', '广州 矛盾排查', '基层治理'],
  },
  {
    name: '白云区城管执法监视',
    vehicle: '城管执法车', task: '城管执法巡查', regionName: '广州市白云区',
    keywords: ['白云 城管', '广州 占道经营', '违建查处'],
  },
]

async function seedWatchlists(
  db: ReturnType<typeof createDb>['db'],
  createdBy: string,
): Promise<Array<{ id: string; seed: WatchListSeed; vId: string; tId: string; rId: string; rVer: number }>> {
  console.log('▾ Seeding watchlists …')
  const out: Array<{ id: string; seed: WatchListSeed; vId: string; tId: string; rId: string; rVer: number }> = []
  for (const seed of WATCHLIST_SEEDS) {
    // 拿一行匹配的 V / T(taxonomy 已清干净,任意一行即可)
    const [v] = await db.select().from(vehicleClasses).where(eq(vehicleClasses.name, seed.vehicle)).limit(1)
    const [t] = await db.select().from(taskClasses).where(eq(taskClasses.name, seed.task)).limit(1)
    if (!v || !t) {
      console.warn(`  ✗ skip ${seed.name}: V=${seed.vehicle}/T=${seed.task} 在 taxonomy 中找不到`)
      continue
    }
    // region 也按名称匹配
    const reg = await db.execute<{ id: string; version: number }>(sql`
      SELECT id, version FROM regions WHERE name = ${seed.regionName} ORDER BY version DESC LIMIT 1
    `)
    const r = reg[0]
    if (!r) {
      console.warn(`  ✗ skip ${seed.name}: region="${seed.regionName}" 找不到`)
      continue
    }
    const [wl] = await db.insert(watchLists).values({
      name: seed.name,
      description: `真实数据驱动 demo — ${seed.task} / ${seed.regionName}`,
      vehicleClassId: v.id, taskClassId: t.id,
      regionId: r.id, regionVersion: r.version,
      kRangeMin: 3, kRangeMax: 14,
      isActive: true,
      keywords: seed.keywords,
      createdBy,
    }).returning()
    if (!wl) continue
    out.push({ id: wl.id, seed, vId: v.id, tId: t.id, rId: r.id, rVer: r.version })
    console.log(`  ✓ ${seed.name}  (kw=${seed.keywords.join('|')})`)
  }
  return out
}

// ─── 3. 每个 watchlist 种 2-3 条 PROPOSED prediction(今天/+3d/+7d × AM/PM)─
type SeededPred = { id: string; watchlistName: string; window: string }

async function seedPredictions(
  db: ReturnType<typeof createDb>['db'],
  wls: Array<{ id: string; seed: WatchListSeed; vId: string; tId: string; rId: string; rVer: number }>,
): Promise<SeededPred[]> {
  console.log('▾ Seeding predictions …')
  const out: SeededPred[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const offsets: Array<{ days: number; half: 'AM' | 'PM' }> = [
    { days: 0, half: 'AM' },
    { days: 3, half: 'PM' },
    { days: 7, half: 'AM' },
  ]
  for (const wl of wls) {
    for (const off of offsets) {
      const wd = new Date(today.getTime() + off.days * 86_400_000)
      const expires = new Date(wd.getTime() + 10 * 86_400_000)
      const [p] = await db.insert(predictions).values({
        sourceKind: 'WATCHLIST', sourceId: wl.id,
        regionId: wl.rId, regionVersion: wl.rVer,
        windowDate: wd, windowHalf: off.half,
        vehicleClassId: wl.vId, taskClassId: wl.tId,
        kDays: off.days || 1,
        confidenceNow: 0,  // 真 LLM 尚未运行,从 0 起步
        cadenceMinutes: 1440,
        expiresAt: expires,
      }).returning()
      if (p) {
        out.push({
          id: p.id, watchlistName: wl.seed.name,
          window: `${wd.toISOString().slice(0, 10)} ${off.half} (k=${off.days || 1})`,
        })
      }
    }
  }
  console.log(`  ✓ ${out.length} predictions seeded`)
  return out
}

// ─── 4. capture queue:同步收集 jobs,不进 Redis ──────────────────────
class CaptureTriageQueue implements NewsTriageQueueLike {
  jobs: NewsTriageJobData[] = []
  async add(_name: string, data: NewsTriageJobData): Promise<unknown> {
    this.jobs.push(data)
    return undefined
  }
}
class CaptureRefreshQueue implements RefreshQueueLike {
  jobs: RefreshJobData[] = []
  async add(
    _name: string,
    data: { predictionId: string; kind: 'INCR'; newEvidenceNewsIds: string[] },
  ): Promise<unknown> {
    this.jobs.push(data as RefreshJobData)
    return undefined
  }
}

// ─── 5. 同步驱动整条流水线 ─────────────────────────────────────────
async function drivePipeline(
  db: ReturnType<typeof createDb>['db'],
): Promise<{ newsFetched: number; newsInserted: number; triageJobs: number; medPlus: number; high: number; refreshes: number }> {
  console.log()
  console.log('━━━ 1) tickNewsIngest (real Tavily) ━━━')
  const triageQ = new CaptureTriageQueue()
  const ingestResult = await tickNewsIngest({ db, triageQueue: triageQ })
  console.log(`  Tavily fetched=${ingestResult.newsFetched}  inserted=${ingestResult.newsInserted}  triage_enqueued=${ingestResult.triageJobsEnqueued}  errors=${ingestResult.errors}`)

  console.log()
  console.log('━━━ 2) drain triage jobs (real LLM) ━━━')
  const refreshQ = new CaptureRefreshQueue()
  let medPlus = 0, high = 0
  for (let i = 0; i < triageQ.jobs.length; i++) {
    const j = triageQ.jobs[i]!
    process.stdout.write(`  [${i + 1}/${triageQ.jobs.length}] triaging news=${j.newsId.slice(0, 8)} pred=${j.predictionId.slice(0, 8)} … `)
    try {
      const r = await processNewsTriageJob(db, j, refreshQ)
      console.log(`relevant=${r.relevant} weight=${r.weight} evidence=${r.evidenceWritten} refresh=${r.refreshEnqueued}`)
      if (r.evidenceWritten) medPlus++
      if (r.refreshEnqueued) high++
    } catch (err) {
      console.log(`✗ triage error: ${(err as Error).message}`)
    }
  }
  console.log(`  ✓ triage 完成:MED+ ${medPlus} 条 · HIGH ${high} 条 (refresh 排队 ${refreshQ.jobs.length} 个)`)

  console.log()
  console.log('━━━ 3) drain refresh jobs (real LLM via PredictionAgent) ━━━')
  for (let i = 0; i < refreshQ.jobs.length; i++) {
    const j = refreshQ.jobs[i]!
    process.stdout.write(`  [${i + 1}/${refreshQ.jobs.length}] refresh ${j.kind} pred=${j.predictionId.slice(0, 8)} … `)
    try {
      const r = await processRefreshJob(db, j)
      console.log(`new_confidence=${r.confidence}`)
    } catch (err) {
      console.log(`✗ refresh error: ${(err as Error).message}`)
    }
  }

  return {
    newsFetched: ingestResult.newsFetched,
    newsInserted: ingestResult.newsInserted,
    triageJobs: triageQ.jobs.length,
    medPlus, high,
    refreshes: refreshQ.jobs.length,
  }
}

// ─── 6. 报告 + 自动扩源/调低阈值 ─────────────────────────────────────
async function report(db: ReturnType<typeof createDb>['db'], seededPreds: SeededPred[]) {
  console.log()
  console.log('━━━ 4) 产出汇总 ━━━')
  // 用 scalar subquery 避免 JOIN 重复行问题(15 prediction × 多条 evidence × 多条 snapshot 会被 JOIN 放大)
  const stats = await db.execute<{
    total: number; with_snapshot: number; with_evidence: number; gt0_conf: number; gte50_conf: number; gte70_conf: number
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM predictions) AS total,
      (SELECT COUNT(DISTINCT prediction_id)::int FROM confidence_snapshots) AS with_snapshot,
      (SELECT COUNT(DISTINCT prediction_id)::int FROM news_evidence) AS with_evidence,
      (SELECT COUNT(*)::int FROM predictions WHERE confidence_now > 0) AS gt0_conf,
      (SELECT COUNT(*)::int FROM predictions WHERE confidence_now >= 50) AS gte50_conf,
      (SELECT COUNT(*)::int FROM predictions WHERE confidence_now >= 70) AS gte70_conf
  `)
  const s = stats[0]!
  console.log(`  prediction 总数:${s.total}`)
  console.log(`  ├─ 有快照:${s.with_snapshot}  (${pct(s.with_snapshot, s.total)})`)
  console.log(`  ├─ 有证据:${s.with_evidence}  (${pct(s.with_evidence, s.total)})`)
  console.log(`  ├─ confidence > 0:${s.gt0_conf}  (${pct(s.gt0_conf, s.total)})`)
  console.log(`  ├─ confidence ≥ 50:${s.gte50_conf}`)
  console.log(`  └─ confidence ≥ 70:${s.gte70_conf}  (高置信,建议优先推送)`)

  // 抽样几条带证据的
  const samples = await db.execute<{ id: string; conf: number; reasoning: string | null; news_count: number }>(sql`
    SELECT p.id, p.confidence_now AS conf,
           (SELECT cs.reasoning FROM confidence_snapshots cs WHERE cs.prediction_id = p.id ORDER BY cs.occurred_at DESC LIMIT 1) AS reasoning,
           (SELECT COUNT(*)::int FROM news_evidence ne WHERE ne.prediction_id = p.id) AS news_count
    FROM predictions p
    WHERE p.confidence_now > 0
    ORDER BY p.confidence_now DESC
    LIMIT 3
  `)
  if (samples.length > 0) {
    console.log()
    console.log('  样例(置信度 top 3):')
    for (const x of samples) {
      const r = (x.reasoning ?? '').slice(0, 120).replace(/\s+/g, ' ')
      console.log(`    [${x.id.slice(0, 8)}] conf=${x.conf}  evidence=${x.news_count}  reasoning="${r}…"`)
    }
  }

  return s
}

function pct(n: number, total: number): string {
  return total === 0 ? '0%' : ((n * 100) / total).toFixed(0) + '%'
}

// ─── 7. main ───────────────────────────────────────────────────────────
async function main() {
  const { db } = createDb('admin')
  const [u] = await db.select().from(users).limit(1)
  if (!u) throw new Error('no users — bootstrap-seed first')

  console.log(`actor: ${u.email} (${u.id.slice(0, 8)})`)
  await wipe(db)
  const wls = await seedWatchlists(db, u.id)
  if (wls.length === 0) throw new Error('no watchlists seeded — taxonomy/region 缺失,先跑 seed:taxonomy:police + seed:region')
  const preds = await seedPredictions(db, wls)
  if (preds.length === 0) throw new Error('no predictions seeded')

  const r1 = await drivePipeline(db)
  const s1 = await report(db, preds)

  // 自动扩源 / 调低阈值:若证据覆盖率 < 25%,广撒网再跑一轮
  const coverage = preds.length === 0 ? 0 : (s1.with_evidence / preds.length)
  if (coverage < 0.25) {
    console.log()
    console.log('━━━ 5) 证据覆盖率 < 25% — 自动扩源(更宽广关键词)── ')
    // 给每个 watchlist 加通用关键词
    for (const wl of wls) {
      const broader = [...wl.seed.keywords, '广州 警务', '广东 公安', '广州 安保']
      await db.update(watchLists).set({ keywords: broader }).where(eq(watchLists.id, wl.id))
    }
    const r2 = await drivePipeline(db)
    await report(db, preds)
    console.log(`  扩源后 △ news_inserted=+${r2.newsInserted}  △ medPlus=+${r2.medPlus}`)
  }

  console.log()
  console.log('✅ DONE — 浏览器 F5 刷新分析师工作台')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
