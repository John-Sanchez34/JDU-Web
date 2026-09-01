import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import {
  claimForSend,
  listRetriableDeliveries,
  markFailed,
  markSent,
  STUCK_AFTER_MS,
} from "@/db/queries/email-deliveries";
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

describe("delivery state", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function insert(overrides: Partial<typeof emailDeliveries.$inferInsert> = {}) {
    const [row] = await db
      .insert(emailDeliveries)
      .values({ ...base, ...overrides })
      .returning();
    return row!;
  }

  it("claims a queued row and counts the attempt", async () => {
    const row = await insert();

    const claimed = await claimForSend(db, row.id);

    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(1);
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const row = await insert();

    const [first, second] = await Promise.all([
      claimForSend(db, row.id),
      claimForSend(db, row.id),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("refuses to claim a row that has already been sent", async () => {
    const row = await insert({ status: "sent" });

    expect(await claimForSend(db, row.id)).toBeNull();
  });

  it("claims a failed row again, so Retry works", async () => {
    const row = await insert({ status: "failed", attempts: 1, error: "boom" });

    const claimed = await claimForSend(db, row.id);

    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(2);
  });

  it("records the provider id and clears a prior error when sent", async () => {
    // Started as failed-with-error so the error:null assertion below can
    // actually fail if that line is ever deleted from markSent.
    const row = await insert({ status: "failed", error: "boom" });
    await claimForSend(db, row.id);

    await markSent(db, row.id, "resend-123");

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row.id));
    expect(after!.status).toBe("sent");
    expect(after!.providerMessageId).toBe("resend-123");
    expect(after!.sentAt).not.toBeNull();
    expect(after!.error).toBeNull();
  });

  it("records the error when it fails", async () => {
    const row = await insert();
    await claimForSend(db, row.id);

    await markFailed(db, row.id, "provider refused");

    const [after] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.id, row.id));
    expect(after!.status).toBe("failed");
    expect(after!.error).toBe("provider refused");
  });

  it("claims a sending row that has been stuck past the window", async () => {
    // Finding 1's regression test: before the fix, claimForSend only accepted
    // ('queued', 'failed'), so a row abandoned mid-send — the exact case the
    // fifteen-minute window exists to rescue — could never be claimed again.
    // Reverting the `or(... sending+stale ...)` clause makes this fail.
    const now = new Date("2026-09-01T12:00:00Z");
    const staleUpdatedAt = new Date(now.getTime() - STUCK_AFTER_MS - 1000);
    const row = await insert({ status: "sending", attempts: 1, updatedAt: staleUpdatedAt });

    const claimed = await claimForSend(db, row.id, now);

    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("sending");
    expect(claimed!.attempts).toBe(2);
  });

  it("refuses to claim a sending row still inside the window", async () => {
    // The other half of the same invariant: a row that is merely in flight
    // must stay unclaimable, or two concurrent sends could both proceed.
    const now = new Date("2026-09-01T12:00:00Z");
    const freshUpdatedAt = new Date(now.getTime() - 60 * 1000);
    const row = await insert({ status: "sending", attempts: 1, updatedAt: freshUpdatedAt });

    expect(await claimForSend(db, row.id, now)).toBeNull();
  });

  it("lists a queued row stuck past the window and excludes a fresh one", async () => {
    // Finding 2's regression test: before the fix, listRetriableDeliveries
    // never looked at `queued` rows at all, so a row `after()` never picked
    // up — a deploy or SIGTERM between commit and callback — was invisible
    // forever. Reverting the `and(queued, createdAt < cutoff)` clause makes
    // this fail by dropping the stuck row from the result.
    const now = new Date("2026-09-01T12:00:00Z");
    const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
    const staleCreatedAt = new Date(cutoff.getTime() - 1000);
    const freshCreatedAt = new Date(now.getTime() - 60 * 1000);

    const stuckQueued = await insert({ status: "queued", createdAt: staleCreatedAt });
    const freshQueued = await insert({ status: "queued", createdAt: freshCreatedAt });

    const rows = await listRetriableDeliveries(db, now);

    expect(rows.map((row) => row.id)).toContain(stuckQueued.id);
    expect(rows.map((row) => row.id)).not.toContain(freshQueued.id);
  });

  it("lists failed rows and rows stuck sending, oldest first", async () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
    // Straddle the cutoff by one second on each side so an off-by-one in the
    // constant or a lt/gt mix-up would flip one of these two rows.
    const justPastCutoff = new Date(cutoff.getTime() - 1000); // 1s older than the window -> stuck, included
    const justShortOfCutoff = new Date(cutoff.getTime() + 1000); // 1s younger than the window -> not stuck yet, excluded
    const recent = new Date(now.getTime() - 60 * 1000);

    await insert({ status: "sent" });
    // Explicit recent createdAt: a plain default would use the real wall
    // clock, which predates the fictional `now` above and would wrongly look
    // stuck under the queued-cutoff clause added for finding 2.
    await insert({ status: "queued", createdAt: recent });
    await insert({ status: "sending", updatedAt: justShortOfCutoff });
    await insert({ status: "sending", updatedAt: recent });

    // Inserted with the newer row first, so a missing or reversed ORDER BY
    // would hand back this same (wrong) order rather than coincidentally
    // matching the oldest-first expectation below.
    const failed = await insert({ status: "failed", error: "boom", createdAt: recent });
    const stuck = await insert({
      status: "sending",
      createdAt: justPastCutoff,
      updatedAt: justPastCutoff,
    });

    const rows = await listRetriableDeliveries(db, now);

    expect(rows.map((row) => row.id)).toEqual([stuck.id, failed.id]);
  });
});
