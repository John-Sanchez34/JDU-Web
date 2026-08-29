import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { classOfferings, enrollments, families, seasons, students } from "@/db/schema";

async function seedOffering(db: TestDb, capacity = 10) {
  const [family] = await db.insert(families).values({ name: "Alvarez" }).returning();
  const [student] = await db
    .insert(students)
    .values({
      familyId: family!.id,
      firstName: "Ana",
      lastName: "Alvarez",
      birthdate: "2015-04-02",
    })
    .returning();
  const [season] = await db
    .insert(seasons)
    .values({
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-18",
      registrationOpen: true,
    })
    .returning();
  const [offering] = await db
    .insert(classOfferings)
    .values({
      seasonId: season!.id,
      name: "Ballet I",
      dayOfWeek: "monday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity,
      monthlyPriceCents: 8500,
    })
    .returning();
  return { family: family!, student: student!, season: season!, offering: offering! };
}

describe("enrollments schema", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new enrollment to pending", async () => {
    const { student, offering } = await seedOffering(db);

    const [row] = await db
      .insert(enrollments)
      .values({ studentId: student.id, classOfferingId: offering.id })
      .returning();

    expect(row?.status).toBe("pending");
    expect(row?.confirmedAt).toBeNull();
  });

  it("refuses a second live request for the same student and class", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id });

    await expect(
      db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id }),
    ).rejects.toThrow();
  });

  it("allows a fresh request once the previous one is withdrawn", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({
      studentId: student.id,
      classOfferingId: offering.id,
      status: "withdrawn",
    });

    const [row] = await db
      .insert(enrollments)
      .values({ studentId: student.id, classOfferingId: offering.id })
      .returning();

    expect(row?.status).toBe("pending");
  });

  it("removes enrollments when the class offering is deleted", async () => {
    const { student, offering } = await seedOffering(db);
    await db.insert(enrollments).values({ studentId: student.id, classOfferingId: offering.id });

    await db.delete(classOfferings);

    const rows = await db.select().from(enrollments);
    expect(rows).toHaveLength(0);
  });
});
