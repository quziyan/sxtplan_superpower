import type { Db } from '@/db/client'
import { operationAudit } from '@/db/schema/audit'

export type AuditEntry = {
  actorUserId?: string
  actorRoleKey?: string
  targetKind: string
  targetId?: string
  action: string
  before?: unknown
  after?: unknown
  reason?: string
}

export async function logAudit(db: Db, entry: AuditEntry) {
  await db.insert(operationAudit).values({
    actorUserId: entry.actorUserId ?? null,
    actorRoleKey: entry.actorRoleKey ?? null,
    targetKind: entry.targetKind,
    targetId: entry.targetId ?? null,
    action: entry.action,
    before: entry.before === undefined ? null : (entry.before as object),
    after: entry.after === undefined ? null : (entry.after as object),
    reason: entry.reason ?? null,
  })
}
