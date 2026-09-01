import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  confirmEnrollment,
  releaseEnrollment,
  requestEnrollment,
  withdrawEnrollment,
} from "@/db/queries/enrollments";
import { emailDeliveries, user } from "@/db/schema";

describe("the three transitions queue their emails", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedWithLogin() {
    const seeded = await seedTwoFamilies(db, 5);
    await db.insert(user).values({
      id: "user-1",
      name: "Ana Alvarez",
      email: "one@example.com",
      familyId: seeded.familyA.id,
    });
    return seeded;
  }

  async function templatesFor(enrollmentId: string) {
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, enrollmentId));
    return rows.map((row) => row.template).sort();
  }

  it("queues a requested email and returns its id", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();

    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deliveryIds).toHaveLength(1);
    expect(await templatesFor(result.enrollment.id)).toEqual(["enrollment.requested"]);
  });

  it("queues a confirmed email", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
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
    expect(result.deliveryIds).toHaveLength(1);
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.confirmed",
      "enrollment.requested",
    ]);
  });

  it("queues a released email", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
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
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.released",
      "enrollment.requested",
    ]);
  });

  it("queues nothing when a parent withdraws", async () => {
    const { familyA, studentA, offering } = await seedWithLogin();
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

    // The family did this themselves; telling them about it is noise.
    expect(await templatesFor(requested.enrollment.id)).toEqual([
      "enrollment.requested",
    ]);
  });

  it("queues nothing when the request is rejected", async () => {
    const { familyA, studentA, studentB, offering } = await seedWithLogin();
    await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    await db.delete(emailDeliveries);

    // Another family's student: rejected before anything is written.
    const result = await requestEnrollment(db, familyA.id, {
      studentId: studentB.id,
      offeringId: offering.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(emailDeliveries)).toEqual([]);
  });
});
