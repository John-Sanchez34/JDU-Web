import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { updateOffering } from "@/db/queries/class-offerings";
import { isCheckViolation, requestEnrollment } from "@/db/queries/enrollments";

/*
 * Shrinking a class below the seats already claimed is refused by the
 * `class_offerings_seats_within_capacity` CHECK, not by application code. These
 * tests pin that down and, more importantly, pin down that the failure is
 * recognisable — the admin form has to turn it into a sentence rather than a
 * 500.
 */
describe("lowering capacity below the seats already taken", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("is rejected by the database", async () => {
    const { familyA, familyB, studentA, studentB, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    await requestEnrollment(db, familyB.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    await expect(updateOffering(db, offering.id, { capacity: 1 })).rejects.toThrow();
  });

  it("is recognisable as a check violation", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    let caught: unknown;
    try {
      await updateOffering(db, offering.id, { capacity: 0 });
    } catch (error) {
      caught = error;
    }

    expect(isCheckViolation(caught)).toBe(true);
  });

  it("allows lowering capacity to exactly the seats taken", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    const updated = await updateOffering(db, offering.id, { capacity: 1 });

    expect(updated?.capacity).toBe(1);
  });
});
