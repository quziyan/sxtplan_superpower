/**
 * 全闭环验证脚本(A 阶段):挑一条高置信 PROPOSED prediction,把它推过整条
 * 状态机直至 retrospective 写入,逐步打印进展。
 *
 * 流程(每步真服务,无 mock 注入):
 *   1. PROPOSED → VALIDATED(transitionStatus,模拟 ANALYST 推送)
 *   2. VALIDATED → APPROVED(transitionStatus,模拟 DECIDER 批准)
 *   3. processDispatchJob(模拟 dispatch worker 消费 post-approval queue)
 *      → enqueueDispatch → 调当前默认 adapter(env: CAMERA_BACKEND_KIND
 *        否则 mock)→ 写 dispatch_tasks 行
 *   4. 若 dispatch 返回 mediaUrls:processMediaFetchJob 拉到 OSS 写
 *      media_assets 行
 *   5. prediction → COMPLETED(retro 要求非 PROPOSED 状态)
 *   6. processRetrospectiveJob → runRetrospectiveAgent 真 LLM →
 *      写 retrospectives 行
 *
 * 用法:`bun scripts/verify-full-loop.ts [predictionId]`
 *   - 不传 ID:自动挑 conf>=70 且 status=PROPOSED 且 evidence>=3 的第一条
 *   - 传 ID:用指定 prediction(必须 PROPOSED)
 */
import { eq, sql } from 'drizzle-orm'
import { createDb } from '@/db/client'
import { predictions } from '@/db/schema/prediction'
import { dispatchTasks } from '@/db/schema/dispatch'
import { mediaAssets } from '@/db/schema/dispatch'
import { transitionStatus } from '@/modules/prediction/service'
import { processDispatchJob } from '@/scheduler/workers/dispatch'
import { processMediaFetchJob } from '@/scheduler/workers/media-fetch'
import { processRetrospectiveJob } from '@/scheduler/workers/retrospective'
import { getDefaultAdapterKey } from '@/dispatch/constants'

type Stamp = (label: string) => void
function makeStamp(): Stamp {
  const t0 = Date.now()
  return (label: string) => {
    const dt = Date.now() - t0
    console.log(`[+${(dt / 1000).toFixed(1)}s] ${label}`)
  }
}

async function pickPrediction(db: ReturnType<typeof createDb>['db'], cliArg: string | undefined) {
  if (cliArg) {
    const [p] = await db.select().from(predictions).where(eq(predictions.id, cliArg))
    if (!p) throw new Error(`prediction ${cliArg} not found`)
    if (p.status !== 'PROPOSED') throw new Error(`prediction ${cliArg} status=${p.status}, must be PROPOSED`)
    return p
  }
  // 自动挑 conf>=70 PROPOSED + evidence>=3
  const r = await db.execute<{ id: string }>(sql`
    SELECT p.id FROM predictions p
    WHERE p.status = 'PROPOSED' AND p.confidence_now >= 70
      AND (SELECT COUNT(*) FROM news_evidence ne WHERE ne.prediction_id = p.id) >= 3
    ORDER BY p.confidence_now DESC, p.window_date ASC
    LIMIT 1
  `)
  if ((r as unknown as Array<{ id: string }>).length === 0) {
    throw new Error('no high-conf PROPOSED prediction with ≥3 evidence found — run pipeline first')
  }
  const id = (r as unknown as Array<{ id: string }>)[0]!.id
  const [p] = await db.select().from(predictions).where(eq(predictions.id, id))
  return p!
}

async function main() {
  const arg = process.argv[2]
  const { db } = createDb('admin')
  const stamp = makeStamp()

  const p = await pickPrediction(db, arg)
  console.log()
  console.log(`━━━ 0) 选定 prediction [${p.id.slice(0, 8)}] ━━━`)
  console.log(`     status=${p.status}  conf=${p.confidenceNow}`)
  stamp('start')

  // 1. PROPOSED → VALIDATED
  console.log()
  console.log('━━━ 1) PROPOSED → VALIDATED (ANALYST 推送) ━━━')
  await transitionStatus(db, { predictionId: p.id, to: 'VALIDATED' })
  stamp('  ✓ status now VALIDATED')

  // 2. VALIDATED → APPROVED
  console.log()
  console.log('━━━ 2) VALIDATED → APPROVED (DECIDER 批准) ━━━')
  await transitionStatus(db, { predictionId: p.id, to: 'APPROVED' })
  stamp('  ✓ status now APPROVED')

  // 3. dispatch worker
  console.log()
  console.log('━━━ 3) dispatch worker (post-approval trigger 同步执行) ━━━')
  const adapterKey = getDefaultAdapterKey()
  console.log(`     adapter=${adapterKey}`)
  const disp = await processDispatchJob(db, { predictionId: p.id, adapterKey })
  stamp(`  ✓ dispatch task=${disp.dispatchId.slice(0, 8)}  externalId=${disp.externalId ?? '(none)'}`)

  // 4. 看 dispatch 当前状态 + mediaUrls(从 dispatch_results.payload_json 提取)
  const [dispRow] = await db.select().from(dispatchTasks).where(eq(dispatchTasks.id, disp.dispatchId))
  console.log(`     state=${dispRow?.state}`)
  const dispResultRows = await db.execute<{ payload_json: { mediaUrls?: string[] } | null }>(sql`
    SELECT payload_json FROM dispatch_results WHERE dispatch_id = ${disp.dispatchId}::uuid
  `)
  const dispResultArr = dispResultRows as unknown as Array<{ payload_json: { mediaUrls?: string[] } | null }>
  const payload = dispResultArr[0]?.payload_json
  const urls: string[] = (payload && Array.isArray(payload.mediaUrls)) ? payload.mediaUrls : []
  console.log(`     dispatch_results 行数:${dispResultArr.length}`)
  console.log(`     mediaUrls 数:${urls.length}`)

  // 5. 媒资拉取(若 adapter 返回了 URL)
  console.log()
  console.log('━━━ 4) media-fetch worker(仅当 adapter 返回 URL)━━━')
  if (urls.length === 0) {
    console.log('     ↪ adapter 未返回 mediaUrls,跳过(mock 默认就是这样)')
  } else {
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i]!
      try {
        const ma = await processMediaFetchJob(db, {
          dispatchId: disp.dispatchId, sourceUrl: u, mediaType: 'image',
        })
        stamp(`  ✓ media_asset=${ma.id.slice(0, 8)}  oss_uri=${ma.ossUri}`)
      } catch (err) {
        stamp(`  ✗ media-fetch ${i + 1}/${urls.length} 失败: ${(err as Error).message}`)
      }
    }
  }

  // 6. prediction → COMPLETED(retro 要求非 PROPOSED)
  console.log()
  console.log('━━━ 5) prediction → COMPLETED(retro 前置条件)━━━')
  await db.update(predictions).set({ status: 'COMPLETED', updatedAt: new Date() })
    .where(eq(predictions.id, p.id))
  stamp('  ✓ status now COMPLETED')

  // 7. retrospective
  console.log()
  console.log('━━━ 6) retrospective worker(真 LLM,~5-10s)━━━')
  try {
    const retro = await processRetrospectiveJob(db, { predictionId: p.id })
    stamp(`  ✓ retrospective=${retro.retrospectiveId.slice(0, 8)}  predOutcome=${retro.predictionOutcome}  capOutcome=${retro.captureOutcome}`)
  } catch (err) {
    stamp(`  ✗ retrospective 失败: ${(err as Error).message}`)
  }

  // 8. 末态 census
  console.log()
  console.log('━━━ 7) 末态校验 ━━━')
  const [pAfter] = await db.select().from(predictions).where(eq(predictions.id, p.id))
  const dispAfter = await db.select().from(dispatchTasks).where(eq(dispatchTasks.predictionId, p.id))
  const maAfter = await db.select().from(mediaAssets).where(
    sql`dispatch_id IN (SELECT id FROM dispatch_tasks WHERE prediction_id = ${p.id}::uuid)`,
  )
  const retroRows = await db.execute<{ id: string; prediction_outcome: string }>(sql`
    SELECT id, prediction_outcome FROM retrospectives WHERE prediction_id = ${p.id}::uuid
  `)

  console.log(`     prediction.status     = ${pAfter?.status}`)
  console.log(`     dispatch_tasks count  = ${dispAfter.length}`)
  console.log(`     media_assets count    = ${maAfter.length}`)
  console.log(`     retrospectives count  = ${retroRows.length}`)
  console.log()
  if (retroRows.length > 0) {
    console.log('✅ 全闭环走通!')
  } else {
    console.log('⚠ retrospective 未写入 — 看上面是不是 LLM 报错')
  }
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
