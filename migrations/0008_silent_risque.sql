CREATE TYPE "public"."envelope_status" AS ENUM('RECEIVED', 'PROCESSED', 'INVALID_SIG', 'PROCESSING_FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"sig_status" text NOT NULL,
	"raw_headers_json" jsonb NOT NULL,
	"raw_body" text NOT NULL,
	"status" "envelope_status" DEFAULT 'RECEIVED' NOT NULL,
	"processed_dispatch_id" uuid,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "envelope_idem_idx" ON "webhook_envelopes" USING btree ("adapter_key","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "envelope_status_idx" ON "webhook_envelopes" USING btree ("status");