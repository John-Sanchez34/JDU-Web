import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  confirmEnrollment,
  listFamilyEnrollments,
  listPendingRequests,
  listRoster,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";

describe("listPendingRequests", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns pending requests oldest first", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const first = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!first.ok) throw new Error("expected the request to succeed");
    const second = await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!second.ok) throw new Error("expected the request to succeed");

    const queue = await listPendingRequests(db);

    expect(queue.map((r) => r.enrollmentId)).toEqual([
      first.enrollment.id,
      second.enrollment.id,
    ]);
    expect(queue[0]?.studentFirstName).toBe("Ana");
    expect(queue[0]?.className).toBe("Ballet I");
    expect(queue[0]?.familyName).toBe("Alvarez");
  });

  it("drops a request once it is confirmed", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: requested.enrollment.id, actorUserId: null });

    expect(await listPendingRequests(db)).toHaveLength(0);
  });
});

describe("listRoster", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("includes both pending and active students", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const a = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!a.ok) throw new Error("expected the request to succeed");
    await confirmEnrollment(db, { enrollmentId: a.enrollment.id, actorUserId: null });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const roster = await listRoster(db, offering.id);

    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.status).sort()).toEqual(["active", "pending"]);
  });

  it("excludes withdrawn students", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 10);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: requested.enrollment.id,
      actorUserId: null,
    });

    expect(await listRoster(db, offering.id)).toHaveLength(0);
  });
});

describe("listFamilyEnrollments", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("returns only this family's enrollments, including finished ones", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 10);
    const mine = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!mine.ok) throw new Error("expected the request to succeed");
    await withdrawEnrollment(db, familyA.id, {
      enrollmentId: mine.enrollment.id,
      actorUserId: null,
    });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const rows = await listFamilyEnrollments(db, familyA.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("withdrawn");
    expect(rows[0]?.studentFirstName).toBe("Ana");
  });
});
