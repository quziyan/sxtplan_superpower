import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { predictions } from './prediction'

export const dispatchStateEnum = pgEnum('dispatch_state', [
  'QUEUED', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'FAILED',
  'REJECTED_BY_ADAPTER', 'CANCEL_PENDING', 'CANCELLED', 'TIMED_OUT',
])

export const dispatchTasks = pgTable(
  'dispatch_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'restrict' }),
    adapterKey: text('adapter_key').notNull(), // 'mock' | 'gov-cam-gd-01' | ...
    externalId: text('external_id'),
    state: dispatchStateEnum('state').notNull().default('QUEUED'),
    paramsJson: jsonb('params_json').notNull().default(sql`'{}'::jsonb`),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    callbackAt: timestamp('callback_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    cost: text('cost'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dispatch_pred_idx').on(t.predictionId),
    index('dispatch_state_idx').on(t.state),
    index('dispatch_external_idx').on(t.adapterKey, t.externalId),
  ]
)

export const dispatchResults = pgTable(
  'dispatch_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispatchId: uuid('dispatch_id').notNull().references(() => dispatchTasks.id, { onDelete: 'cascade' }),
    payloadJson: jsonb('payload_json').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('result_dispatch_idx').on(t.dispatchId)]
)

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispatchId: uuid('dispatch_id').notNull().references(() => dispatchTasks.id, { onDelete: 'cascade' }),
    ossUri: text('oss_uri').notNull(),
    sourceUrl: text('source_url').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: integer('size_bytes'),
    sha256: text('sha256'),
    scanStatus: text('scan_status').notNull().default('PENDING'),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('media_dispatch_idx').on(t.dispatchId),
    index('media_scan_idx').on(t.scanStatus),
  ]
)

export type DispatchTask = typeof dispatchTasks.$inferSelect
export type NewDispatchTask = typeof dispatchTasks.$inferInsert
export type DispatchResult = typeof dispatchResults.$inferSelect
export type MediaAsset = typeof mediaAssets.$inferSelect
