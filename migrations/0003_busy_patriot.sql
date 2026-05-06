CREATE SCHEMA IF NOT EXISTS "audit";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit"."operation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role_key" text,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
