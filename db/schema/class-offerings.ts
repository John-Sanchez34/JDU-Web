import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

export type DayOfWeek = (typeof dayOfWeekEnum.enumValues)[number];

export const classOfferings = pgTable(
  "class_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    level: text("level"),
    // Advisory only — enrollment is instant and does not enforce these.
    minAge: integer("min_age"),
    maxAge: integer("max_age"),
    dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    room: text("room"),
    instructor: text("instructor"),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").notNull().default(0),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    seasonFeeCents: integer("season_fee_cents").notNull().default(0),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("class_offerings_season_id_idx").on(table.seasonId),
    check("class_offerings_capacity_positive", sql`${table.capacity} > 0`),
    check(
      "class_offerings_seats_within_capacity",
      sql`${table.seatsTaken} >= 0 AND ${table.seatsTaken} <= ${table.capacity}`,
    ),
    check(
      "class_offerings_prices_non_negative",
      sql`${table.monthlyPriceCents} >= 0 AND ${table.seasonFeeCents} >= 0`,
    ),
  ],
);

export type ClassOffering = typeof classOfferings.$inferSelect;
