import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { operationAudit } from '@/db/schema/audit'
import { predictions } from '@/db/schema/prediction'
import { regions } from '@/db/schema/region'
import { retrospectives, type Retrospective } from '@/db/schema/retrospective'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { BadRequest, NotFound } from '@/lib/errors'

export type PredictionOutcome = 'HIT' | 'MISS' | 'NO_DATA'
export type CaptureOutcome = 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'

export type RetrospectiveListFilter = {
  predictionOutcome?: PredictionOutcome
  captureOutcome?: CaptureOutcome
  overridden?: boolean
  limit?: number
  offset?: number
}

export type RetrospectiveListItem = {
  id: string
  predictionId: string
  predictionOutcome: PredictionOutcome
  captureOutcome: CaptureOutcome
  composite: number
  outcomeOverridden: boolean
  generatedAt: Date
  prediction: {
    vehicleClass: string
    taskClass: string
    regionName: string | null
    windowDate: string
  }
}

export type RetrospectiveDetail = Retrospective & {
  prediction: {
    id: string
    vehicleClass: string
    taskClass: string
    regionName: string | null
    windowDate: string
    windowHalf: 'AM' | 'PM'
  }
}

/**
 * Plan-C T23 / ISC-31: 二轴 outcome matrix has two impossible cells —
 * CAPTURED requires HIT (you cannot capture if the prediction itself missed).
 * The DB enforces this via CHECK `outcome_capture_implies_hit`, but we
 * pre-validate in service so the API can return a clean 400 instead of a
 * Postgres constraint-violation error string.
 */
function isValidOutcomeCombination(
  predictionOutcome: PredictionOutcome,
  captureOutcome: CaptureOutcome,
): boolean {
  if (captureOutcome === 'CAPTURED' && predictionOutcome !== 'HIT') return false
  return true
}

function formatWindowDate(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export async function listRetrospectives(
  db: Db,
  filter: RetrospectiveListFilter = {},
): Promise<RetrospectiveListItem[]> {
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0

  const conds = []
  if (filter.predictionOutcome) {
    conds.push(eq(retrospectives.predictionOutcome, filter.predictionOutcome))
  }
  if (filter.captureOutcome) {
    conds.push(eq(retrospectives.captureOutcome, filter.captureOutcome))
  }
  if (typeof filter.overridden === 'boolean') {
    conds.push(eq(retrospectives.outcomeOverridden, filter.overridden))
  }

  // JOIN prediction → vehicleClass / taskClass / region (current region row).
  // regions is a versioned table with composite PK (id, version) — join on
  // both id AND version to pick the snapshot the prediction was made against.
  const baseQuery = db
    .select({
      id: retrospectives.id,
      predictionId: retrospectives.predictionId,
      predictionOutcome: retrospectives.predictionOutcome,
      captureOutcome: retrospectives.captureOutcome,
      composite: retrospectives.composite,
      outcomeOverridden: retrospectives.outcomeOverridden,
      generatedAt: retrospectives.generatedAt,
      vehicleClassName: vehicleClasses.name,
      taskClassName: taskClasses.name,
      regionName: regions.name,
      windowDate: predictions.windowDate,
    })
    .from(retrospectives)
    .innerJoin(predictions, eq(retrospectives.predictionId, predictions.id))
    .innerJoin(vehicleClasses, eq(predictions.vehicleClassId, vehicleClasses.id))
    .innerJoin(taskClasses, eq(predictions.taskClassId, taskClasses.id))
    .leftJoin(
      regions,
      and(eq(regions.id, predictions.regionId), eq(regions.version, predictions.regionVersion)),
    )

  const filtered = conds.length > 0 ? baseQuery.where(and(...conds)) : baseQuery
  const rows = await filtered
    .orderBy(desc(retrospectives.generatedAt))
    .limit(limit)
    .offset(offset)

  return rows.map((r) => ({
    id: r.id,
    predictionId: r.predictionId,
    predictionOutcome: r.predictionOutcome as PredictionOutcome,
    captureOutcome: r.captureOutcome as CaptureOutcome,
    composite: r.composite,
    outcomeOverridden: r.outcomeOverridden,
    generatedAt: r.generatedAt,
    prediction: {
      vehicleClass: r.vehicleClassName,
      taskClass: r.taskClassName,
      regionName: r.regionName,
      windowDate: formatWindowDate(r.windowDate),
    },
  }))
}

export async function getRetrospective(db: Db, id: string): Promise<RetrospectiveDetail | null> {
  const [row] = await db
    .select({
      retro: retrospectives,
      predictionId: predictions.id,
      vehicleClassName: vehicleClasses.name,
      taskClassName: taskClasses.name,
      regionName: regions.name,
      windowDate: predictions.windowDate,
      windowHalf: predictions.windowHalf,
    })
    .from(retrospectives)
    .innerJoin(predictions, eq(retrospectives.predictionId, predictions.id))
    .innerJoin(vehicleClasses, eq(predictions.vehicleClassId, vehicleClasses.id))
    .innerJoin(taskClasses, eq(predictions.taskClassId, taskClasses.id))
    .leftJoin(
      regions,
      and(eq(regions.id, predictions.regionId), eq(regions.version, predictions.regionVersion)),
    )
    .where(eq(retrospectives.id, id))
    .limit(1)

  if (!row) return null

  return {
    ...row.retro,
    prediction: {
      id: row.predictionId,
      vehicleClass: row.vehicleClassName,
      taskClass: row.taskClassName,
      regionName: row.regionName,
      windowDate: formatWindowDate(row.windowDate),
      windowHalf: row.windowHalf as 'AM' | 'PM',
    },
  }
}

export type OverrideInput = {
  retrospectiveId: string
  newPredictionOutcome?: PredictionOutcome
  newCaptureOutcome?: CaptureOutcome
  reason: string
  reviewerUserId: string
  reviewerRoleKey?: string
}

/**
 * Plan-C T23 / ISC-31: D-role override.
 *
 * Atomicity contract: the retrospective UPDATE and the audit-log INSERT
 * MUST land in the same transaction so we never lose the audit trail
 * when the row mutates. If either side fails the whole change rolls back.
 */
export async function overrideRetrospective(
  db: Db,
  input: OverrideInput,
): Promise<RetrospectiveDetail> {
  if (!input.newPredictionOutcome && !input.newCaptureOutcome) {
    throw BadRequest('at least one of newPredictionOutcome or newCaptureOutcome required')
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw BadRequest('reason required for override')
  }

  // Load existing row first — avoid touching the transaction for a 404.
  const [existing] = await db
    .select()
    .from(retrospectives)
    .where(eq(retrospectives.id, input.retrospectiveId))
    .limit(1)
  if (!existing) {
    throw NotFound(`retrospective ${input.retrospectiveId} not found`)
  }

  // Resolve final outcome combo and pre-validate against the 二轴 rule.
  // This mirrors the DB CHECK so the user gets a clean BadRequest message
  // instead of a raw Postgres constraint-violation error.
  const finalPredictionOutcome: PredictionOutcome =
    input.newPredictionOutcome ?? (existing.predictionOutcome as PredictionOutcome)
  const finalCaptureOutcome: CaptureOutcome =
    input.newCaptureOutcome ?? (existing.captureOutcome as CaptureOutcome)
  if (!isValidOutcomeCombination(finalPredictionOutcome, finalCaptureOutcome)) {
    throw BadRequest('CAPTURED implies HIT; invalid outcome combination')
  }

  await db.transaction(async (tx) => {
    await tx
      .update(retrospectives)
      .set({
        predictionOutcome: finalPredictionOutcome,
        captureOutcome: finalCaptureOutcome,
        outcomeOverridden: true,
        overriddenReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(retrospectives.id, input.retrospectiveId))

    const auditValues = {
      actorUserId: input.reviewerUserId,
      actorRoleKey: input.reviewerRoleKey ?? null,
      targetKind: 'retrospective',
      targetId: input.retrospectiveId,
      action: 'RETROSPECTIVE_OVERRIDE',
      before: {
        predictionOutcome: existing.predictionOutcome,
        captureOutcome: existing.captureOutcome,
        outcomeOverridden: existing.outcomeOverridden,
      },
      after: {
        predictionOutcome: finalPredictionOutcome,
        captureOutcome: finalCaptureOutcome,
        outcomeOverridden: true,
      },
      reason: input.reason,
    }
    await tx.insert(operationAudit).values(auditValues)
  })

  const updated = await getRetrospective(db, input.retrospectiveId)
  if (!updated) {
    // Should be impossible — we just updated it inside a successful txn.
    throw new Error(`retrospective ${input.retrospectiveId} disappeared after override`)
  }
  return updated
}

