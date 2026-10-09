import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import {
  claimForSend,
  countDeliveriesByStatus,
  listQueuedForSource,
  queueDeliveries,
  releaseToQueued,
} from "@/db/queries/email-deliveries";
import { emailDeliveries, user } from "@/db/schema";

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";

describe("queueDeliveries", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    await db.insert(user).values([
      { id: "u1", name: "One", email: "one@example.com" },
      { id: "u2", name: "Two", email: "two@example.com" },
    ]);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  const recipients = [
    { userId: "u1", email: "one@example.com" },
    { userId: "u2", email: "two@example.com" },
  ];

  function queue() {
    return queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients,
      render: (recipient) => ({
        subject: "Recital tickets",
        text: `hello ${recipient.email}`,
        html: `<p>hello ${recipient.email}</p>`,
      }),
    });
  }

  it("writes one row per recipient, rendered for that recipient", async () => {
    const ids = await queue();

    expect(ids).toHaveLength(2);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, SOURCE_ID));
    expect(rows.every((r) => r.category === "broadcast")).toBe(true);
    expect(rows.every((r) => r.sourceType === "announcement")).toBe(true);
    // The body differs per row — which is the whole reason rendering is a
    // callback rather than a value.
    expect(rows.map((r) => r.bodyText).sort()).toEqual([
      "hello one@example.com",
      "hello two@example.com",
    ]);
  });

  it("queues nothing for an empty audience rather than failing", async () => {
    const ids = await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: SOURCE_ID,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [],
      render: () => ({ subject: "x", text: "x", html: "x" }),
    });

    expect(ids).toEqual([]);
  });

  it("lists queued rows for one source up to a limit, oldest first", async () => {
    await queue();

    const first = await listQueuedForSource(db, "announcement", SOURCE_ID, 1);
    expect(first).toHaveLength(1);

    const all = await listQueuedForSource(db, "announcement", SOURCE_ID, 50);
    expect(all).toHaveLength(2);
  });

  it("omits a claimed row from the queued list and restores it on release", async () => {
    const ids = await queue();
    const claimed = await claimForSend(db, ids[0]!);
    expect(claimed).not.toBeNull();

    expect(await listQueuedForSource(db, "announcement", SOURCE_ID, 50)).toHaveLength(1);

    await releaseToQueued(db, ids[0]!);
    expect(await listQueuedForSource(db, "announcement", SOURCE_ID, 50)).toHaveLength(2);
  });

  it("counts a source's rows by status", async () => {
    const ids = await queue();
    await claimForSend(db, ids[0]!);

    const counts = await countDeliveriesByStatus(db, "announcement", SOURCE_ID);

    expect(counts.queued).toBe(1);
    expect(counts.sending).toBe(1);
    expect(counts.sent).toBe(0);
    expect(counts.failed).toBe(0);
  });
});
