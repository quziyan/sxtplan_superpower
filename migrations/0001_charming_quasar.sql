CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TYPE "public"."region_kind" AS ENUM('ADMIN_NAMED', 'AD_HOC');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" "region_kind" NOT NULL,
	"name" text,
	"parent_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"geom" geometry(POLYGON,4326) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "region_admin_named_has_name" CHECK (("regions"."kind" = 'AD_HOC') OR ("regions"."name" IS NOT NULL)),
	CONSTRAINT "region_version_positive" CHECK ("regions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regions_one_current" ON "regions" USING btree ("id") WHERE "regions"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regions_geom_idx" ON "regions" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regions_kind_idx" ON "regions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regions_name_idx" ON "regions" USING btree ("name");