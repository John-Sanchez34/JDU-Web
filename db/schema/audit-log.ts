import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // text, not uuid: user.id is Better Auth's generated text id, not an
    // application uuid. onDelete "set null" so deleting a staff account
    // never destroys the record of what they did.
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    // text, not uuid: entityType + entityId is a polymorphic reference, and
    // this codebase has two id styles — application tables use uuid, but
    // Better Auth's user table uses text. A future audit of a user-targeted
    // change (e.g. a role change) needs a text id here.
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
