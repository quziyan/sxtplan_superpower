CREATE TABLE IF NOT EXISTS "task_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"vehicle_class_id" uuid NOT NULL,
	"task_class_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"region_version" integer NOT NULL,
	"target_window_date" timestamp NOT NULL,
	"target_window_half" "half_day" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"vehicle_class_id" uuid NOT NULL,
	"task_class_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"region_version" integer NOT NULL,
	"k_range_min" integer DEFAULT 1 NOT NULL,
	"k_range_max" integer DEFAULT 14 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "taskcard_target_idx" ON "task_cards" USING btree ("target_window_date","target_window_half");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_active_idx" ON "watch_lists" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watchlist_vrt_idx" ON "watch_lists" USING btree ("vehicle_class_id","region_id","task_class_id");