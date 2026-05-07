import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { predictions } from './prediction'

export const predictionOutcomeEnum = pgEnum('prediction_outcome', ['HIT', 'MISS', 'NO_DATA'])
export const captureOutcomeEnum = pgEnum('capture_outcome', ['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN'])

export const retrospectives = pgTable(
  'retrospectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    predictionId: uuid('prediction_id').notNull().references(() => predictions.id, { onDelete: 'cascade' }),
    predictionOutcome: predictionOutcomeEnum('prediction_outcome').notNull(),
    captureOutcome: captureOutcomeEnum('capture_outcome').notNull(),
    scoreV: integer('score_v').notNull(),
    scoreR: integer('score_r').notNull(),
    scoreW: integer('score_w').notNull(),
    scoreT: integer('score_t').notNull(),
    composite: integer('composite').notNull(),
    causalMd: text('causal_md').notNull(),
    summaryMd: text('summary_md').notNull(),
    evidenceNewsIds: jsonb('evidence_news_ids').notNull().default(sql`'[]'::jsonb`),
    captureDispatchIds: jsonb('capture_dispatch_ids').notNull().default(sql`'[]'::jsonb`),
    reviewerNotes: text('reviewer_notes'),
    outcomeOverridden: boolean('outcome_overridden').notNull().default(false),
    overriddenReason: text('overridden_reason'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('retrospectives_prediction_unique').on(t.predictionId),
    // 二轴矩阵: CAPTURED 必须对应 HIT (2 个不可能格之一)
    check(
      'outcome_capture_implies_hit',
      sql`NOT (${t.captureOutcome} = 'CAPTURED' AND ${t.predictionOutcome} <> 'HIT')`,
    ),
    check(
      'scores_in_range',
      sql`${t.scoreV} BETWEEN 0 AND 100 AND ${t.scoreR} BETWEEN 0 AND 100
          AND ${t.scoreW} BETWEEN 0 AND 100 AND ${t.scoreT} BETWEEN 0 AND 100
          AND ${t.composite} BETWEEN 0 AND 100`,
    ),
    check(
      'overridden_requires_reason',
      sql`(${t.outcomeOverridden} = FALSE) OR (${t.overriddenReason} IS NOT NULL)`,
    ),
    index('retrospectives_outcome_idx').on(t.predictionOutcome, t.captureOutcome),
    index('retrospectives_generated_idx').on(t.generatedAt),
  ],
)

export const caseLibraryEntries = pgTable(
  'case_library_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retrospectiveId: uuid('retrospective_id').notNull().references(() => retrospectives.id, { onDelete: 'cascade' }),
    predictionSnapshot: jsonb('prediction_snapshot').notNull(),
    retrievalKeys: jsonb('retrieval_keys').notNull(),
    bm25Blob: text('bm25_blob').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('case_library_retrospective_unique').on(t.retrospectiveId),
    index('case_library_bm25_idx').on(t.bm25Blob),
  ],
)

export type Retrospective = typeof retrospectives.$inferSelect
export type NewRetrospective = typeof retrospectives.$inferInsert
export type CaseLibraryEntry = typeof caseLibraryEntries.$inferSelect
export type NewCaseLibraryEntry = typeof caseLibraryEntries.$inferInsert
