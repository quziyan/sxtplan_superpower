CREATE TYPE "public"."capture_outcome" AS ENUM('CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."prediction_outcome" AS ENUM('HIT', 'MISS', 'NO_DATA');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_library_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retrospective_id" uuid NOT NULL,
	"prediction_snapshot" jsonb NOT NULL,
	"retrieval_keys" jsonb NOT NULL,
	"bm25_blob" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retrospectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"prediction_outcome" "prediction_outcome" NOT NULL,
	"capture_outcome" "capture_outcome" NOT NULL,
	"score_v" integer NOT NULL,
	"score_r" integer NOT NULL,
	"score_w" integer NOT NULL,
	"score_t" integer NOT NULL,
	"composite" integer NOT NULL,
	"causal_md" text NOT NULL,
	"summary_md" text NOT NULL,
	"evidence_news_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capture_dispatch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_notes" text,
	"outcome_overridden" boolean DEFAULT false NOT NULL,
	"overridden_reason" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_capture_implies_hit" CHECK (NOT ("retrospectives"."capture_outcome" = 'CAPTURED' AND "retrospectives"."prediction_outcome" <> 'HIT')),
	CONSTRAINT "scores_in_range" CHECK ("retrospectives"."score_v" BETWEEN 0 AND 100 AND "retrospectives"."score_r" BETWEEN 0 AND 100
          AND "retrospectives"."score_w" BETWEEN 0 AND 100 AND "retrospectives"."score_t" BETWEEN 0 AND 100
          AND "retrospectives"."composite" BETWEEN 0 AND 100),
	CONSTRAINT "overridden_requires_reason" CHECK (("retrospectives"."outcome_overridden" = FALSE) OR ("retrospectives"."overridden_reason" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_library_entries" ADD CONSTRAINT "case_library_entries_retrospective_id_retrospectives_id_fk" FOREIGN KEY ("retrospective_id") REFERENCES "public"."retrospectives"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retrospectives" ADD CONSTRAINT "retrospectives_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_library_retrospective_unique" ON "case_library_entries" USING btree ("retrospective_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_library_bm25_idx" ON "case_library_entries" USING btree ("bm25_blob");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retrospectives_prediction_unique" ON "retrospectives" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retrospectives_outcome_idx" ON "retrospectives" USING btree ("prediction_outcome","capture_outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retrospectives_generated_idx" ON "retrospectives" USING btree ("generated_at");