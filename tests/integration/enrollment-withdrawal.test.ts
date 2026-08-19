import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seatsTaken, seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  confirmEnrollment,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";

describe("withdrawEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("withdraws an active enrollment and frees the seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    const result = await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("withdrawn");
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("withdraws a still-pending request", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("refuses to withdraw another family's enrollment", async () => {
    const { familyA, familyB, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const result = await withdrawEnrollment(db, familyB.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    // The seat stays held — the attempt changed nothing.
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("lets the student request the class again after withdrawing", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const first = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the request to succeed");
    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: first.enrollment.id,
      actorUserId: null,
    });

    const second = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // A new row, not the old one revived — the history is kept.
    expect(second.enrollment.id).not.toBe(first.enrollment.id);
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });
});
