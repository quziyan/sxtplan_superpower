import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { authRequired, roleRequired, type AuthContext } from '@/auth/middleware'
import { logAudit } from '@/audit/log'
import { BadRequest, NotFound } from '@/lib/errors'
import { triggerDispatchAfterApproval } from '@/scheduler/triggers/post-approval'
import { fullRecalcQueue, newsTriageQueue, refreshQueue } from '@/scheduler/queue'
import { tickNewsIngest } from '@/scheduler/workers/news-ingest'
import { dispatchTasks, mediaAssets, type DispatchTask, type MediaAsset } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { requestCancel } from '@/dispatch/service'
import { writeConfidenceSnapshot } from './confidence'
import { getPrediction, getSnapshots, getNewsEvidence, getNewsByIds, listPredictions, transitionStatus } from './service'
import { runNewsExtractAgent } from '@/agents/news-extract-agent'
import { newsExtractQueue } from '@/scheduler/queue'
import { watchLists } from '@/db/schema/watchlist'

const manualConfSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  reason: z.string().min(3),
  ciLow: z.number().int().min(0).max(100).optional(),
  ciHigh: z.number().int().min(0).max(100).optional(),
})

type Vars = { auth: AuthContext }

/**
 * Optional dependency-injection seam for the route module. The post-
 * approval trigger fires the dispatch queue job; tests inject a mock to
 * verify the trigger fires (and to avoid hitting Redis). Production
 * callers omit and the default `triggerDispatchAfterApproval` is used.
 */
export type PredictionRouteDeps = {
  triggerDispatchAfterApproval?: (predictionId: string) => Promise<void>
}

export function predictionRoutes(db: Db, deps: PredictionRouteDeps = {}) {
  const triggerDispatch = deps.triggerDispatchAfterApproval ?? triggerDispatchAfterApproval
  const app = new Hono<{ Variables: Vars }>()

  app.get('/', authRequired(db), async (c) => {
    const status = c.req.query('status')
    const limitParam = c.req.query('limit')
    // Schedule tab: limit cap 500(月视图可能需要)
    const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10), 500) : undefined
    // Plan-C T33 / ISC-41: opt-in `?include=latest_snapshot` — default off
    // so existing callers (and the prior 304-test contract) stay unchanged.
    // Comma-separated tokens for forward-compat (future: ?include=foo,bar).
    const includeRaw = c.req.query('include') ?? ''
    const includeTokens = includeRaw.split(',').map((t) => t.trim()).filter(Boolean)
    const includeLatestSnapshot = includeTokens.includes('latest_snapshot')
    // Schedule tab: include=names → inline V/T/region/source names
    const includeNames = includeTokens.includes('names')
    // m5 UI:?has_evidence=true 只返回有证据的 prediction
    const hasEvidence = c.req.query('has_evidence') === 'true'
    // Schedule tab:?from=YYYY-MM-DD&to=YYYY-MM-DD 过滤 windowDate
    const fromRaw = c.req.query('from')
    const toRaw = c.req.query('to')
    if (fromRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
      throw BadRequest(`from must be YYYY-MM-DD, got ${fromRaw}`)
    }
    if (toRaw && !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      throw BadRequest(`to must be YYYY-MM-DD, got ${toRaw}`)
    }
    return c.json(await listPredictions(db, {
      ...(status ? { status: status as any } : {}),
      ...(limit ? { limit } : {}),
      ...(includeLatestSnapshot ? { includeLatestSnapshot: true } : {}),
      ...(includeNames ? { includeNames: true } : {}),
      ...(hasEvidence ? { hasEvidence: true } : {}),
      ...(fromRaw ? { from: fromRaw } : {}),
      ...(toRaw ? { to: toRaw } : {}),
    }))
  })

  app.get('/:id', authRequired(db), async (c) => {
    const pred = await getPrediction(db, c.req.param('id'))
    if (!pred) throw NotFound(`prediction ${c.req.param('id')} not found`)
    const snaps = await getSnapshots(db, pred.id)
    // m5 UI 改进:inline news_evidence 关联的新闻原文(标题+摘要+URL)
    const evidence = await getNewsEvidence(db, pred.id)
    // m5 UI v2: 还把 snapshots 里 evidenceIds 引用的新闻打成 lookup map,前端按
    // snapshot 分组展示证据链接 + 着色(新引用 vs 复用)。
    const allEvidenceIds = new Set<string>()
    for (const s of snaps) {
      const ids = (s.evidenceIds as string[] | null) ?? []
      for (const id of ids) allEvidenceIds.add(id)
    }
    const newsById = await getNewsByIds(db, Array.from(allEvidenceIds))

    // Plan-C T27 / ISC-35: inline dispatchTasks (with nested mediaAssets)
    // alongside the prediction detail. One round trip from the UI for the
    // detail view; avoids a separate /dispatches/:id/media fanout. Media
    // is loaded with a single IN(...) query and grouped in JS to avoid N+1.
    const dispatches = await db
      .select()
      .from(dispatchTasks)
      .where(eq(dispatchTasks.predictionId, pred.id))
      .orderBy(asc(dispatchTasks.createdAt))

    const dispatchIds = dispatches.map((d) => d.id)
    const mediaByDispatch = new Map<string, MediaAsset[]>()
    if (dispatchIds.length > 0) {
      const allMedia = await db
        .select()
        .from(mediaAssets)
        .where(inArray(mediaAssets.dispatchId, dispatchIds))
        .orderBy(asc(mediaAssets.createdAt))
      for (const m of allMedia) {
        const bucket = mediaByDispatch.get(m.dispatchId)
        if (bucket) bucket.push(m)
        else mediaByDispatch.set(m.dispatchId, [m])
      }
    }

    const dispatchTasksOut: Array<DispatchTask & { mediaAssets: MediaAsset[] }> =
      dispatches.map((d) => ({ ...d, mediaAssets: mediaByDispatch.get(d.id) ?? [] }))

    return c.json({
      prediction: pred,
      snapshots: snaps,
      dispatchTasks: dispatchTasksOut,
      evidence,
      newsById,
    })
  })

  app.post('/:id/approve', authRequired(db), roleRequired('DECIDER'), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const before = await getPrediction(db, id)
    if (!before) throw NotFound(`prediction ${id} not found`)
    const after = await transitionStatus(db, { predictionId: id, to: 'APPROVED' })
    const approveEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'approve',
      before: { status: before.status }, after: { status: after.status },
    }
    if (auth.activeRoleKey !== null) approveEntry.actorRoleKey = auth.activeRoleKey
    await logAudit(db, approveEntry)
    // Plan-C T16 / ISC-24: fire post-approval dispatch trigger asynchronously.
    // Wrapped in try/catch so a queue/Redis hiccup does NOT poison the
    // approve response — the prediction is already APPROVED in the DB,
    // and the dispatch job can be retried out-of-band.
    try {
      await triggerDispatch(id)
    } catch (err) {
      console.error(`[prediction] post-approval dispatch trigger failed for ${id}:`, err)
    }
    return c.json({ ok: true, prediction: after })
  })

  app.post('/:id/reject', authRequired(db), roleRequired('DECIDER'), zValidator('json', z.object({ reason: z.string().optional() })), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const before = await getPrediction(db, id)
    if (!before) throw NotFound(`prediction ${id} not found`)
    const after = await transitionStatus(db, { predictionId: id, to: 'REJECTED' })
    const rejectEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'reject',
      before: { status: before.status }, after: { status: after.status },
    }
    if (auth.activeRoleKey !== null) rejectEntry.actorRoleKey = auth.activeRoleKey
    const rejReason = c.req.valid('json').reason
    if (rejReason !== undefined) rejectEntry.reason = rejReason
    await logAudit(db, rejectEntry)
    return c.json({ ok: true, prediction: after })
  })

  // F:决策者「打回重审」VALIDATED → PROPOSED,分析师可重新审完再推。reason 必须 ≥ 4 字。
  app.post('/:id/send-back', authRequired(db),
    roleRequired('DECIDER'),
    zValidator('json', z.object({ reason: z.string().min(4).max(500) })),
    async (c) => {
      const auth = c.get('auth')
      const id = c.req.param('id')
      const before = await getPrediction(db, id)
      if (!before) throw NotFound(`prediction ${id} not found`)
      const after = await transitionStatus(db, { predictionId: id, to: 'PROPOSED' })
      const sendBackEntry: import('@/audit/log').AuditEntry = {
        actorUserId: auth.user.id,
        targetKind: 'prediction', targetId: id, action: 'send_back',
        before: { status: before.status }, after: { status: after.status },
        reason: c.req.valid('json').reason,
      }
      if (auth.activeRoleKey !== null) sendBackEntry.actorRoleKey = auth.activeRoleKey
      await logAudit(db, sendBackEntry)
      return c.json({ ok: true, prediction: after })
    },
  )

  // ANALYST 可删除自己工作台上的 PROPOSED prediction(agent 推的不合理项)。
  // 硬删 + cascade(snapshots / news_evidence / retrospectives 级联);
  // dispatch_tasks RESTRICT 拦截 — PROPOSED 状态下不该有 dispatch。
  // 审计:action='delete' before={status, V/T/region/window} 留档。
  app.delete('/:id', authRequired(db), roleRequired('ANALYST'), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const before = await getPrediction(db, id)
    if (!before) throw NotFound(`prediction ${id} not found`)
    if (before.status !== 'PROPOSED') {
      throw BadRequest(`only PROPOSED prediction can be deleted; current status=${before.status}`)
    }
    // 拿快照后再删,审计 before 字段有内容
    await db.delete(predictions).where(eq(predictions.id, id))
    const deleteEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'delete',
      before: {
        status: before.status,
        vehicleClassId: before.vehicleClassId,
        taskClassId: before.taskClassId,
        regionId: before.regionId,
        windowDate: before.windowDate,
        windowHalf: before.windowHalf,
        confidenceNow: before.confidenceNow,
      },
    }
    if (auth.activeRoleKey !== null) deleteEntry.actorRoleKey = auth.activeRoleKey
    await logAudit(db, deleteEntry)
    return c.json({ ok: true, deletedId: id })
  })

  // ANALYST 编辑 PROPOSED prediction 的窗口(windowDate / windowHalf)。
  // 改后 kDays 重算 = max(0, floor((windowDate - today) / 86400))。
  // V/T/region 不允许改(那是新预测,该删了重建)。
  const patchPredictionSchema = z.object({
    windowDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    windowHalf: z.enum(['AM', 'PM']).optional(),
  }).refine((b) => b.windowDate !== undefined || b.windowHalf !== undefined,
    { message: 'at least one of windowDate, windowHalf required' })

  app.patch('/:id', authRequired(db),
    roleRequired('ANALYST'),
    zValidator('json', patchPredictionSchema),
    async (c) => {
      const auth = c.get('auth')
      const id = c.req.param('id')
      const body = c.req.valid('json')
      const before = await getPrediction(db, id)
      if (!before) throw NotFound(`prediction ${id} not found`)
      if (before.status !== 'PROPOSED') {
        throw BadRequest(`only PROPOSED prediction can be edited; current status=${before.status}`)
      }
      const newWindowDate = body.windowDate ? new Date(body.windowDate + 'T00:00:00Z') : before.windowDate
      const newWindowHalf = body.windowHalf ?? before.windowHalf
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const newKDays = Math.max(0, Math.floor((newWindowDate.getTime() - today.getTime()) / 86_400_000))
      const newExpiresAt = new Date(newWindowDate.getTime() + 10 * 86_400_000)

      const [updated] = await db.update(predictions)
        .set({
          windowDate: newWindowDate,
          windowHalf: newWindowHalf,
          kDays: newKDays,
          expiresAt: newExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(predictions.id, id))
        .returning()
      if (!updated) throw new Error('update returned no rows')

      const editEntry: import('@/audit/log').AuditEntry = {
        actorUserId: auth.user.id,
        targetKind: 'prediction', targetId: id, action: 'edit',
        before: { windowDate: before.windowDate, windowHalf: before.windowHalf, kDays: before.kDays },
        after: { windowDate: updated.windowDate, windowHalf: updated.windowHalf, kDays: updated.kDays },
      }
      if (auth.activeRoleKey !== null) editEntry.actorRoleKey = auth.activeRoleKey
      await logAudit(db, editEntry)
      return c.json({ ok: true, prediction: updated })
    },
  )

  // (β) m5 UI 对齐:ANALYST 把 PROPOSED 推送到 VALIDATED,DECIDER 工作台只看 VALIDATED。
  // 状态机 PROPOSED → VALIDATED;BC 保留 PROPOSED → APPROVED/REJECTED 路径。
  app.post('/:id/validate', authRequired(db), roleRequired('ANALYST'), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const before = await getPrediction(db, id)
    if (!before) throw NotFound(`prediction ${id} not found`)
    const after = await transitionStatus(db, { predictionId: id, to: 'VALIDATED' })
    const validateEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'validate',
      before: { status: before.status }, after: { status: after.status },
    }
    if (auth.activeRoleKey !== null) validateEntry.actorRoleKey = auth.activeRoleKey
    await logAudit(db, validateEntry)
    return c.json({ ok: true, prediction: after })
  })

  // (β) 「📡 生成预测」按钮新后端 — 单个 active watchlist 一轮:
  //   ① 拉新闻(scoped tickNewsIngest,使用 settings.news_freshness_days 窗口)
  //   ② 同步 drain extract(每条新 news 跑 LLM,**并发 3** 加速)
  //   ③ createPredictionFromNews 幂等合并(已存在 → 加 evidence + 新 snap + max conf)
  // 所有 prediction 必带 news_evidence(三表原子写),贯彻 #1 原则。
  // 前端按 active watchlist 列表串行调此路由,每条返后展示进度;多 wl 整体
  // 时长被前端进度条吸收,UX 不再「卡住」。
  const SPAWN_EXTRACT_CONCURRENCY = 3

  app.post('/spawn-from-news/:watchlistId', authRequired(db),
    roleRequired('ANALYST'),
    async (c) => {
      const auth = c.get('auth')
      const watchlistId = c.req.param('watchlistId')
      const [wl] = await db.select().from(watchLists).where(eq(watchLists.id, watchlistId))
      if (!wl) throw NotFound(`watchlist ${watchlistId} not found`)
      if (!wl.isActive) {
        return c.json({
          ok: true, watchlistId, name: wl.name,
          newsFetched: 0, newsInserted: 0, extractAttempted: 0,
          predictionsCreated: 0, predictionsMerged: 0, llmDegraded: 0,
          skipped: true, reason: 'inactive',
        })
      }

      // 步骤 ①:scoped 抓新闻
      const ingest = await tickNewsIngest({
        db,
        triageQueue: newsTriageQueue,
        extractQueue: newsExtractQueue,
        onlyWatchlistId: wl.id,
      })

      // Plan-PP step 3:extract 用 rerankedHits(SearchHit)直接调,不再依赖
      // ingest 的 newsId — extract 内部需要 newsId 时会 ingestHit 自助 find-or-create。
      // 这样 extract 与 ingest 在概念上独立(虽然 tickNewsIngest 已经同步跑过 ingest stage)。
      const tExtract0 = performance.now()
      let created = 0, merged = 0, llmDegraded = 0, extractAttempted = 0
      for (let i = 0; i < ingest.rerankedHits.length; i += SPAWN_EXTRACT_CONCURRENCY) {
        const batch = ingest.rerankedHits.slice(i, i + SPAWN_EXTRACT_CONCURRENCY)
        const results = await Promise.all(batch.map(async ({ hit }) => {
          try {
            return await runNewsExtractAgent(db, { hit, userId: auth.user.id })
          } catch (err) {
            console.warn(`[spawn-from-news] extract failed for url=${hit.url}:`, (err as Error).message)
            return null
          }
        }))
        for (const r of results) {
          extractAttempted++
          if (r === null) continue
          created += r.created
          merged += r.merged
          if (r.llmDegraded) llmDegraded++
        }
      }
      const tExtract1 = performance.now()

      // Plan-PP step 5:extract.in 改为 rerankedHits 长度(实际跑 LLM 的条数,
      // 而非 ingest 后的 newsId 数)— 反映"抽取不被入库去重阻塞"语义
      const stages = [...ingest.stages, {
        name: 'extract' as const,
        watchlistName: wl.name,
        in: ingest.rerankedHits.length,
        out: created + merged,
        durationMs: Math.round(tExtract1 - tExtract0),
        params: { concurrency: SPAWN_EXTRACT_CONCURRENCY, attempted: extractAttempted, llmDegraded },
        dropped: [],
        kept: [],
      }]

      return c.json({
        ok: true,
        watchlistId: wl.id,
        name: wl.name,
        newsFetched: ingest.newsFetched,
        newsInserted: ingest.newsInserted,
        extractAttempted,
        predictionsCreated: created,
        predictionsMerged: merged,
        llmDegraded,
        stages,
      })
    },
  )

  // 旧 batch 路由 — 内部循环调上面 per-wl 服务函数;保留作 BC,前端不再用。
  app.post('/spawn-from-news', authRequired(db),
    roleRequired('ANALYST'),
    async (c) => {
      const auth = c.get('auth')
      const active = await db.select().from(watchLists).where(eq(watchLists.isActive, true))
      const summary = {
        watchlistsProcessed: 0, newsFetched: 0, newsInserted: 0,
        extractAttempted: 0, predictionsCreated: 0, predictionsMerged: 0,
        llmDegraded: 0, errors: 0,
        perWatchlist: [] as Array<{
          watchlistId: string; name: string
          newsFetched: number; newsInserted: number; extracted: number
          created: number; merged: number; error?: string
          stages?: import('@/scheduler/workers/news-ingest').StageTrace[]
        }>,
      }
      for (const wl of active) {
        const wlReport: typeof summary.perWatchlist[number] = {
          watchlistId: wl.id, name: wl.name,
          newsFetched: 0, newsInserted: 0, extracted: 0, created: 0, merged: 0,
        }
        try {
          const ingest = await tickNewsIngest({
            db, triageQueue: newsTriageQueue, extractQueue: newsExtractQueue,
            onlyWatchlistId: wl.id,
          })
          wlReport.newsFetched = ingest.newsFetched
          wlReport.newsInserted = ingest.newsInserted
          summary.newsFetched += ingest.newsFetched
          summary.newsInserted += ingest.newsInserted
          const tExtract0 = performance.now()
          let llmDegradedHere = 0
          // Plan-PP step 3:用 rerankedHits(SearchHit)而非 processedNewsIds
          for (let i = 0; i < ingest.rerankedHits.length; i += SPAWN_EXTRACT_CONCURRENCY) {
            const batch = ingest.rerankedHits.slice(i, i + SPAWN_EXTRACT_CONCURRENCY)
            const results = await Promise.all(batch.map(async ({ hit }) => {
              try { return await runNewsExtractAgent(db, { hit, userId: auth.user.id }) }
              catch { return null }
            }))
            for (const r of results) {
              wlReport.extracted++; summary.extractAttempted++
              if (r === null) continue
              wlReport.created += r.created; wlReport.merged += r.merged
              summary.predictionsCreated += r.created; summary.predictionsMerged += r.merged
              if (r.llmDegraded) { summary.llmDegraded++; llmDegradedHere++ }
            }
          }
          const tExtract1 = performance.now()
          wlReport.stages = [...ingest.stages, {
            name: 'extract' as const,
            watchlistName: wl.name,
            in: ingest.rerankedHits.length,
            out: wlReport.created + wlReport.merged,
            durationMs: Math.round(tExtract1 - tExtract0),
            params: {
              concurrency: SPAWN_EXTRACT_CONCURRENCY,
              attempted: wlReport.extracted,
              llmDegraded: llmDegradedHere,
            },
            dropped: [],
            kept: [],
          }]
          summary.watchlistsProcessed++
        } catch (err) {
          wlReport.error = (err as Error).message
          summary.errors++
        }
        summary.perWatchlist.push(wlReport)
      }
      return c.json({ ok: true, ...summary })
    },
  )

  app.post('/:id/manual-confidence', authRequired(db), roleRequired('ANALYST'), zValidator('json', manualConfSchema), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const before = await getPrediction(db, id)
    if (!before) throw NotFound(`prediction ${id} not found`)
    if (body.ciLow !== undefined && body.ciHigh !== undefined && body.ciLow > body.ciHigh) {
      throw BadRequest('ciLow must be <= ciHigh')
    }
    const snapInput: import('./confidence').WriteConfidenceSnapshotInput = {
      predictionId: id, kind: 'MANUAL', confidence: body.confidence,
      reasoning: body.reason, operator: auth.user.id,
    }
    if (body.ciLow !== undefined) snapInput.ciLow = body.ciLow
    if (body.ciHigh !== undefined) snapInput.ciHigh = body.ciHigh
    const snap = await writeConfidenceSnapshot(db, snapInput)
    const manualEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'manual_confidence',
      before: { confidenceNow: before.confidenceNow }, after: { confidenceNow: body.confidence },
      reason: body.reason,
    }
    if (auth.activeRoleKey !== null) manualEntry.actorRoleKey = auth.activeRoleKey
    await logAudit(db, manualEntry)
    return c.json({ ok: true, snapshot: snap })
  })

  // Plan-C T24 / ISC-32: full cancellation flow.
  //
  // Lookup the most recent active dispatch (state in QUEUED/SENT/IN_PROGRESS)
  // for the prediction, then call requestCancel — which persists CANCEL_PENDING
  // + asks the adapter to cancel. The actual CANCELLED transition lands when
  // the backend posts the cancellation webhook (T18 path).
  //
  // Auth: ANALYST or DECIDER may trigger a cancel. The audit log captures the
  // actor + role + reason atomically with the route response.
  app.post(
    '/:id/cancel',
    authRequired(db),
    roleRequired('ANALYST', 'DECIDER'),
    zValidator('json', z.object({ reason: z.string().min(1) })),
    async (c) => {
      const auth = c.get('auth')
      const predictionId = c.req.param('id')
      const { reason } = c.req.valid('json')
      // Most recent dispatch in a cancellable state; deterministic ordering by
      // createdAt DESC so a re-dispatched task (m4 territory) is preferred.
      const [active] = await db
        .select()
        .from(dispatchTasks)
        .where(
          and(
            eq(dispatchTasks.predictionId, predictionId),
            inArray(dispatchTasks.state, ['QUEUED', 'SENT', 'IN_PROGRESS']),
          ),
        )
        .orderBy(desc(dispatchTasks.createdAt))
        .limit(1)
      if (!active) throw NotFound(`no active dispatch to cancel for prediction ${predictionId}`)
      try {
        const updated = await requestCancel(db, active.id, reason)
        const cancelEntry: import('@/audit/log').AuditEntry = {
          actorUserId: auth.user.id,
          targetKind: 'dispatch',
          targetId: active.id,
          action: 'dispatch_cancel',
          before: { state: active.state },
          after: { state: updated.state },
          reason,
        }
        if (auth.activeRoleKey !== null) cancelEntry.actorRoleKey = auth.activeRoleKey
        await logAudit(db, cancelEntry)
        return c.json({ ok: true, dispatch: updated })
      } catch (e) {
        // Surface state-machine + concurrency errors as 400 — the dispatch is
        // in a state where cancel can't proceed. Adapter errors are swallowed
        // inside requestCancel and never reach here.
        // 400 covers future state additions to active lookup that fail canTransition;
        // currently unreachable since QUEUED/SENT/IN_PROGRESS all permit CANCEL_PENDING.
        throw BadRequest((e as Error).message)
      }
    },
  )

  // recompute-now — Plan-E G5 / m5: dual-mode (FULL P5 manual / optional INCR).
  //
  // Default body (or no body) → enqueues a full-recalc job with
  // `manualTrigger=true`, which short-circuits the priority gate to P5
  // inside `processFullRecalcJob` → `shouldTriggerFull`.
  //
  // `{kind:"INCR", newEvidenceNewsIds:[...]}` → enqueues a refresh job on
  // the INCR path with the supplied evidence ids. INCR without
  // `newEvidenceNewsIds` is rejected as 400 (the worker has no new
  // evidence to fold in).
  const recomputeNowSchema = z.object({
    kind: z.enum(['FULL', 'INCR']).optional(),
    newEvidenceNewsIds: z.array(z.string().uuid()).optional(),
  }).optional()

  app.post(
    '/:id/recompute-now',
    authRequired(db),
    roleRequired('ANALYST'),
    zValidator('json', recomputeNowSchema),
    async (c) => {
      const auth = c.get('auth')
      const id = c.req.param('id')
      const pred = await getPrediction(db, id)
      if (!pred) throw NotFound(`prediction ${id} not found`)
      const body = c.req.valid('json')

      const recomputeEntry: import('@/audit/log').AuditEntry = {
        actorUserId: auth.user.id,
        targetKind: 'prediction', targetId: id, action: 'recompute_now_requested',
      }
      if (auth.activeRoleKey !== null) recomputeEntry.actorRoleKey = auth.activeRoleKey

      if (body?.kind === 'INCR') {
        if (!body.newEvidenceNewsIds || body.newEvidenceNewsIds.length === 0) {
          return c.json(
            { error: { code: 'BAD_REQUEST', message: 'newEvidenceNewsIds required for INCR mode' } },
            400,
          )
        }
        await refreshQueue.add('incr', {
          predictionId: id,
          kind: 'INCR',
          newEvidenceNewsIds: body.newEvidenceNewsIds,
        })
        recomputeEntry.reason = `INCR with ${body.newEvidenceNewsIds.length} news ids`
        await logAudit(db, recomputeEntry)
        return c.json({ ok: true, mode: 'INCR' as const, message: 'enqueued INCR refresh' })
      }

      // m5 UI 改进:Default 模式不只 FULL 重评估,**同时拉新闻**(用户预期"重算"=
      // fetch fresh news + reason)。如果 prediction 关联了 watchlist,scoped 跑一次
      // tickNewsIngest 抓最新新闻 → matcher → 入 triageQueue(异步 LLM 评分,HIGH 自动
      // 触发 INCR refresh)。同时仍然 enqueue fullRecalc → P5 → refresh.FULL 让 LLM
      // 在最新证据池上重做 FULL 评估。
      let ingestSummary: { fetched: number; inserted: number; triaged: number } | null = null
      if (pred.sourceKind === 'WATCHLIST' && pred.sourceId) {
        try {
          const r = await tickNewsIngest({
            db,
            triageQueue: newsTriageQueue,
            onlyWatchlistId: pred.sourceId,
          })
          ingestSummary = {
            fetched: r.newsFetched,
            inserted: r.newsInserted,
            triaged: r.triageJobsEnqueued,
          }
        } catch (e) {
          console.warn(`[recompute-now] inline newsIngest failed for pred=${id}: ${(e as Error).message}`)
        }
      }
      await fullRecalcQueue.add('full-recalc', { predictionId: id, manualTrigger: true })
      recomputeEntry.reason = ingestSummary
        ? `FULL P5 manual + scoped newsIngest (fetched=${ingestSummary.fetched}, inserted=${ingestSummary.inserted}, triaged=${ingestSummary.triaged})`
        : 'FULL P5 manual trigger'
      await logAudit(db, recomputeEntry)
      return c.json({
        ok: true,
        mode: 'FULL' as const,
        message: ingestSummary
          ? `enqueued full-recalc + 拉了 ${ingestSummary.fetched} 条新闻(${ingestSummary.inserted} 新),${ingestSummary.triaged} 个 triage 异步评分`
          : 'enqueued full-recalc',
        ingestSummary,
      })
    },
  )

  return app
}
