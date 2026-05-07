import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const predictionStatusEnum = pgEnum('prediction_status', [
  'PROPOSED', 'APPROVED', 'REJECTED', 'DISPATCHED', 'EXPIRED', 'COMPLETED',
])

export const predictionSourceEnum = pgEnum('prediction_source', ['WATCHLIST', 'TASKCARD'])

export const halfDayEnum = pgEnum('half_day', ['AM', 'PM'])

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceKind: predictionSourceEnum('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    regionId: uuid('region_id').notNull(),
    regionVersion: integer('region_version').notNull(),
    windowDate: timestamp('window_date', { withTimezone: false, mode: 'date' }).notNull(),
    windowHalf: halfDayEnum('window_half').notNull(),
    vehicleClassId: uuid('vehicle_class_id').notNull(),
    taskClassId: uuid('task_class_id').notNull(),
    confidenceNow: integer('confidence_now').notNull().default(0),
    kDays: integer('k_days').notNull(),
    status: predictionStatusEnum('status').notNull().default('PROPOSED'),
    cadenceMinutes: integer('cadence_minutes').notNull().default(1440),
    lastFullAt: timestamp('last_full_at', { withTimezone: true }),
    lastIncrAt: timestamp('last_incr_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Plan-D B1 — auto-cancel control surface.
    // `autoCancelDisabled` is the operator escape hatch (off by default).
    // `autoCancelBelowSince` records the first instant confidence dipped under
    // the configured threshold; the auto-cancel tick uses (NOW() - this) > lag
    // to avoid cancelling on a single noisy snapshot.
    autoCancelDisabled: boolean('auto_cancel_disabled').notNull().default(false),
    autoCancelBelowSince: timestamp('auto_cancel_below_since', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('confidence_in_range', sql`${t.confidenceNow} >= 0 AND ${t.confidenceNow} <= 100`),
    index('predictions_status_idx').on(t.status),
    index('predictions_source_idx').on(t.sourceKind, t.sourceId),
    index('predictions_window_idx').on(t.windowDate, t.windowHalf),
    index('predictions_vrt_idx').on(t.vehicleClassId, t.regionId, t.taskClassId),
  ]
)

export const confidenceKindEnum = pgEnum('confidence_kind', ['INCR', 'FULL', 'MANUAL'])

export const confidenceSnapshots = pgTable(
  'confidence_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }),
    kind: confidenceKindEnum('kind').notNull(),
    confidence: integer('confidence').notNull(),
    confidenceCiLow: integer('confidence_ci_low'),
    confidenceCiHigh: integer('confidence_ci_high'),
    evidenceIds: jsonb('evidence_ids').notNull().default(sql`'[]'::jsonb`),
    reasoning: text('reasoning'),
    operator: text('operator'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('snapshot_confidence_in_range', sql`${t.confidence} >= 0 AND ${t.confidence} <= 100`),
    index('snapshots_pred_ts_idx').on(t.predictionId, t.occurredAt),
  ]
)

export const newsSourceKindEnum = pgEnum('news_source_kind', ['MAINSTREAM', 'GOV', 'SOCIAL', 'FOREIGN'])

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    url: text('url').notNull().unique(),
    sourceKind: newsSourceKindEnum('source_kind').notNull(),
    sourceLabel: text('source_label').notNull(),
    title: text('title').notNull(),
    summaryZh: text('summary_zh'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: text('content_hash').notNull(),
    contentOrigin: text('content_origin').notNull().default('domestic'),
    rawSnippet: text('raw_snippet'),
    matchedRegions: jsonb('matched_regions').notNull().default(sql`'[]'::jsonb`),
    extractedEntities: jsonb('extracted_entities').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index('news_hash_idx').on(t.contentHash),
    index('news_source_idx').on(t.sourceKind),
    index('news_published_idx').on(t.publishedAt),
  ]
)

export const evidenceWeightEnum = pgEnum('evidence_weight', ['HIGH', 'MED', 'LOW'])

export const newsEvidence = pgTable(
  'news_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }),
    newsId: uuid('news_id').notNull().references(() => newsItems.id, { onDelete: 'restrict' }),
    weight: evidenceWeightEnum('weight').notNull().default('MED'),
    cited: boolean('cited').notNull().default(true),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('evidence_pred_idx').on(t.predictionId),
    index('evidence_news_idx').on(t.newsId),
  ]
)

export type Prediction = typeof predictions.$inferSelect
export type NewPrediction = typeof predictions.$inferInsert
export type ConfidenceSnapshot = typeof confidenceSnapshots.$inferSelect
export type NewsItem = typeof newsItems.$inferSelect
export type NewsEvidence = typeof newsEvidence.$inferSelect
