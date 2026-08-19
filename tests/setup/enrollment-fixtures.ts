import { eq } from "drizzle-orm";
import { classOfferings, families, seasons, students } from "@/db/schema";
import type { TestDb } from "./db";

/**
 * Seeds two families, one student each, and one class offering they can both
 * request a seat in. Shared across the enrollment integration tests (request,
 * confirm, cancel/withdraw, and the staff queue) so the two-family shape stays
 * consistent everywhere a duplicate-vs-capacity distinction matters.
 *
 * Two different families/students, not one family with two students: the
 * concurrency tests need the partial unique index to be a non-factor so that
 * capacity — not the duplicate guard — is what rejects the loser.
 */
export async function seedTwoFamilies(
  db: TestDb,
  capacity: number,
  opts?: { published?: boolean; registrationOpen?: boolean },
) {
  const published = opts?.published ?? true;
  const registrationOpen = opts?.registrationOpen ?? true;

  const [familyA] = await db.insert(families).values({ name: "Alvarez" }).returning();
  const [familyB] = await db.insert(families).values({ name: "Brooks" }).returning();
  const [studentA] = await db
    .insert(students)
    .values({ familyId: familyA!.id, firstName: "Ana", lastName: "Alvarez", birthdate: "2015-04-02" })
    .returning();
  const [studentB] = await db
    .insert(students)
    .values({ familyId: familyB!.id, firstName: "Ben", lastName: "Brooks", birthdate: "2014-07-19" })
    .returning();
  const [season] = await db
    .insert(seasons)
    .values({ name: "Fall 2026", startDate: "2026-09-01", endDate: "2026-12-18", registrationOpen })
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
      published,
    })
    .returning();

  return {
    familyA: familyA!,
    familyB: familyB!,
    studentA: studentA!,
    studentB: studentB!,
    offering: offering!,
  };
}

/** Reads the current seat count for one offering. */
export async function seatsTaken(db: TestDb, offeringId: string): Promise<number> {
  const [row] = await db.select().from(classOfferings).where(eq(classOfferings.id, offeringId));
  return row!.seatsTaken;
}
