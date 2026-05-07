import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { authRequired, roleRequired, type AuthContext } from '@/auth/middleware'
import { logAudit } from '@/audit/log'
import { BadRequest, NotFound } from '@/lib/errors'
import { triggerDispatchAfterApproval } from '@/scheduler/triggers/post-approval'
import { dispatchTasks, mediaAssets, type DispatchTask, type MediaAsset } from '@/db/schema/dispatch'
import { requestCancel } from '@/dispatch/service'
import { writeConfidenceSnapshot } from './confidence'
import { getPrediction, getSnapshots, listPredictions, transitionStatus } from './service'

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
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined
    return c.json(await listPredictions(db, {
      ...(status ? { status: status as any } : {}),
      ...(limit ? { limit } : {}),
    }))
  })

  app.get('/:id', authRequired(db), async (c) => {
    const pred = await getPrediction(db, c.req.param('id'))
    if (!pred) throw NotFound(`prediction ${c.req.param('id')} not found`)
    const snaps = await getSnapshots(db, pred.id)

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

  // recompute-now — m2: enqueue full-recalc job (queue is stub) + audit log
  app.post('/:id/recompute-now', authRequired(db), roleRequired('ANALYST'), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const pred = await getPrediction(db, id)
    if (!pred) throw NotFound(`prediction ${id} not found`)
    // m2: BullMQ queue exists but no worker. Just log intent.
    console.log(`[prediction] recompute-now requested for ${id} (workers stubbed in m2)`)
    const recomputeEntry: import('@/audit/log').AuditEntry = {
      actorUserId: auth.user.id,
      targetKind: 'prediction', targetId: id, action: 'recompute_now_requested',
    }
    if (auth.activeRoleKey !== null) recomputeEntry.actorRoleKey = auth.activeRoleKey
    await logAudit(db, recomputeEntry)
    return c.json({ ok: true, message: 'recompute requested (m2 stub: queued only, worker pending)' })
  })

  return app
}
