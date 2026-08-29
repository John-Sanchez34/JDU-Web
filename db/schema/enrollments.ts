import { pgEnum, pgTable, timestamp, uniqueIndex, index, uuid, date, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { students } from "./students";
import { classOfferings } from "./class-offerings";
import { user } from "./auth";

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "pending",
  "active",
  "withdrawn",
  "released",
]);

export type EnrollmentStatus = (typeof enrollmentStatusEnum.enumValues)[number];

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classOfferingId: uuid("class_offering_id")
      .notNull()
      .references(() => classOfferings.id, { onDelete: "cascade" }),
    status: enrollmentStatusEnum("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // text, not uuid: user.id is Better Auth's generated text id, not an
    // application uuid. onDelete "set null" so deleting a staff account
    // never destroys the enrollment history of what they confirmed.
    confirmedByUserId: text("confirmed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * The heart of the "new row each time" decision: history is kept forever,
     * but a student can hold at most one live seat in a given class. A
     * withdrawn or released row falls out of this index and stops blocking.
     */
    uniqueIndex("enrollments_one_live_per_student_class")
      .on(table.studentId, table.classOfferingId)
      .where(sql`${table.status} in ('pending', 'active')`),
    // The staff queue reads pending rows oldest-first.
    index("enrollments_status_requested_at_idx").on(table.status, table.requestedAt),
    index("enrollments_class_offering_id_idx").on(table.classOfferingId),
    index("enrollments_student_id_idx").on(table.studentId),
  ],
);

export type Enrollment = typeof enrollments.$inferSelect;
