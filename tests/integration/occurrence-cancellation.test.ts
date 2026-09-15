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
import { markSent } from "@/db/queries/email-deliveries";
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
    const { occurrence } = await seedRosterOfOne();
    const cancelled = await cancelOccurrence(db, {
      occurrenceId: occurrence.id,
      reason: "Mistake.",
      actorUserId: null,
    });
    if (!cancelled.ok) throw new Error("expected the cancellation to succeed");
    await markSent(db, cancelled.deliveryIds[0]!, "capture-1");

    const result = await restoreOccurrence(db, {
      occurrenceId: occurrence.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliveryIds).toHaveLength(1);
    // The sent cancellation stays on the record — it really was sent.
    expect(await deliveriesFor(occurrence.id, "class.cancelled")).toHaveLength(1);
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
});
