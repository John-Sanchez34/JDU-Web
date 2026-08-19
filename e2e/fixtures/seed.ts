import { like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { createOffering } from "@/db/queries/class-offerings";
import { createSeason } from "@/db/queries/seasons";
import * as schema from "@/db/schema";
import { seasons } from "@/db/schema";

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
