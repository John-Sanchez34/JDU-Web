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

    await deliverQueued(db, [row!.id]);

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row!.id));
    expect(after!.providerMessageId).toBe("original");
    expect(after!.attempts).toBe(0);
  });

  it("ignores an id that does not exist", async () => {
    await expect(
      deliverQueued(db, ["11111111-1111-1111-1111-111111111111"]),
    ).resolves.toBeUndefined();
  });

  it("does nothing at all for an empty list", async () => {
    await expect(deliverQueued(db, [])).resolves.toBeUndefined();
  });
});
