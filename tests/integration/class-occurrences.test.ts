import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { classOccurrences } from "@/db/schema";
import { createSeason } from "@/db/queries/seasons";
import { createOffering } from "@/db/queries/class-offerings";
import {
  listOccurrencesBetween,
  syncOccurrencesForOffering,
} from "@/db/queries/class-occurrences";

async function seedOffering(db: TestDb) {
  const season = await createSeason(db, {
    name: "Fall 2026",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  return createOffering(db, {
    seasonId: season.id,
    name: "Ballet I",
    dayOfWeek: "tuesday",
    startTime: "16:00:00",
    endTime: "17:00:00",
    capacity: 12,
    monthlyPriceCents: 6500,
    published: true,
  });
}

describe("class occurrence sync", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates one occurrence per matching weekday in the season", async () => {
    const offering = await seedOffering(db);

    const created = await syncOccurrencesForOffering(db, offering.id);

    expect(created).toBe(5);
    const rows = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, offering.id));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "scheduled")).toBe(true);
  });

  it("is idempotent when run twice", async () => {
    const offering = await seedOffering(db);

    await syncOccurrencesForOffering(db, offering.id);
    const secondRun = await syncOccurrencesForOffering(db, offering.id);

    expect(secondRun).toBe(0);
    const rows = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.classOfferingId, offering.id));
    expect(rows).toHaveLength(5);
  });

  it("preserves a cancellation when re-synced", async () => {
    const offering = await seedOffering(db);
    await syncOccurrencesForOffering(db, offering.id);

    await db
      .update(classOccurrences)
      .set({ status: "cancelled", note: "Studio closed" })
      .where(eq(classOccurrences.date, "2026-09-15"));

    await syncOccurrencesForOffering(db, offering.id);

    const [cancelled] = await db
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.date, "2026-09-15"));
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.note).toBe("Studio closed");
  });

  it("lists occurrences in a date window in ascending order", async () => {
    const offering = await seedOffering(db);
    await syncOccurrencesForOffering(db, offering.id);

    const window = await listOccurrencesBetween(db, "2026-09-08", "2026-09-22");

    expect(window.map((row) => row.occurrence.date)).toEqual([
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
    ]);
    expect(window[0]?.offering.name).toBe("Ballet I");
  });

  it("throws for an unknown offering", async () => {
    await expect(
      syncOccurrencesForOffering(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow("not found");
  });
});
