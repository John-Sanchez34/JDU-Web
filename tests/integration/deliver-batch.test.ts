import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { queueDeliveries } from "@/db/queries/email-deliveries";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "22222222-2222-2222-2222-222222222222";

describe("deliverBatchForSource", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values(
      [1, 2, 3].map((n) => ({ id: `u${n}`, name: `U${n}`, email: `u${n}@example.com` })),
    );
    await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [1, 2, 3].map((n) => ({ userId: `u${n}`, email: `u${n}@example.com` })),
      render: () => ({ subject: "Recital", text: "text", html: "<p>html</p>" }),
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("sends only up to the limit and leaves the rest queued and resumable", async () => {
    const first = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 2,
      minIntervalMs: 0,
    });

    expect(first.sent).toBe(2);
    expect(first.remaining).toBe(1);

    const second = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 2,
      minIntervalMs: 0,
    });

    expect(second.sent).toBe(1);
    expect(second.remaining).toBe(0);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("does nothing and reports nothing remaining once everything is sent", async () => {
    await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 50,
      minIntervalMs: 0,
    });

    const again = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 50,
      minIntervalMs: 0,
    });

    expect(again).toEqual({ sent: 0, failed: 0, skipped: 0, rateLimited: false, remaining: 0 });
  });
});
