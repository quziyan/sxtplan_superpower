CREATE TYPE "public"."confidence_kind" AS ENUM('INCR', 'FULL', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."evidence_weight" AS ENUM('HIGH', 'MED', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."half_day" AS ENUM('AM', 'PM');--> statement-breakpoint
CREATE TYPE "public"."news_source_kind" AS ENUM('MAINSTREAM', 'GOV', 'SOCIAL', 'FOREIGN');--> statement-breakpoint
CREATE TYPE "public"."prediction_source" AS ENUM('WATCHLIST', 'TASKCARD');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('PROPOSED', 'APPROVED', 'REJECTED', 'DISPATCHED', 'EXPIRED', 'COMPLETED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "confidence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"kind" "confidence_kind" NOT NULL,
	"confidence" integer NOT NULL,
	"confidence_ci_low" integer,
	"confidence_ci_high" integer,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text,
	"operator" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_confidence_in_range" CHECK ("confidence_snapshots"."confidence" >= 0 AND "confidence_snapshots"."confidence" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"news_id" uuid NOT NULL,
	"weight" "evidence_weight" DEFAULT 'MED' NOT NULL,
	"cited" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"source_kind" "news_source_kind" NOT NULL,
	"source_label" text NOT NULL,
	"title" text NOT NULL,
	"summary_zh" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"content_origin" text DEFAULT 'domestic' NOT NULL,
	"raw_snippet" text,
	"matched_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "news_items_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" "prediction_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"region_version" integer NOT NULL,
	"window_date" timestamp NOT NULL,
	"window_half" "half_day" NOT NULL,
	"vehicle_class_id" uuid NOT NULL,
	"task_class_id" uuid NOT NULL,
	"confidence_now" integer DEFAULT 0 NOT NULL,
	"k_days" integer NOT NULL,
	"status" "prediction_status" DEFAULT 'PROPOSED' NOT NULL,
	"cadence_minutes" integer DEFAULT 1440 NOT NULL,
	"last_full_at" timestamp with time zone,
	"last_incr_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_in_range" CHECK ("predictions"."confidence_now" >= 0 AND "predictions"."confidence_now" <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "confidence_snapshots" ADD CONSTRAINT "confidence_snapshots_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_evidence" ADD CONSTRAINT "news_evidence_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "news_evidence" ADD CONSTRAINT "news_evidence_news_id_news_items_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_pred_ts_idx" ON "confidence_snapshots" USING btree ("prediction_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_pred_idx" ON "news_evidence" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evidence_news_idx" ON "news_evidence" USING btree ("news_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_hash_idx" ON "news_items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_source_idx" ON "news_items" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "news_published_idx" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictions_status_idx" ON "predictions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictions_source_idx" ON "predictions" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictions_window_idx" ON "predictions" USING btree ("window_date","window_half");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "predictions_vrt_idx" ON "predictions" USING btree ("vehicle_class_id","region_id","task_class_id");