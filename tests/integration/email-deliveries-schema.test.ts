import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { emailDeliveries, families, user } from "@/db/schema";

describe("email_deliveries", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  const row = {
    sourceType: "enrollment" as const,
    sourceId: "11111111-1111-1111-1111-111111111111",
    template: "enrollment.requested",
    category: "transactional" as const,
    recipientEmail: "parent@example.com",
    subject: "Your seat is held",
    bodyText: "text body",
    bodyHtml: "<p>html body</p>",
  };

  it("defaults a new row to queued with no attempts", async () => {
    const [created] = await db.insert(emailDeliveries).values(row).returning();

    expect(created!.status).toBe("queued");
    expect(created!.attempts).toBe(0);
    expect(created!.sentAt).toBeNull();
    expect(created!.providerMessageId).toBeNull();
  });

  it("keeps the row when the recipient account is deleted", async () => {
    const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
    await db.insert(user).values({
      id: "user-1",
      name: "Ana Alvarez",
      email: "ana@example.com",
      familyId: family!.id,
    });
    const [created] = await db
      .insert(emailDeliveries)
      .values({ ...row, recipientUserId: "user-1" })
      .returning();

    await db.delete(user).where(eq(user.id, "user-1"));

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, created!.id));
    // The account is gone; the record of what was sent to it is not.
    expect(after!.recipientUserId).toBeNull();
    expect(after!.recipientEmail).toBe("parent@example.com");
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      db.insert(emailDeliveries).values({ ...row, status: "delivered" as never }),
    ).rejects.toThrow();
  });
});
