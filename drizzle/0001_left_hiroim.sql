CREATE TYPE "public"."day_of_week" AS ENUM('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"registration_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"level" text,
	"min_age" integer,
	"max_age" integer,
	"day_of_week" "day_of_week" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"room" text,
	"instructor" text,
	"capacity" integer NOT NULL,
	"seats_taken" integer DEFAULT 0 NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"season_fee_cents" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_offerings_capacity_positive" CHECK ("class_offerings"."capacity" > 0),
	CONSTRAINT "class_offerings_seats_within_capacity" CHECK ("class_offerings"."seats_taken" >= 0 AND "class_offerings"."seats_taken" <= "class_offerings"."capacity"),
	CONSTRAINT "class_offerings_prices_non_negative" CHECK ("class_offerings"."monthly_price_cents" >= 0 AND "class_offerings"."season_fee_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "class_offerings" ADD CONSTRAINT "class_offerings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_offerings_season_id_idx" ON "class_offerings" USING btree ("season_id");