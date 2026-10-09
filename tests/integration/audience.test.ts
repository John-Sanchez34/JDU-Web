import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  audienceSeasonId,
  resolveAnnouncementAudience,
  resolveOccurrenceAudience,
} from "@/db/queries/audience";
import { requestEnrollment } from "@/db/queries/enrollments";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { classOccurrences, classOfferings, user } from "@/db/schema";

const TODAY = "2026-10-01";

describe("audience resolution", () => {
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

  async function request(familyId: string, studentId: string, offeringId: string) {
    const result = await requestEnrollment(db, familyId, {
      studentId,
      offeringId,
      actorUserId: null,
    });
    if (!result.ok) throw new Error(`expected the request to succeed, got ${result.reason}`);
    return result.enrollment;
  }

  it("addresses every parent login on a currently enrolled family", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("a2", "a2@example.com", seeded.familyA.id);
    await addLogin("b1", "b1@example.com", seeded.familyB.id);
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com", "a2@example.com"]);
  });

  it("excludes a login that opted out of broadcast mail", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("a2", "a2@example.com", seeded.familyA.id);
    await db
      .update(user)
      .set({ broadcastOptedOutAt: new Date() })
      .where(eq(user.id, "a2"));
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("addresses a login once however many seats their family holds", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    const [second] = await db
      .insert(classOfferings)
      .values({
        seasonId: seeded.offering.seasonId,
        name: "Tap I",
        dayOfWeek: "tuesday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 5,
        monthlyPriceCents: 8500,
        published: true,
      })
      .returning();
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await request(seeded.familyA.id, seeded.studentA.id, second!.id);

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );

    expect(recipients).toHaveLength(1);
  });

  it("narrows to one class when the audience is that class", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await addLogin("b1", "b1@example.com", seeded.familyB.id);
    /*
     * Family B must hold a live seat of its own, in a DIFFERENT class.
     * Without that, b1 would be absent from the result whether or not the
     * class predicate did anything at all — the test would pass against a
     * query that ignored `classOfferingId` entirely, which is exactly the
     * bug it is supposed to catch.
     */
    const [other] = await db
      .insert(classOfferings)
      .values({
        seasonId: seeded.offering.seasonId,
        name: "Jazz I",
        dayOfWeek: "wednesday",
        startTime: "17:00:00",
        endTime: "18:00:00",
        capacity: 5,
        monthlyPriceCents: 8500,
        published: true,
      })
      .returning();
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await request(seeded.familyB.id, seeded.studentB.id, other!.id);

    // Both families are in the season, so "everyone" reaches both …
    const everyone = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      TODAY,
    );
    expect(everyone.map((r) => r.email)).toEqual(["a1@example.com", "b1@example.com"]);

    // … and naming one class cuts it to that class's family.
    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "class_offering", classOfferingId: seeded.offering.id },
      TODAY,
    );

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("falls back to the most recent season when none contains today", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);

    // The seeded season is 2026-09-01 to 2026-12-18; ask from the following July.
    const seasonId = await audienceSeasonId(db, "2027-07-04");
    expect(seasonId).not.toBeNull();

    const recipients = await resolveAnnouncementAudience(
      db,
      { audienceType: "all", classOfferingId: null },
      "2027-07-04",
    );
    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });

  it("reaches an opted-out login when the class is cancelled", async () => {
    const seeded = await seedTwoFamilies(db, 5);
    await addLogin("a1", "a1@example.com", seeded.familyA.id);
    await db
      .update(user)
      .set({ broadcastOptedOutAt: new Date() })
      .where(eq(user.id, "a1"));
    await request(seeded.familyA.id, seeded.studentA.id, seeded.offering.id);
    await syncOccurrencesForOffering(db, seeded.offering.id);
    const [occurrence] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, seeded.offering.id))
      .limit(1);

    const recipients = await resolveOccurrenceAudience(db, occurrence!.id);

    expect(recipients.map((r) => r.email)).toEqual(["a1@example.com"]);
  });
});
