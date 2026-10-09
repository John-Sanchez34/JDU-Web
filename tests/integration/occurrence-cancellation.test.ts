import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  cancelOccurrence,
  restoreOccurrence,
  syncOccurrencesForOffering,
} from "@/db/queries/class-occurrences";
import { requestEnrollment } from "@/db/queries/enrollments";
import { claimForSend, markFailed, markSent } from "@/db/queries/email-deliveries";
import { classOccurrences, emailDeliveries, user } from "@/db/schema";

describe("cancelling and restoring an occurrence", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedRosterOfOne() {
    const seeded = await seedTwoFamilies(db, 5);
    await db
      .insert(user)
      .values({ id: "a1", name: "One", email: "a1@example.com", familyId: seeded.familyA.id });
    const requested = await requestEnrollment(db, seeded.familyA.id, {
      studentId: seeded.studentA.id,
      offeringId: seeded.offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await db.delete(emailDeliveries);
    await syncOccurrencesForOffering(db, seeded.offering.id);
    const [occurrence] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, seeded.offering.id))
      .limit(1);
    return { ...seeded, occurrence: occurrence! };
  }

  function deliveriesFor(occurrenceId: string, template: string) {
    return db
      .select()
      .from(emailDeliveries)
      .where(
        and(eq(emailDeliveries.sourceId, occurrenceId), eq(emailDeliveries.template, template)),
      );
  }

  it("cancels, records the reason, and tells the roster", async () => {
    const { occurrence } = await seedRosterOfOne();

    const result = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "The instructor is unwell.",
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, occurrence.id));
    expect(row!.status).toBe("cancelled");
    expect(row!.note).toBe("The instructor is unwell.");
    const rows = await deliveriesFor(occurrence.id, "class.cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("transactional");
    expect(rows[0]!.bodyText.toLowerCase()).not.toContain("unsubscribe");
  });

  it("refuses to cancel the same occurrence twice", async () => {
    const { occurrence } = await seedRosterOfOne();
    await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow.",
      actorUserId: null,
    });

    const second = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow again.",
      actorUserId: null,
    });

    expect(second).toEqual({ ok: false, reason: "not-scheduled" });
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(1);
  });

  it("restoring before anything was sent deletes the queued mail and says nothing", async () => {
    const { occurrence } = await seedRosterOfOne();
    await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toEqual([]);
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(0);
    expect(await deliveriesFor(occurrence.id, "class.restored")).toHaveLength(0);
    const [row] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, occurrence.id));
    expect(row!.status).toBe("scheduled");
    expect(row!.note).toBeNull();
  });

  it("restoring after the cancellation went out tells exactly those people", async () => {
    const seeded = await seedRosterOfOne();
    const { occurrence } = seeded;
    /*
     * A second login on the same family, so "exactly those people" has
     * someone to exclude. With a roster of one, every recipient was told and
     * an implementation that ignored the delivery history and simply
     * re-resolved the roster would produce an identical result — the
     * assertion would pass while meaning nothing.
     */
    await db.insert(user).values({
      id: "a2",
      name: "Two",
      email: "a2@example.com",
      familyId: seeded.familyA.id,
    });

    const cancelled = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!cancelled.ok) throw new Error("expected the cancellation to succeed");
    expect(cancelled.deliveryIds).toHaveLength(2);

    // Only one of the two actually goes out before staff change their mind.
    const rows = await deliveriesFor(occurrence.id, "class.cancelled");
    const toA1 = rows.find((r) => r.recipientEmail === "a1@example.com");
    await markSent(db, toA1!.id, "capture-1");

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toHaveLength(1);
    // The sent cancellation stays on the record — it really was sent. The
    // one still queued is deleted, because it never reached anybody.
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(1);
    const restored = await deliveriesFor(occurrence.id, "class.restored");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.recipientEmail).toBe("a1@example.com");
  });


  it("tells a recipient whose cancellation was still in flight", async () => {
    const { occurrence } = await seedRosterOfOne();
    const cancelled = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!cancelled.ok) throw new Error("expected the cancellation to succeed");
    /*
     * Claim the row without completing the send. This is the awkward case the
     * `sending` half of the status filter exists for: the message is with the
     * provider at the instant staff change their mind, so it cannot be
     * unsent, and its recipient must be treated as already told.
     */
    const claimed = await claimForSend(db, cancelled.deliveryIds[0]!);
    expect(claimed?.status).toBe("sending");

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toHaveLength(1);

    // The in-flight cancellation is left exactly where it was — not deleted,
    // because it may already have reached the family.
    const stillSending = await deliveriesFor(occurrence.id, "class.cancelled");
    expect(stillSending).toHaveLength(1);
    expect(stillSending[0]!.status).toBe("sending");

    /*
     * And its recipient is told the class is back on. Drop "sending" from the
     * status filter in `restoreOccurrence` and this expectation goes to zero:
     * the family would sit out a class that is running, which is the whole
     * failure the restore exists to prevent.
     */
    const restored = await deliveriesFor(occurrence.id, "class.restored");
    expect(restored).toHaveLength(1);
    expect(restored[0]!.recipientEmail).toBe("a1@example.com");
  });
  it("refuses to restore an occurrence that is not cancelled", async () => {

    const { occurrence } = await seedRosterOfOne();

    expect(
      await restoreOccurrence(db, { occurrenceId: occurrence.id, actorUserId: null }),
    ).toEqual({ ok: false, reason: "not-cancelled" });
  });

  it("tells only the people told in this cycle when a date is cancelled twice", async () => {
    const { occurrence } = await seedRosterOfOne();

    // Cycle one: cancelled, the roster hears about it, then it is put back
    // and they hear the correction.
    const first = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow.",
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the first cancellation to succeed");
    await markSent(db, first.deliveryIds[0]!, "capture-1");
    const firstRestore = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });
    if (!firstRestore.ok) throw new Error("expected the first restore to succeed");
    await markSent(db, firstRestore.deliveryIds[0]!, "capture-2");
    expect(await deliveriesFor(occurrence.id, "class.restored")).toHaveLength(1);

    // Cycle two: cancelled again, undone before anything goes out. Nobody was
    // told this time, so nobody may be corrected.
    const second = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!second.ok) throw new Error("expected the second cancellation to succeed");

    const secondRestore = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    /*
     * Cycle one's cancellation is still on the record — it really was sent —
     * so an unscoped search for "who was told" finds it again and corrects a
     * cancellation this family never received. The previous restoration is
     * the boundary between cycles.
     */
    expect(secondRestore.ok).toBe(true);
    if (secondRestore.ok) expect(secondRestore.deliveryIds).toHaveLength(0);
    expect(await deliveriesFor(occurrence.id, "class.restored")).toHaveLength(1);
  });

  it("does not leave a failed cancellation retriable once the date is restored", async () => {
    const { occurrence } = await seedRosterOfOne();
    const cancelled = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!cancelled.ok) throw new Error("expected the cancellation to succeed");
    /*
     * A provider 5xx leaves the row `failed`, not `queued`. The family was
     * never told, so there is nothing to correct — but the row sits on the
     * retry page, and pressing Retry would announce a cancellation for a
     * class that is running.
     */
    await markFailed(db, cancelled.deliveryIds[0]!, "provider returned 503");

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toHaveLength(0);
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(0);
  });

  it("does not leave a stale restoration queued when the date is cancelled again", async () => {
    const { occurrence } = await seedRosterOfOne();
    const first = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow.",
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the first cancellation to succeed");
    await markSent(db, first.deliveryIds[0]!, "capture-1");

    /*
     * The restoration is queued but never delivered — its `after()` lost the
     * race with a deploy. Cancelling the date again must not leave that "it
     * is going ahead after all" waiting in the queue: `deliverBatchForSource`
     * takes every queued row for the occurrence regardless of template and
     * orders by `createdAt`, so the roster would hear the stale reinstatement
     * before the cancellation that replaced it.
     */
    const restored = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });
    if (!restored.ok) throw new Error("expected the restore to succeed");
    expect(restored.deliveryIds).toHaveLength(1);

    await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Snow again.",
      actorUserId: null,
    });

    const stale = (await deliveriesFor(occurrence.id, "class.restored")).filter(
      (row) => row.status === "queued",
    );
    expect(stale).toHaveLength(0);
  });
});
