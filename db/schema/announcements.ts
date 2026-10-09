import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { classOfferings } from "./class-offerings";

export const announcementAudienceEnum = pgEnum("announcement_audience", [
  "all",
  "class_offering",
]);

export type AnnouncementAudience = (typeof announcementAudienceEnum.enumValues)[number];

export const announcementStatusEnum = pgEnum("announcement_status", [
  "draft",
  "published",
]);

export type AnnouncementStatus = (typeof announcementStatusEnum.enumValues)[number];

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /*
     * Plain text, not markdown. Blank lines separate paragraphs; the text is
     * escaped and wrapped at render time, in both the email and the page. A
     * markdown dependency would buy formatting nobody asked for and bring an
     * HTML sanitisation problem with it.
     */
    body: text("body").notNull(),
    audienceType: announcementAudienceEnum("audience_type").notNull(),
    /*
     * Cascade rather than set null: an announcement addressed to a class that
     * no longer exists has no audience, and a row claiming to target a class
     * while pointing at nothing would fail its own check constraint.
     */
    classOfferingId: uuid("class_offering_id").references(() => classOfferings.id, {
      onDelete: "cascade",
    }),
    status: announcementStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /*
     * Set when the fan-out is *queued*, not when it is sent. What must happen
     * exactly once is the queueing; sending is already exactly-once per row.
     */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    // text, not uuid: user.id is Better Auth's generated text id. "set null"
    // so deleting a staff account never destroys what they posted.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The public list reads published rows newest first.
    index("announcements_status_published_at_idx").on(table.status, table.publishedAt),
    /*
     * The two audience columns only make sense in pairs. Enforced here rather
     * than in application code so a bad row cannot exist at all.
     */
    check(
      "announcements_audience_pairing",
      sql`(${table.audienceType} = 'all' AND ${table.classOfferingId} IS NULL)
          OR (${table.audienceType} = 'class_offering' AND ${table.classOfferingId} IS NOT NULL)`,
    ),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
