import { vi } from "vitest";

/*
 * Capture what actually reaches the provider.
 *
 * These two headers are the only part of a broadcast that never appears in
 * the stored delivery row, so no amount of reading `email_deliveries` can
 * tell you whether they went out. The capture transport discards the message
 * entirely, and the other suites that mock `sendEmail` never inspect its
 * argument — so before this file, deleting the `unsubscribeHeaders` spread in
 * `deliver.ts` left the whole suite green while every broadcast shipped
 * without RFC 8058 one-click support.
 */
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: vi.fn(async () => ({ providerMessageId: "capture-ok" })),
  };
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { queueDeliveries } from "@/db/queries/email-deliveries";
import { deliverBatchForSource } from "@/lib/notifications/deliver";
import { sendEmail } from "@/lib/email";
import { user } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const BROADCAST_SOURCE = "44444444-4444-4444-4444-444444444444";
const TRANSACTIONAL_SOURCE = "55555555-5555-5555-5555-555555555555";

describe("one-click unsubscribe headers on a real send", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
    vi.mocked(sendEmail).mockClear();
    await db.insert(user).values({ id: "u1", name: "U1", email: "u1@example.com" });
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("sends a broadcast with List-Unsubscribe and one-click POST", async () => {
    await queueDeliveries(db, {
      sourceType: "announcement",
      sourceId: BROADCAST_SOURCE,
      template: "announcement.posted",
      category: "broadcast",
      recipients: [{ userId: "u1", email: "u1@example.com" }],
      render: () => ({ subject: "Recital", text: "text", html: "<p>html</p>" }),
    });

    await deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: BROADCAST_SOURCE,
      limit: 10,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    /*
     * The address has to be the POST endpoint, and it has to name this
     * recipient. A header pointing at the page would make Gmail's one-click
     * button a 405, and one signed for somebody else would opt out the wrong
     * family — both invisible without decoding the token here.
     */
    const header = message.headers?.["List-Unsubscribe"];
    expect(header).toMatch(/^<https?:\/\/\S+>$/);
    const url = new URL(header!.slice(1, -1));
    expect(url.pathname).toBe("/api/unsubscribe");
    expect(verifyUnsubscribeToken(url.searchParams.get("u")!)).toBe("u1");
  });

  it("sends transactional mail with neither header", async () => {
    await queueDeliveries(db, {
      sourceType: "class_occurrence",
      sourceId: TRANSACTIONAL_SOURCE,
      template: "class.cancelled",
      category: "transactional",
      recipients: [{ userId: "u1", email: "u1@example.com" }],
      render: () => ({ subject: "Cancelled", text: "text", html: "<p>html</p>" }),
    });

    await deliverBatchForSource(db, {
      sourceType: "class_occurrence",
      sourceId: TRANSACTIONAL_SOURCE,
      limit: 10,
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(message.headers).toBeUndefined();
  });
});
