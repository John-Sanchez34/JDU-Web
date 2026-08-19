import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { listAuditEntries, recordAudit } from "@/db/queries/audit-log";

describe("recordAudit", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("writes an entry with before and after snapshots", async () => {
    const entityId = crypto.randomUUID();

    const entry = await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId,
      before: { status: "pending" },
      after: { status: "active" },
    });

    expect(entry.action).toBe("enrollment.confirmed");
    expect(entry.before).toEqual({ status: "pending" });
    expect(entry.after).toEqual({ status: "active" });
  });

  it("accepts a null actor for system-originated changes", async () => {
    const entry = await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.requested",
      entityType: "enrollment",
      entityId: crypto.randomUUID(),
      before: null,
      after: { status: "pending" },
    });

    expect(entry.actorUserId).toBeNull();
  });

  it("rolls back with its transaction", async () => {
    const entityId = crypto.randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, {
          actorUserId: null,
          action: "enrollment.requested",
          entityType: "enrollment",
          entityId,
          before: null,
          after: { status: "pending" },
        });
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    const entries = await listAuditEntries(db, "enrollment", entityId);
    expect(entries).toHaveLength(0);
  });

  it("returns entries for one entity newest first", async () => {
    const entityId = crypto.randomUUID();
    await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.requested",
      entityType: "enrollment",
      entityId,
      before: null,
      after: { status: "pending" },
    });
    await recordAudit(db, {
      actorUserId: null,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId,
      before: { status: "pending" },
      after: { status: "active" },
    });

    const entries = await listAuditEntries(db, "enrollment", entityId);

    expect(entries.map((e) => e.action)).toEqual([
      "enrollment.confirmed",
      "enrollment.requested",
    ]);
  });
});
