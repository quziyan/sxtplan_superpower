import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const envelopeStatusEnum = pgEnum('envelope_status', ['RECEIVED', 'PROCESSED', 'INVALID_SIG', 'PROCESSING_FAILED'])

export const webhookEnvelopes = pgTable(
  'webhook_envelopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adapterKey: text('adapter_key').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    sigStatus: text('sig_status').notNull(), // 'OK' | 'INVALID' | 'MISSING'
    rawHeadersJson: jsonb('raw_headers_json').notNull(),
    rawBody: text('raw_body').notNull(),
    status: envelopeStatusEnum('status').notNull().default('RECEIVED'),
    processedDispatchId: uuid('processed_dispatch_id'),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('envelope_idem_idx').on(t.adapterKey, t.idempotencyKey),
    index('envelope_status_idx').on(t.status),
  ],
)

export type WebhookEnvelope = typeof webhookEnvelopes.$inferSelect
export type NewWebhookEnvelope = typeof webhookEnvelopes.$inferInsert
