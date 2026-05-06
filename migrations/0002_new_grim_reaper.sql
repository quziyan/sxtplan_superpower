CREATE TABLE IF NOT EXISTS "task_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_level_1_has_no_parent" CHECK (("task_classes"."level" = 1 AND "task_classes"."parent_id" IS NULL) OR ("task_classes"."level" = 2 AND "task_classes"."parent_id" IS NOT NULL)),
	CONSTRAINT "task_level_in_range" CHECK ("task_classes"."level" IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_edge_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_class_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_level_1_has_no_parent" CHECK (("vehicle_classes"."level" = 1 AND "vehicle_classes"."parent_id" IS NULL) OR ("vehicle_classes"."level" = 2 AND "vehicle_classes"."parent_id" IS NOT NULL)),
	CONSTRAINT "vehicle_level_in_range" CHECK ("vehicle_classes"."level" IN (1, 2))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_edge_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_class_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_classes" ADD CONSTRAINT "task_classes_parent_id_task_classes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."task_classes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_edge_tags" ADD CONSTRAINT "task_edge_tags_task_class_id_task_classes_id_fk" FOREIGN KEY ("task_class_id") REFERENCES "public"."task_classes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_classes" ADD CONSTRAINT "vehicle_classes_parent_id_vehicle_classes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."vehicle_classes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_edge_tags" ADD CONSTRAINT "vehicle_edge_tags_vehicle_class_id_vehicle_classes_id_fk" FOREIGN KEY ("vehicle_class_id") REFERENCES "public"."vehicle_classes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_classes_parent_idx" ON "task_classes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_classes_name_idx" ON "task_classes" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_tag_unique" ON "task_edge_tags" USING btree ("task_class_id","tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_classes_parent_idx" ON "vehicle_classes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_classes_name_idx" ON "vehicle_classes" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_tag_unique" ON "vehicle_edge_tags" USING btree ("vehicle_class_id","tag");