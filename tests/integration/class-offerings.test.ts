import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { createSeason, getCurrentSeason, listSeasons } from "@/db/queries/seasons";
import {
  createOffering,
  listAllOfferings,
  listPublishedOfferings,
  updateOffering,
} from "@/db/queries/class-offerings";

describe("seasons and class offerings", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates and lists seasons newest first", async () => {
    await createSeason(db, {
      name: "Spring 2026",
      startDate: "2026-01-05",
      endDate: "2026-05-30",
    });
    await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    const listed = await listSeasons(db);

    expect(listed.map((s) => s.name)).toEqual(["Fall 2026", "Spring 2026"]);
  });

  it("finds the season containing a given date", async () => {
    const fall = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    expect((await getCurrentSeason(db, "2026-10-15"))?.id).toBe(fall.id);
    expect(await getCurrentSeason(db, "2026-08-01")).toBeNull();
    // Boundaries are inclusive on both ends.
    expect((await getCurrentSeason(db, "2026-09-01"))?.id).toBe(fall.id);
    expect((await getCurrentSeason(db, "2026-12-19"))?.id).toBe(fall.id);
  });

  it("hides unpublished offerings from the public list", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await createOffering(db, {
      seasonId: season.id,
      name: "Ballet I",
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
      seasonFeeCents: 5000,
      published: true,
    });
    await createOffering(db, {
      seasonId: season.id,
      name: "Draft Jazz",
      dayOfWeek: "thursday",
      startTime: "17:00:00",
      endTime: "18:00:00",
      capacity: 10,
      monthlyPriceCents: 6500,
      published: false,
    });

    expect(await listPublishedOfferings(db, season.id)).toHaveLength(1);
    expect(await listAllOfferings(db, season.id)).toHaveLength(2);
  });

  it("orders offerings by weekday then start time", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    const base = {
      seasonId: season.id,
      capacity: 10,
      monthlyPriceCents: 6500,
      published: true,
    };

    await createOffering(db, {
      ...base, name: "Thursday Late", dayOfWeek: "thursday",
      startTime: "18:00:00", endTime: "19:00:00",
    });
    await createOffering(db, {
      ...base, name: "Monday Late", dayOfWeek: "monday",
      startTime: "18:00:00", endTime: "19:00:00",
    });
    await createOffering(db, {
      ...base, name: "Monday Early", dayOfWeek: "monday",
      startTime: "16:00:00", endTime: "17:00:00",
    });

    const listed = await listPublishedOfferings(db, season.id);

    expect(listed.map((o) => o.name)).toEqual([
      "Monday Early",
      "Monday Late",
      "Thursday Late",
    ]);
  });

  it("rejects a negative price at the database level", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await expect(
      createOffering(db, {
        seasonId: season.id,
        name: "Free Fall",
        dayOfWeek: "friday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 10,
        monthlyPriceCents: -100,
      }),
    ).rejects.toThrow();
  });

  it("rejects zero capacity at the database level", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });

    await expect(
      createOffering(db, {
        seasonId: season.id,
        name: "Nobody",
        dayOfWeek: "friday",
        startTime: "16:00:00",
        endTime: "17:00:00",
        capacity: 0,
        monthlyPriceCents: 6500,
      }),
    ).rejects.toThrow();
  });

  it("updates an offering", async () => {
    const season = await createSeason(db, {
      name: "Fall 2026",
      startDate: "2026-09-01",
      endDate: "2026-12-19",
    });
    const offering = await createOffering(db, {
      seasonId: season.id,
      name: "Ballet I",
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
    });

    const updated = await updateOffering(db, offering.id, {
      name: "Ballet I — Beginners",
      published: true,
    });

    expect(updated?.name).toBe("Ballet I — Beginners");
    expect(updated?.published).toBe(true);
  });
});
