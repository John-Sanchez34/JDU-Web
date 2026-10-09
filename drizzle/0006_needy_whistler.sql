CREATE TYPE "public"."announcement_audience" AS ENUM('all', 'class_offering');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience_type" "announcement_audience" NOT NULL,
	"class_offering_id" uuid,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_audience_pairing" CHECK (("announcements"."audience_type" = 'all' AND "announcements"."class_offering_id" IS NULL)
          OR ("announcements"."audience_type" = 'class_offering' AND "announcements"."class_offering_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "broadcast_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_offering_id_class_offerings_id_fk" FOREIGN KEY ("class_offering_id") REFERENCES "public"."class_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_status_published_at_idx" ON "announcements" USING btree ("status","published_at");