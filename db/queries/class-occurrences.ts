import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classOccurrences,
  classOfferings,
  seasons,
  type ClassOccurrence,
  type ClassOffering,
} from "@/db/schema";
import { generateOccurrenceDates } from "@/lib/occurrences";

type Database = NodePgDatabase<typeof schema>;

export type ScheduledClass = {
  occurrence: ClassOccurrence;
  offering: ClassOffering;
};

/**
 * Creates any missing occurrences for an offering across its season's date
 * range. Existing rows are left untouched, so cancellations and notes survive
 * a re-sync. Returns the number of rows actually inserted.
 */
export async function syncOccurrencesForOffering(
  db: Database,
  offeringId: string,
): Promise<number> {
  const [row] = await db
    .select({ offering: classOfferings, season: seasons })
    .from(classOfferings)
    .innerJoin(seasons, eq(classOfferings.seasonId, seasons.id))
    .where(eq(classOfferings.id, offeringId))
    .limit(1);

  if (!row) {
    throw new Error(`syncOccurrencesForOffering: offering ${offeringId} not found`);
  }

  const dates = generateOccurrenceDates(
    row.season.startDate,
    row.season.endDate,
    row.offering.dayOfWeek,
  );
  if (dates.length === 0) return 0;

  const inserted = await db
    .insert(classOccurrences)
    .values(dates.map((date) => ({ classOfferingId: offeringId, date })))
    .onConflictDoNothing({
      target: [classOccurrences.classOfferingId, classOccurrences.date],
    })
    .returning({ id: classOccurrences.id });

  return inserted.length;
}

/** Returns every occurrence of a published class in a date window, ascending. */
export async function listOccurrencesBetween(
  db: Database,
  from: string,
  to: string,
): Promise<ScheduledClass[]> {
  return db
    .select({ occurrence: classOccurrences, offering: classOfferings })
    .from(classOccurrences)
    .innerJoin(
      classOfferings,
      eq(classOccurrences.classOfferingId, classOfferings.id),
    )
    .where(
      and(
        gte(classOccurrences.date, from),
        lte(classOccurrences.date, to),
        eq(classOfferings.published, true),
      ),
    )
    .orderBy(asc(classOccurrences.date), asc(classOfferings.startTime));
}
