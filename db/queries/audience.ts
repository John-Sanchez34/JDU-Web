import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import {
  classOccurrences,
  classOfferings,
  enrollments,
  seasons,
  students,
  user,
  type AnnouncementAudience,
} from "@/db/schema";
import type { Executor } from "./executor";

/** One addressee. The id is needed for the delivery row and the opt-out link. */
export type Recipient = { userId: string; email: string };

/** A seat that means the family is currently part of the studio. */
const LIVE_STATUSES = ["pending", "active"] as const;

/**
 * Which season "everyone" means.
 *
 * The season containing today, or — when none does — the most recently started
 * one. Without that fallback a July announcement about autumn registration
 * would resolve to nobody, because between seasons no season contains today.
 *
 * Deliberately not `getCurrentSeason` from `./seasons`: that takes a
 * `Database` and has no fallback, and both matter here.
 */
export async function audienceSeasonId(
  exec: Executor,
  today: string,
): Promise<string | null> {
  const [current] = await exec
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(lte(seasons.startDate, today), gte(seasons.endDate, today)))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  if (current) return current.id;

  const [recent] = await exec
    .select({ id: seasons.id })
    .from(seasons)
    .where(lte(seasons.startDate, today))
    .orderBy(desc(seasons.startDate))
    .limit(1);
  return recent?.id ?? null;
}

/**
 * Who receives one announcement.
 *
 * Distinct by login, not by family: a family holding three seats is one
 * recipient per parent, not three. The opt-out is filtered in SQL alongside
 * everything else, so a caller cannot forget it.
 */
export async function resolveAnnouncementAudience(
  exec: Executor,
  input: { audienceType: AnnouncementAudience; classOfferingId: string | null },
  today: string,
): Promise<Recipient[]> {
  let scope: SQL | null;
  if (input.audienceType === "class_offering") {
    scope = input.classOfferingId
      ? eq(enrollments.classOfferingId, input.classOfferingId)
      : null;
  } else {
    const seasonId = await audienceSeasonId(exec, today);
    scope = seasonId ? eq(classOfferings.seasonId, seasonId) : null;
  }

  // No season and no class means no audience — not an error, just nobody.
  if (!scope) return [];

  return exec
    .selectDistinct({ userId: user.id, email: user.email })
    .from(user)
    .innerJoin(students, eq(students.familyId, user.familyId))
    .innerJoin(enrollments, eq(enrollments.studentId, students.id))
    .innerJoin(classOfferings, eq(classOfferings.id, enrollments.classOfferingId))
    .where(
      and(
        inArray(enrollments.status, LIVE_STATUSES),
        // Broadcast honours the preference. Cancellations below do not.
        isNull(user.broadcastOptedOutAt),
        scope,
      ),
    )
    .orderBy(asc(user.email));
}

/**
 * Who receives a cancellation or a restoration: the roster of the class that
 * occurrence belongs to.
 *
 * No opt-out filter, on purpose. This is transactional mail, and a family
 * cannot decline to be told that their own class is not happening.
 */
export async function resolveOccurrenceAudience(
  exec: Executor,
  occurrenceId: string,
): Promise<Recipient[]> {
  return exec
    .selectDistinct({ userId: user.id, email: user.email })
    .from(classOccurrences)
    .innerJoin(enrollments, eq(enrollments.classOfferingId, classOccurrences.classOfferingId))
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .innerJoin(user, eq(user.familyId, students.familyId))
    .where(
      and(eq(classOccurrences.id, occurrenceId), inArray(enrollments.status, LIVE_STATUSES)),
    )
    .orderBy(asc(user.email));
}
