import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seatsTaken, seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { confirmEnrollment, releaseEnrollment, requestEnrollment } from "@/db/queries/enrollments";

describe("confirmEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("moves a pending request to active without changing the seat count", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await confirmEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("active");
    expect(result.enrollment.confirmedAt).not.toBeNull();
    expect(result.enrollment.startDate).not.toBeNull();
    // The seat was already held by the pending request.
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("refuses to confirm a request that is not pending", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const result = await confirmEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-pending" });
  });

  it("reports a missing enrollment", async () => {
    const result = await confirmEnrollment(db, {
      enrollmentId: crypto.randomUUID(),
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("releaseEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns the seat to the class", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await releaseEnrollment(db, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("released");
    expect(result.enrollment.endDate).not.toBeNull();
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  /*
   * Two staff members clicking Release on the same request. Without the status
   * predicate on the UPDATE, both would decrement and the counter would drift
   * below the true roster.
   */
  it("does not release the same seat twice", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const [first, second] = await Promise.all([
      releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null }),
      releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null }),
    ]);

    expect([first!.ok, second!.ok].filter(Boolean)).toHaveLength(1);
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("frees the seat for another family", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await releaseEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const second = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(second.ok).toBe(true);
  });
});
