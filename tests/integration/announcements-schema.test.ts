import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import { isCheckViolation } from "@/db/queries/enrollments";
import { announcements, user } from "@/db/schema";

describe("announcements schema", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("defaults a new announcement to an unpublished, unsent draft", async () => {
    const [row] = await db
      .insert(announcements)
      .values({ title: "Snow day", body: "The studio is closed.", audienceType: "all" })
      .returning();

    expect(row!.status).toBe("draft");
    expect(row!.publishedAt).toBeNull();
    expect(row!.emailedAt).toBeNull();
    expect(row!.classOfferingId).toBeNull();
  });

  it("refuses an 'all' announcement that names a class", async () => {
    const { offering } = await seedTwoFamilies(db, 5);

    const insert = db.insert(announcements).values({
      title: "Snow day",
      body: "The studio is closed.",
      audienceType: "all",
      classOfferingId: offering.id,
    });

    await expect(insert).rejects.toSatisfy(isCheckViolation);
  });

  it("refuses a class announcement that names no class", async () => {
    const insert = db.insert(announcements).values({
      title: "Ballet I is moving rooms",
      body: "We are in Studio B from Monday.",
      audienceType: "class_offering",
    });

    await expect(insert).rejects.toSatisfy(isCheckViolation);
  });

  it("accepts a class announcement that names its class", async () => {
    const { offering } = await seedTwoFamilies(db, 5);

    const [row] = await db
      .insert(announcements)
      .values({
        title: "Ballet I is moving rooms",
        body: "We are in Studio B from Monday.",
        audienceType: "class_offering",
        classOfferingId: offering.id,
      })
      .returning();

    expect(row!.classOfferingId).toBe(offering.id);
  });

  it("starts every login subscribed to broadcast mail", async () => {
    await db.insert(user).values({ id: "user-1", name: "One", email: "one@example.com" });

    const [row] = await db.select().from(user).where(eq(user.id, "user-1"));
    expect(row!.broadcastOptedOutAt).toBeNull();
  });
});
