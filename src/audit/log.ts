import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { Db } from '@/db/client'
import { operationAudit } from '@/db/schema/audit'

// 联合类型 — logAudit 既接受顶层 Db 句柄,也接受事务句柄,
// 让上游业务可在 db.transaction(...) 内复用同一行 audit 写入。
// biome-ignore lint/suspicious/noExplicitAny: drizzle PgTransaction generics are not load-bearing here
export type DbOrTx = Db | PgTransaction<any, any, any>

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

export async function logAudit(dbOrTx: DbOrTx, entry: AuditEntry) {
  await dbOrTx.insert(operationAudit).values({
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
