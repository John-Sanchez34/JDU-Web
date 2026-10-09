import { and, asc, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  classOccurrences,
  classOfferings,
  seasons,
  emailDeliveries,
  type ClassOccurrence,
  type ClassOffering,
} from "@/db/schema";
import { generateOccurrenceDates } from "@/lib/occurrences";
import { renderClassOccurrenceEmail } from "@/lib/emails/class-occurrence";
import { resolveOccurrenceAudience } from "./audience";
import { recordAudit } from "./audit-log";
import { queueDeliveries } from "./email-deliveries";
import type { Transaction } from "./executor";

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

/** Occurrences from `from` onwards — what staff can still cancel. */
export async function listUpcomingOccurrences(
  db: Database,
  offeringId: string,
  from: string,
): Promise<ClassOccurrence[]> {
  return db
    .select()
    .from(classOccurrences)
    .where(
      and(
        eq(classOccurrences.classOfferingId, offeringId),
        gte(classOccurrences.date, from),
      ),
    )
    .orderBy(asc(classOccurrences.date));
}

export type OccurrenceTransitionResult =
  | { ok: true; occurrence: ClassOccurrence; deliveryIds: string[] }
  | { ok: false; reason: "not-found" | "not-scheduled" | "not-cancelled" };

/** The class details an occurrence email needs, read inside the transaction. */
async function occurrenceEmailData(exec: Transaction, occurrenceId: string) {
  const [row] = await exec
    .select({
      className: classOfferings.name,
      startTime: classOfferings.startTime,
      endTime: classOfferings.endTime,
      date: classOccurrences.date,
    })
    .from(classOccurrences)
    .innerJoin(classOfferings, eq(classOfferings.id, classOccurrences.classOfferingId))
    .where(eq(classOccurrences.id, occurrenceId))
    .limit(1);
  return row ?? null;
}

/**
 * Cancels one dated occurrence and tells the roster.
 *
 * The status predicate makes a double submit harmless: the second call moves
 * zero rows, so nobody is emailed twice about the same cancellation.
 *
 * Transactional mail — every family holding a live seat is told, whatever
 * their broadcast preference says.
 */
export async function cancelOccurrence(
  db: Database,
  input: { occurrenceId: string; reason: string; actorUserId: string | null },
): Promise<OccurrenceTransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, input.occurrenceId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(classOccurrences)
      .set({ status: "cancelled", note: input.reason, updatedAt: new Date() })
      .where(
        and(
          eq(classOccurrences.id, input.occurrenceId),
          eq(classOccurrences.status, "scheduled"),
        ),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-scheduled" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "occurrence.cancelled",
      entityType: "class_occurrence",
      entityId: row.id,
      before: { status: before.status, note: before.note },
      after: { status: row.status, note: row.note },
    });

    /*
     * Drop any reinstatement that never went out. `deliverBatchForSource`
     * takes every queued row for the occurrence regardless of template and
     * works through them by `createdAt`, so a restoration whose `after()` was
     * interrupted would be flushed by this cancellation's batch — and the
     * roster would read "it is going ahead after all" immediately before
     * being told it is cancelled. The mirror of the cleanup in
     * `restoreOccurrence`.
     */
    await tx
      .delete(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.restored"),
          inArray(emailDeliveries.status, ["queued", "failed"]),
        ),
      );

    const details = await occurrenceEmailData(tx, row.id);
    if (!details) throw new Error(`cancelOccurrence: ${row.id} lost its offering mid-transaction`);
    const recipients = await resolveOccurrenceAudience(tx, row.id);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "class_occurrence",
      sourceId: row.id,
      template: "class.cancelled",
      category: "transactional",
      recipients,
      render: () => renderClassOccurrenceEmail("class.cancelled", { ...details, reason: input.reason }),
    });

    return { ok: true, occurrence: row, deliveryIds } as const;
  });
}

/**
 * Puts a cancelled occurrence back, and corrects the record for whoever was
 * told otherwise.
 *
 * Cancellation rows still `queued` are deleted: they describe a message that
 * was never sent and now must never be sent, and the audit log keeps both the
 * cancellation and this restoration, so no history is lost. A row in `sending`
 * is left alone — it may already be with the provider — and its recipient is
 * treated as having been told.
 *
 * The effect is that a cancel-then-undo within seconds is silent, while a real
 * reinstatement reaches exactly the people who were misinformed.
 */
export async function restoreOccurrence(
  db: Database,
  input: { occurrenceId: string; actorUserId: string | null },
): Promise<OccurrenceTransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(classOccurrences)
      .where(eq(classOccurrences.id, input.occurrenceId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(classOccurrences)
      .set({ status: "scheduled", note: null, updatedAt: new Date() })
      .where(
        and(
          eq(classOccurrences.id, input.occurrenceId),
          eq(classOccurrences.status, "cancelled"),
        ),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-cancelled" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "occurrence.restored",
      entityType: "class_occurrence",
      entityId: row.id,
      before: { status: before.status, note: before.note },
      after: { status: row.status, note: row.note },
    });

    /*
     * Never sent, so never send it. `failed` counts as never sent too: the
     * family was not told, and the row would otherwise sit on the retry page
     * with nothing to say it is obsolete, so pressing Retry would announce a
     * cancellation for a class that is running.
     */
    await tx
      .delete(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.cancelled"),
          inArray(emailDeliveries.status, ["queued", "failed"]),
        ),
      );

    /*
     * The boundary between this cancellation and any earlier one. A date can
     * be cancelled, restored, and cancelled again, and the earlier cycle's
     * `sent` rows are kept on purpose — they really were sent. Without this
     * bound they would be found again, and the roster would be corrected
     * about a cancellation they never received.
     */
    const [lastRestored] = await tx
      .select({ createdAt: emailDeliveries.createdAt })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.restored"),
        ),
      )
      .orderBy(desc(emailDeliveries.createdAt))
      .limit(1);

    /*
     * Whoever actually heard the cancellation — or may be hearing it right
     * now. Distinct, because one recipient can hold more than one matching
     * row and each duplicate would become another copy of the same email.
     */
    const told = await tx
      .selectDistinct({
        userId: emailDeliveries.recipientUserId,
        email: emailDeliveries.recipientEmail,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.sourceType, "class_occurrence"),
          eq(emailDeliveries.sourceId, row.id),
          eq(emailDeliveries.template, "class.cancelled"),
          inArray(emailDeliveries.status, ["sent", "sending"]),
          ...(lastRestored ? [gt(emailDeliveries.createdAt, lastRestored.createdAt)] : []),
        ),
      );

    const recipients = told
      .filter((r): r is { userId: string; email: string } => r.userId !== null)
      .map((r) => ({ userId: r.userId, email: r.email }));

    if (recipients.length === 0) {
      return { ok: true, occurrence: row, deliveryIds: [] } as const;
    }

    const details = await occurrenceEmailData(tx, row.id);
    if (!details) throw new Error(`restoreOccurrence: ${row.id} lost its offering mid-transaction`);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "class_occurrence",
      sourceId: row.id,
      template: "class.restored",
      category: "transactional",
      recipients,
      render: () => renderClassOccurrenceEmail("class.restored", { ...details, reason: null }),
    });

    return { ok: true, occurrence: row, deliveryIds } as const;
  });
}
