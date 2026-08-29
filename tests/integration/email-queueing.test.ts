import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { queueEnrollmentEmails } from "@/db/queries/email-deliveries";
import { requestEnrollment } from "@/db/queries/enrollments";
import { emailDeliveries, user } from "@/db/schema";

describe("queueEnrollmentEmails", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function addLogin(id: string, email: string, familyId: string) {
    await db.insert(user).values({ id, name: id, email, familyId });
  }

  it("writes one row per parent login on the family", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    await addLogin("user-2", "two@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // Task 5 makes requestEnrollment queue its own rows; this test is about
    // queueEnrollmentEmails in isolation, so start from an empty table.
    await db.delete(emailDeliveries);

    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.confirmed",
    });

    expect(ids).toHaveLength(2);
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, requested.enrollment.id));
    expect(rows.map((r) => r.recipientEmail).sort()).toEqual([
      "one@example.com",
      "two@example.com",
    ]);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
    expect(rows.every((r) => r.category === "transactional")).toBe(true);
    expect(rows.every((r) => r.sourceType === "enrollment")).toBe(true);
  });

  it("stores the rendered message on the row", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // Task 5 makes requestEnrollment queue its own rows; this test is about
    // queueEnrollmentEmails in isolation, so start from an empty table.
    await db.delete(emailDeliveries);

    await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.requested",
    });

    const [row] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.sourceId, requested.enrollment.id));
    expect(row!.subject).toContain("Ballet I");
    expect(row!.bodyText).toContain("Ana");
    expect(row!.bodyText).toContain("$85.00");
    expect(row!.bodyHtml).toContain("<p");
  });

  it("writes nothing for a family with no logins", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");

    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: requested.enrollment.id,
      template: "enrollment.released",
    });

    expect(ids).toEqual([]);
  });

  it("writes nothing for an enrollment that does not exist", async () => {
    const ids = await queueEnrollmentEmails(db, {
      enrollmentId: "11111111-1111-1111-1111-111111111111",
      template: "enrollment.confirmed",
    });

    expect(ids).toEqual([]);
  });

  it("leaves no rows behind when the surrounding transaction rolls back", async () => {
    const { familyA, studentA, offering } = await seedTwoFamilies(db, 5);
    await addLogin("user-1", "one@example.com", familyA.id);
    const requested = await requestEnrollment(db, familyA.id, {
      studentId: studentA.id,
      offeringId: offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // The request itself queued nothing yet — Task 5 wires that up.
    await db.delete(emailDeliveries);

    await expect(
      db.transaction(async (tx) => {
        await queueEnrollmentEmails(tx, {
          enrollmentId: requested.enrollment.id,
          template: "enrollment.confirmed",
        });
        throw new Error("roll it back");
      }),
    ).rejects.toThrow("roll it back");

    const rows = await db.select().from(emailDeliveries);
    expect(rows).toEqual([]);
  });
});
