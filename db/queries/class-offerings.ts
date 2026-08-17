import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classOfferings,
  type ClassOffering,
  type DayOfWeek,
} from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;

export type NewOfferingInput = {
  seasonId: string;
  name: string;
  description?: string | null;
  level?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room?: string | null;
  instructor?: string | null;
  capacity: number;
  monthlyPriceCents: number;
  seasonFeeCents?: number;
  published?: boolean;
};

/**
 * Sorts by weekday in calendar order (Sunday first) then start time.
 * The enum's declaration order gives us this for free — sorting the text
 * value would put Friday before Monday.
 */
const weekdayThenTime = [
  asc(sql`${classOfferings.dayOfWeek}::"day_of_week"`),
  asc(classOfferings.startTime),
  asc(classOfferings.name),
];

export async function listPublishedOfferings(
  db: Database,
  seasonId: string,
): Promise<ClassOffering[]> {
  return db
    .select()
    .from(classOfferings)
    .where(
      and(
        eq(classOfferings.seasonId, seasonId),
        eq(classOfferings.published, true),
      ),
    )
    .orderBy(...weekdayThenTime);
}

export async function listAllOfferings(
  db: Database,
  seasonId: string,
): Promise<ClassOffering[]> {
  return db
    .select()
    .from(classOfferings)
    .where(eq(classOfferings.seasonId, seasonId))
    .orderBy(...weekdayThenTime);
}

export async function getOffering(
  db: Database,
  offeringId: string,
): Promise<ClassOffering | null> {
  const [row] = await db
    .select()
    .from(classOfferings)
    .where(eq(classOfferings.id, offeringId))
    .limit(1);
  return row ?? null;
}

export async function createOffering(
  db: Database,
  input: NewOfferingInput,
): Promise<ClassOffering> {
  const [row] = await db.insert(classOfferings).values(input).returning();
  if (!row) throw new Error("createOffering: insert returned no row");
  return row;
}

export async function updateOffering(
  db: Database,
  offeringId: string,
  input: Partial<NewOfferingInput>,
): Promise<ClassOffering | null> {
  const [row] = await db
    .update(classOfferings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(classOfferings.id, offeringId))
    .returning();
  return row ?? null;
}
