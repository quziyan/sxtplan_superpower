import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const auditSchema = pgSchema('audit')

export const operationAudit = auditSchema.table('operation_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id'),
  actorRoleKey: text('actor_role_key'),
  targetKind: text('target_kind').notNull(),
  targetId: uuid('target_id'),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
})

export type OperationAudit = typeof operationAudit.$inferSelect
export type NewOperationAudit = typeof operationAudit.$inferInsert
