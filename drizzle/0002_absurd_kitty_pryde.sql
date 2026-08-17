CREATE TYPE "public"."occurrence_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "class_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_offering_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_occurrences" ADD CONSTRAINT "class_occurrences_class_offering_id_class_offerings_id_fk" FOREIGN KEY ("class_offering_id") REFERENCES "public"."class_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_occurrences_offering_date_key" ON "class_occurrences" USING btree ("class_offering_id","date");--> statement-breakpoint
CREATE INDEX "class_occurrences_date_idx" ON "class_occurrences" USING btree ("date");