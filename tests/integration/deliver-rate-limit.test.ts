import { vi } from "vitest";

/*
 * Succeed once, then rate-limit everything after.
 *
 * Counting calls rather than matching an address on purpose: `queueDeliveries`
 * inserts every row in one statement, so they share a `createdAt` and
 * `listQueuedForSource` breaks the tie on a random uuid. "The second row sent"
 * is deterministic; "the row for u2@example.com" is not.
 */
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  let calls = 0;
  return {
    ...actual,
    sendEmail: vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { providerMessageId: "capture-ok" };
      throw new actual.EmailSendError("Too many requests", 429, "rate_limit_exceeded");
    }),
  };
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { queueDeliveries } from "@/db/queries/email-deliveries";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "33333333-3333-3333-3333-333333333333";

describe("deliverBatchForSource when the provider rate-limits", () => {
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

  it("releases the claim, stops the batch, and leaves the rest resumable", async () => {
    const outcome = await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      limit: 10,
      minIntervalMs: 0,
    });

    expect(outcome.sent).toBe(1);
    expect(outcome.rateLimited).toBe(true);
    // Nothing is failed: a rate limit is not the address's fault.
    expect(outcome.failed).toBe(0);
    // Both survivors are still sendable, which is what "Send the rest" reads.
    expect(outcome.remaining).toBe(2);

    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));

    expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "failed")).toHaveLength(0);

    /*
     * The two queued rows are not interchangeable, and the difference is the
     * whole point. One was claimed and handed back, so it carries an attempt.
     * The other was never reached, because the loop broke — if it had kept
     * going it would carry an attempt too, and a real fan-out would burn
     * through every remaining address against a provider already saying stop.
     */
     const queuedAttempts = rows
      .filter((r) => r.status === "queued")
      .map((r) => r.attempts)
      .sort();
    expect(queuedAttempts).toEqual([0, 1]);
  });
});
