import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seatsTaken, seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { enrollments } from "@/db/schema";
import { requestEnrollment } from "@/db/queries/enrollments";
import { listAuditEntries } from "@/db/queries/audit-log";

describe("requestEnrollment", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates a pending enrollment and claims a seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollment.status).toBe("pending");
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("writes an audit entry for the request", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!result.ok) throw new Error("expected the request to succeed");

    const entries = await listAuditEntries(db, "enrollment", result.enrollment.id);
    expect(entries.map((e) => e.action)).toEqual(["enrollment.requested"]);
  });

  it("rejects a request for a student in another family", async () => {
    const { familyA, studentB, offering } = await seedTwoFamilies(db, 10);

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("rejects a request when the class is full", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const result = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "full" });
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  it("rejects a request when registration is closed for the season", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10, { registrationOpen: false });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(await seatsTaken(db, offering.id)).toBe(0);
  });

  it("rejects a request for an unpublished class", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10, { published: false });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "closed" });
  });

  it("rejects a duplicate request and does not consume a second seat", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result).toEqual({ ok: false, reason: "duplicate" });
    expect(await seatsTaken(db, offering.id)).toBe(1);
  });

  /*
   * The test this whole mechanism exists for. Two parents click at the same
   * moment on the last seat. Exactly one may win.
   *
   * `vitest.config.ts` sets `fileParallelism: false`, so concurrency here comes
   * from two promises sharing one pool, not from parallel test files.
   */
  it("lets exactly one of two simultaneous requests take the last seat", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 1);

    const results = await Promise.all([
      requestEnrollment(db, familyA.id, {
        studentId: studentA.id,
        offeringId: offering.id,
        actorUserId: null,
      }),
      requestEnrollment(db, familyB.id, {
        studentId: studentB.id,
        offeringId: offering.id,
        actorUserId: null,
      }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "full" });
    expect(await seatsTaken(db, offering.id)).toBe(1);

    const rows = await db.select().from(enrollments);
    expect(rows).toHaveLength(1);
  });
});
