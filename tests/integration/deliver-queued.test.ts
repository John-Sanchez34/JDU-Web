import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { deliverQueued } from "@/lib/notifications/deliver";
import { emailDeliveries } from "@/db/schema";

const base = {
  sourceType: "enrollment" as const,
  sourceId: "11111111-1111-1111-1111-111111111111",
  template: "enrollment.requested",
  category: "transactional" as const,
  recipientEmail: "parent@example.com",
  subject: "Your seat is held",
  bodyText: "text body",
  bodyHtml: "<p>html body</p>",
};

describe("deliverQueued", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("sends every queued row and records the provider id", async () => {
    const rows = await db
      .insert(emailDeliveries)
      .values([base, { ...base, recipientEmail: "two@example.com" }])
      .returning();

    await deliverQueued(db, rows.map((row) => row.id));

    const after = await db.select().from(emailDeliveries);
    expect(after.every((row) => row.status === "sent")).toBe(true);
    expect(after.every((row) => row.providerMessageId?.startsWith("capture-"))).toBe(true);
  });

  it("leaves an already-sent row alone", async () => {
    const [row] = await db
      .insert(emailDeliveries)
      .values({ ...base, status: "sent", providerMessageId: "original" })
      .returning();

    const outcomes = await deliverQueued(db, [row!.id]);

    expect(outcomes[row!.id]).toBe("skipped");
    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row!.id));
    expect(after!.providerMessageId).toBe("original");
    expect(after!.attempts).toBe(0);
  });

  it("ignores an id that does not exist", async () => {
    const outcomes = await deliverQueued(db, ["11111111-1111-1111-1111-111111111111"]);
    expect(outcomes["11111111-1111-1111-1111-111111111111"]).toBe("skipped");
  });

  it("does nothing at all for an empty list", async () => {
    await expect(deliverQueued(db, [])).resolves.toEqual({});
  });

  it("recovers a row stuck sending past the window — proof Retry does something", async () => {
    // End-to-end proof for findings 1 and 2: a row abandoned mid-send (the
    // exact state Retry exists to rescue) reaches `sent` when run back through
    // deliverQueued, using claimForSend's real (non-injected) clock. Before
    // the fix this row would stay `sending` forever: claimForSend would
    // refuse it, deliverQueued would report "skipped", and Retry would be a
    // permanent no-op.
    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000); // 20m > STUCK_AFTER_MS
    const [row] = await db
      .insert(emailDeliveries)
      .values({ ...base, status: "sending", attempts: 1, updatedAt: staleUpdatedAt })
      .returning();

    const outcomes = await deliverQueued(db, [row!.id]);

    expect(outcomes[row!.id]).toBe("sent");
    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row!.id));
    expect(after!.status).toBe("sent");
    expect(after!.attempts).toBe(2);
  });
});
