import { vi } from "vitest";

// Mock sendEmail to fail for a specific email and succeed for others.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async ({ to }: { to: string }) => {
    if (to === "fails@example.com") {
      throw new Error("Invalid email address");
    }
    return { providerMessageId: "capture-ok" };
  }),
}));

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { deliverQueued } from "@/lib/notifications/deliver";
import { emailDeliveries } from "@/db/schema";

const base = {
  sourceType: "enrollment" as const,
  sourceId: "11111111-1111-1111-1111-111111111111",
  template: "enrollment.requested",
  category: "transactional" as const,
  subject: "Your seat is held",
  bodyText: "text body",
  bodyHtml: "<p>html body</p>",
};

describe("deliverQueued with send failures", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("records a send failure and continues with the next delivery", async () => {
    const rows = await db
      .insert(emailDeliveries)
      .values([
        { ...base, recipientEmail: "fails@example.com" },
        { ...base, recipientEmail: "succeeds@example.com" },
      ])
      .returning();

    await deliverQueued(db, rows.map((row) => row.id));

    const results = await db.select().from(emailDeliveries);

    // The failing address should be marked as failed.
    const failedRow = results.find((r) => r.recipientEmail === "fails@example.com");
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.error).toBe("Invalid email address");

    // The succeeding address should be marked as sent — this proves the loop
    // continued after the failure.
    const sentRow = results.find((r) => r.recipientEmail === "succeeds@example.com");
    expect(sentRow?.status).toBe("sent");
    expect(sentRow?.providerMessageId).toBe("capture-ok");
  });
});
