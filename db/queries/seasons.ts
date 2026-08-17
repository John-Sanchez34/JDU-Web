import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { seasons, type Season } from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewSeasonInput = {
  name: string;
  startDate: string;
  endDate: string;
  registrationOpen?: boolean;
};

export async function listSeasons(db: Database): Promise<Season[]> {
  return db.select().from(seasons).orderBy(desc(seasons.startDate));
}

export async function getSeason(
  db: Database,
  seasonId: string,
): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  return row ?? null;
}

/** Returns the season whose date range contains `today`, inclusive of both ends. */
export async function getCurrentSeason(
  db: Database,
  today: string,
): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(lte(seasons.startDate, today), gte(seasons.endDate, today)))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  return row ?? null;
}

export async function createSeason(
  db: Database,
  input: NewSeasonInput,
): Promise<Season> {
  const [row] = await db.insert(seasons).values(input).returning();
  if (!row) throw new Error("createSeason: insert returned no row");
  return row;
}

export async function updateSeason(
  db: Database,
  seasonId: string,
  input: Partial<NewSeasonInput>,
): Promise<Season | null> {
  const [row] = await db
    .update(seasons)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId))
    .returning();
  return row ?? null;
}
