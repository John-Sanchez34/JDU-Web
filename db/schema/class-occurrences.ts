import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { classOfferings } from "./class-offerings";

export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "scheduled",
  "cancelled",
]);

export const classOccurrences = pgTable(
  "class_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classOfferingId: uuid("class_offering_id")
      .notNull()
      .references(() => classOfferings.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: occurrenceStatusEnum("status").notNull().default("scheduled"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("class_occurrences_offering_date_key").on(
      table.classOfferingId,
      table.date,
    ),
    index("class_occurrences_date_idx").on(table.date),
  ],
);

export type ClassOccurrence = typeof classOccurrences.$inferSelect;
