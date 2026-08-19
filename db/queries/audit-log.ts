import { and, desc, eq } from "drizzle-orm";
import { auditLog, type AuditLogEntry } from "@/db/schema";
import type { Database, Executor } from "./executor";

export type AuditEntryInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
};

/**
 * The only writer to `audit_log`.
 *
 * Takes an `Executor` rather than a `Database` so callers can pass a
 * transaction handle: an audit row that survives a rolled-back transition
 * would be a lie about what happened.
 */
export async function recordAudit(
  exec: Executor,
  entry: AuditEntryInput,
): Promise<AuditLogEntry> {
  const [row] = await exec.insert(auditLog).values(entry).returning();
  if (!row) throw new Error("recordAudit: insert returned no row");
  return row;
}

/** Newest first — the order a person reading a dispute wants. */
export async function listAuditEntries(
  db: Database,
  entityType: string,
  entityId: string,
): Promise<AuditLogEntry[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id));
}
