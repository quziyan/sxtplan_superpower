CREATE TYPE "public"."dispatch_state" AS ENUM('QUEUED', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REJECTED_BY_ADAPTER', 'CANCEL_PENDING', 'CANCELLED', 'TIMED_OUT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispatch_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"payload_json" jsonb NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dispatch_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"adapter_key" text NOT NULL,
	"external_id" text,
	"state" "dispatch_state" DEFAULT 'QUEUED' NOT NULL,
	"params_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"callback_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancellation_reason" text,
	"cost" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_id" uuid NOT NULL,
	"oss_uri" text NOT NULL,
	"source_url" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer,
	"sha256" text,
	"scan_status" text DEFAULT 'PENDING' NOT NULL,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_results" ADD CONSTRAINT "dispatch_results_dispatch_id_dispatch_tasks_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatch_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dispatch_id_dispatch_tasks_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."dispatch_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "result_dispatch_idx" ON "dispatch_results" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_pred_idx" ON "dispatch_tasks" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_state_idx" ON "dispatch_tasks" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_external_idx" ON "dispatch_tasks" USING btree ("adapter_key","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_dispatch_idx" ON "media_assets" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_scan_idx" ON "media_assets" USING btree ("scan_status");