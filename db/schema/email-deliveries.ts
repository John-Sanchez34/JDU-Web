import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);

export type EmailDeliveryStatus = (typeof emailDeliveryStatusEnum.enumValues)[number];

export const emailCategoryEnum = pgEnum("email_category", [
  "transactional",
  "broadcast",
]);

export type EmailCategory = (typeof emailCategoryEnum.enumValues)[number];

/*
 * Polymorphic, like `audit_log`: Phase 3a only ever writes "enrollment", but
 * announcements and class cancellations are the reason the column exists at
 * all rather than a foreign key to `enrollments`.
 */
export const emailSourceTypeEnum = pgEnum("email_source_type", [
  "enrollment",
  "announcement",
  "class_occurrence",
]);

export type EmailSourceType = (typeof emailSourceTypeEnum.enumValues)[number];

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: emailSourceTypeEnum("source_type").notNull(),
    // text, not uuid: the same polymorphic-reference reasoning as
    // `audit_log.entity_id`, where a source may one day be a text user id.
    sourceId: text("source_id").notNull(),
    template: text("template").notNull(),
    category: emailCategoryEnum("category").notNull(),
    // "set null", never cascade: a delivery row must stay readable after the
    // account it went to is deleted. The address it went to is on the row.
    recipientUserId: text("recipient_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    /*
     * The rendered message is stored, not re-derived. A retry then resends
     * exactly what was promised rather than re-rendering against a class whose
     * price may have changed in between.
     */
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull(),
    status: emailDeliveryStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The retry page reads by status.
    index("email_deliveries_status_idx").on(table.status),
    // Every delivery belonging to one enrollment.
    index("email_deliveries_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export type EmailDelivery = typeof emailDeliveries.$inferSelect;
