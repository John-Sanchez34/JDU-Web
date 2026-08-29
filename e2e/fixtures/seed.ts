import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { createOffering } from "@/db/queries/class-offerings";
import { createSeason } from "@/db/queries/seasons";
import * as schema from "@/db/schema";
import { classOfferings, seasons, user } from "@/db/schema";

/**
 * Creates a published class in the test database and returns its name.
 * The season spans a wide range so the class always appears in the
 * current week regardless of when the suite runs.
 */
export async function seedSeasonWithClass(): Promise<string> {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const year = new Date().getUTCFullYear();

    // Clear seasons left by earlier runs. Without this they accumulate with
    // identical start dates, and `getCurrentSeason` breaks the tie
    // arbitrarily — so the catalog would show some previous run's class.
    // Offerings and occurrences cascade from the season.
    await db.delete(seasons).where(like(seasons.name, "E2E %"));

    const season = await createSeason(db, {
      name: `E2E ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });

    const name = `E2E Ballet ${Date.now()}`;
    const offering = await createOffering(db, {
      seasonId: season.id,
      name,
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity: 12,
      monthlyPriceCents: 6500,
      seasonFeeCents: 5000,
      published: true,
    });
    await syncOccurrencesForOffering(db, offering.id);

    return name;
  } finally {
    await pool.end();
  }
}

/**
 * Runs `fn` against the test database with its own pool, the way every helper
 * in this file connects — deliberately not through `@/db`, which reads
 * `@/lib/env` and would bind to the development database instead.
 */
async function withDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    return await fn(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}

export type SeededClass = {
  seasonId: string;
  offeringId: string;
  className: string;
};

/**
 * Creates a published class whose season is accepting requests, which is what
 * the enrollment path needs and what `seedSeasonWithClass` deliberately does
 * not give (registration defaults to closed).
 *
 * Pass `seasonId` to add another class to a season this already made — the
 * portal only lists the current season, so a test needing two classes needs
 * them under one season. Pass `seatsTaken` to start a class already full
 * without staging a request for every seat.
 */
export async function seedOpenSeasonWithClass(
  capacity: number,
  opts?: { seasonId?: string; seatsTaken?: number; name?: string },
): Promise<SeededClass> {
  return withDb(async (db) => {
    const year = new Date().getUTCFullYear();

    let seasonId = opts?.seasonId;
    if (!seasonId) {
      // Same reason as `seedSeasonWithClass`: seasons from earlier runs share
      // a start date, and `getCurrentSeason` would break the tie arbitrarily.
      await db.delete(seasons).where(like(seasons.name, "E2E %"));
      const season = await createSeason(db, {
        name: `E2E ${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year + 1}-12-31`,
        registrationOpen: true,
      });
      seasonId = season.id;
    }

    const className = opts?.name ?? `E2E Ballet ${Date.now()}`;
    const offering = await createOffering(db, {
      seasonId,
      name: className,
      dayOfWeek: "tuesday",
      startTime: "16:00:00",
      endTime: "17:00:00",
      capacity,
      monthlyPriceCents: 6500,
      seasonFeeCents: 5000,
      published: true,
    });
    await syncOccurrencesForOffering(db, offering.id);

    if (opts?.seatsTaken) {
      await db
        .update(classOfferings)
        .set({ seatsTaken: opts.seatsTaken })
        .where(eq(classOfferings.id, offering.id));
    }

    return { seasonId, offeringId: offering.id, className };
  });
}

/**
 * Promotes an account to staff with a direct UPDATE.
 *
 * Signing up cannot produce a staff account — `role` defaults to "parent" and
 * the application never lets an account change its own role — so a test that
 * needs one has to reach past the UI exactly like `npm run set-role` does.
 */
export async function promoteToStaff(email: string): Promise<void> {
  await withDb((db) =>
    db.update(user).set({ role: "staff" }).where(eq(user.email, email)),
  );
}
