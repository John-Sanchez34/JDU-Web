CREATE TYPE "public"."email_category" AS ENUM('transactional', 'broadcast');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_source_type" AS ENUM('enrollment', 'announcement', 'class_occurrence');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "email_source_type" NOT NULL,
	"source_id" text NOT NULL,
	"template" text NOT NULL,
	"category" "email_category" NOT NULL,
	"recipient_user_id" text,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text NOT NULL,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_deliveries_source_idx" ON "email_deliveries" USING btree ("source_type","source_id");