import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, roleRequired, type AuthContext } from '@/auth/middleware'
import { BadRequest, NotFound } from '@/lib/errors'
import {
  type CaptureOutcome,
  type PredictionOutcome,
  type RetrospectiveListFilter,
  getRetrospective,
  listRetrospectives,
  overrideRetrospective,
} from './service'

const PREDICTION_OUTCOMES = ['HIT', 'MISS', 'NO_DATA'] as const
const CAPTURE_OUTCOMES = ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN'] as const

const overrideSchema = z.object({
  newPredictionOutcome: z.enum(PREDICTION_OUTCOMES).optional(),
  newCaptureOutcome: z.enum(CAPTURE_OUTCOMES).optional(),
  reason: z.string().min(1),
})

type Vars = { auth: AuthContext }

function parseFilterFromQuery(q: Record<string, string>): RetrospectiveListFilter {
  const filter: RetrospectiveListFilter = {}
  if (q.predictionOutcome && (PREDICTION_OUTCOMES as readonly string[]).includes(q.predictionOutcome)) {
    filter.predictionOutcome = q.predictionOutcome as PredictionOutcome
  }
  if (q.captureOutcome && (CAPTURE_OUTCOMES as readonly string[]).includes(q.captureOutcome)) {
    filter.captureOutcome = q.captureOutcome as CaptureOutcome
  }
  if (q.overridden === 'true') filter.overridden = true
  else if (q.overridden === 'false') filter.overridden = false
  if (q.limit) {
    const n = Number.parseInt(q.limit, 10)
    if (Number.isFinite(n) && n > 0) filter.limit = Math.min(n, 200)
  }
  if (q.offset) {
    const n = Number.parseInt(q.offset, 10)
    if (Number.isFinite(n) && n >= 0) filter.offset = n
  }
  return filter
}

export function retrospectiveRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  // GET /retrospectives
  // ?predictionOutcome=HIT&captureOutcome=CAPTURED&overridden=true&limit=50&offset=0
  app.get('/', authRequired(db), async (c) => {
    const filter = parseFilterFromQuery(c.req.query())
    const items = await listRetrospectives(db, filter)
    return c.json({ ok: true, items })
  })

  // GET /retrospectives/:id
  app.get('/:id', authRequired(db), async (c) => {
    const id = c.req.param('id')
    const r = await getRetrospective(db, id)
    if (!r) throw NotFound(`retrospective ${id} not found`)
    return c.json({ ok: true, retrospective: r })
  })

  // POST /retrospectives/:id/override — REVIEWER (D-role) only
  // Body: { newPredictionOutcome?, newCaptureOutcome?, reason }
  app.post(
    '/:id/override',
    authRequired(db),
    roleRequired('REVIEWER'),
    zValidator('json', overrideSchema),
    async (c) => {
      const auth = c.get('auth')
      const id = c.req.param('id')
      const body = c.req.valid('json')

      // Defense-in-depth: zod min(1) catches empty reason, but trim-only
      // strings would slip through — guard explicitly.
      if (body.reason.trim().length === 0) {
        throw BadRequest('reason required')
      }
      if (!body.newPredictionOutcome && !body.newCaptureOutcome) {
        throw BadRequest('at least one new outcome required')
      }

      const overrideArgs: import('./service').OverrideInput = {
        retrospectiveId: id,
        reason: body.reason,
        reviewerUserId: auth.user.id,
      }
      if (body.newPredictionOutcome) overrideArgs.newPredictionOutcome = body.newPredictionOutcome
      if (body.newCaptureOutcome) overrideArgs.newCaptureOutcome = body.newCaptureOutcome
      if (auth.activeRoleKey !== null) overrideArgs.reviewerRoleKey = auth.activeRoleKey

      const updated = await overrideRetrospective(db, overrideArgs)
      return c.json({ ok: true, retrospective: updated })
    },
  )

  return app
}
