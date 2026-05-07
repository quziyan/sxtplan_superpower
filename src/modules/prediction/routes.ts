import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, roleRequired, type AuthContext } from '@/auth/middleware'
import { logAudit } from '@/audit/log'
import { BadRequest, NotFound } from '@/lib/errors'
import { writeConfidenceSnapshot } from './confidence'
import { getPrediction, getSnapshots, listPredictions, transitionStatus } from './service'

const manualConfSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  reason: z.string().min(3),
  ciLow: z.number().int().min(0).max(100).optional(),
  ciHigh: z.number().int().min(0).max(100).optional(),
})

type Vars = { auth: AuthContext }

export function predictionRoutes(db: Db) {
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
    return c.json({ prediction: pred, snapshots: snaps })
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
