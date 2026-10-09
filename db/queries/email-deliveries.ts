import { and, asc, count, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  classOfferings,
  emailDeliveries,
  enrollments,
  students,
  user,
  type EmailCategory,
  type EmailDelivery,
  type EmailDeliveryStatus,
  type EmailSourceType,
} from "@/db/schema";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailTemplate,
} from "@/lib/emails/enrollment";
import type { RenderedEmail } from "@/lib/emails/layout";
import type { Database, Executor } from "./executor";
import type { Recipient } from "./audience";

export type QueueEnrollmentInput = {
  enrollmentId: string;
  template: EnrollmentEmailTemplate;
};

/**
 * Writes one delivery row per parent login on the enrolling family.
 *
 * Takes an `Executor` so it joins the caller's transaction: a delivery for a
 * transition that rolls back must roll back with it, and a transition that
 * commits must never lose its email between two separate commits.
 *
 * A family with no logins queues nothing, and that is not an error — nobody
 * has asked to be told, so there is nobody to tell.
 */
export async function queueEnrollmentEmails(
  exec: Executor,
  input: QueueEnrollmentInput,
): Promise<string[]> {
  const [details] = await exec
    .select({
      studentFirstName: students.firstName,
      studentLastName: students.lastName,
      familyId: students.familyId,
      className: classOfferings.name,
      dayOfWeek: classOfferings.dayOfWeek,
      startTime: classOfferings.startTime,
      endTime: classOfferings.endTime,
      monthlyPriceCents: classOfferings.monthlyPriceCents,
      seasonFeeCents: classOfferings.seasonFeeCents,
    })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.id))
    .innerJoin(classOfferings, eq(enrollments.classOfferingId, classOfferings.id))
    .where(eq(enrollments.id, input.enrollmentId))
    .limit(1);
  if (!details) return [];

  const recipients = await exec
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.familyId, details.familyId))
    .orderBy(asc(user.email));
  if (recipients.length === 0) return [];

  const rendered = renderEnrollmentEmail(input.template, details);

  return queueDeliveries(exec, {
    sourceType: "enrollment",
    sourceId: input.enrollmentId,
    template: input.template,
    category: "transactional",
    // The recipient select yields `{ id, email }`; `Recipient` is
    // `{ userId, email }`.
    recipients: recipients.map((recipient) => ({
      userId: recipient.id,
      email: recipient.email,
    })),
    // Every parent on the family gets the same transactional message — unlike
    // broadcast, where the body carries a per-recipient unsubscribe link.
    render: () => rendered,
  });
}

/**
 * How long a row may sit in `sending` — or, unclaimed, in `queued` — before it
 * is assumed abandoned.
 *
 * Nothing sweeps on a timer, so without this a process that died mid-send, or
 * one that never reached `after()` at all, would strand a row in a state
 * nothing ever looks at again.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/** The instant before which a row is considered abandoned rather than merely in flight. */
function cutoffFor(now: Date): Date {
  return new Date(now.getTime() - STUCK_AFTER_MS);
}

/**
 * Takes exclusive responsibility for sending one delivery.
 *
 * The status predicate is what makes this exactly-once: the affected-row count
 * is the decision, never a read followed by a write that another process could
 * interleave with — the same discipline as the seat claim in `enrollments.ts`.
 * Null means someone else holds it, or it has already been sent.
 *
 * Accepts everything `listRetriableDeliveries` can show a staff member — plus
 * fresh `queued` rows, which is the normal path `after()` uses and never
 * appears on the list. A `sending` row with a recent `updatedAt` stays
 * unclaimable, which is exactly what preserves exactly-once: only a row
 * abandoned long enough to cross `cutoff` opens back up.
 */
export async function claimForSend(
  db: Database,
  deliveryId: string,
  now: Date = new Date(),
): Promise<EmailDelivery | null> {
  const cutoff = cutoffFor(now);

  const [row] = await db
    .update(emailDeliveries)
    .set({
      status: "sending",
      attempts: sql`${emailDeliveries.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        or(
          inArray(emailDeliveries.status, ["queued", "failed"]),
          and(eq(emailDeliveries.status, "sending"), lt(emailDeliveries.updatedAt, cutoff)),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** One delivery row by id, for surfacing its recorded error after a retry. */
export async function getDelivery(
  db: Database,
  deliveryId: string,
): Promise<EmailDelivery | null> {
  const [row] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, deliveryId))
    .limit(1);
  return row ?? null;
}

/** Records a successful send. Clears any error left by an earlier attempt. */
export async function markSent(
  db: Database,
  deliveryId: string,
  providerMessageId: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(emailDeliveries)
    .set({
      status: "sent",
      providerMessageId,
      error: null,
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(emailDeliveries.id, deliveryId));
}

/** Records a failed send, leaving the row claimable again by Retry. */
export async function markFailed(
  db: Database,
  deliveryId: string,
  error: string,
): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(eq(emailDeliveries.id, deliveryId));
}

/**
 * Everything a staff member should look at: outright failures, rows still
 * `sending` long enough that the process handling them is gone, and rows
 * still `queued` long enough that `after()` never ran at all — a deploy, a
 * SIGTERM, or the route's max duration expiring between the commit and the
 * callback.
 *
 * A *fresh* `queued` row is deliberately excluded: `after()` is about to take
 * it, and listing it here would just be noise on every page load. Only a
 * `queued` row older than `cutoff` — meaning nobody ever picked it up — earns
 * a spot. Do not "simplify" this to match every other queued row; that would
 * put the normal case on the page.
 *
 * `now` is a parameter so the boundary is testable without waiting fifteen
 * minutes.
 */
export async function listRetriableDeliveries(
  db: Database,
  now: Date = new Date(),
): Promise<EmailDelivery[]> {
  const cutoff = cutoffFor(now);

  return db
    .select()
    .from(emailDeliveries)
    .where(
      or(
        eq(emailDeliveries.status, "failed"),
        and(
          eq(emailDeliveries.status, "sending"),
          lt(emailDeliveries.updatedAt, cutoff),
        ),
        and(
          eq(emailDeliveries.status, "queued"),
          lt(emailDeliveries.createdAt, cutoff),
        ),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id));
}

export type QueueDeliveriesInput = {
  sourceType: EmailSourceType;
  sourceId: string;
  template: string;
  category: EmailCategory;
  recipients: Recipient[];
  /**
   * Called once per recipient rather than once per send.
   *
   * A broadcast body carries that recipient's own unsubscribe link, so the
   * rendered message genuinely differs row to row. Storing it per row is not
   * 3a's convention carried forward — it is forced.
   */
  render: (recipient: Recipient) => RenderedEmail;
};

/**
 * Writes one delivery row per recipient.
 *
 * Takes an `Executor` so it joins the caller's transaction: rows for a
 * transition that rolls back must roll back with it.
 *
 * An empty audience queues nothing and is not an error — nobody has asked to
 * be told, so there is nobody to tell. It returns early because an INSERT with
 * no values is a runtime error, not an empty insert.
 */
export async function queueDeliveries(
  exec: Executor,
  input: QueueDeliveriesInput,
): Promise<string[]> {
  if (input.recipients.length === 0) return [];

  const rows = await exec
    .insert(emailDeliveries)
    .values(
      input.recipients.map((recipient) => {
        const rendered = input.render(recipient);
        return {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          template: input.template,
          category: input.category,
          recipientUserId: recipient.userId,
          recipientEmail: recipient.email,
          subject: rendered.subject,
          bodyText: rendered.text,
          bodyHtml: rendered.html,
        };
      }),
    )
    .returning({ id: emailDeliveries.id });

  return rows.map((row) => row.id);
}

/**
 * Hands a claimed row back without recording an outcome.
 *
 * Used when a batch stops because the provider is rate-limiting: the row was
 * claimed but never attempted, so marking it `failed` would be a lie and
 * leaving it `sending` would strand it for fifteen minutes. `attempts` is
 * deliberately not decremented — the attempt to *claim* it did happen, and a
 * counter that goes backwards is worse than one that counts honestly.
 */
export async function releaseToQueued(db: Database, deliveryId: string): Promise<void> {
  await db
    .update(emailDeliveries)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(emailDeliveries.id, deliveryId), eq(emailDeliveries.status, "sending")));
}

/**
 * The next rows to send for one source, oldest first.
 *
 * `failed` rows are deliberately excluded. A resume sends what was never
 * attempted; an address the provider actively rejected is retried from
 * `/admin/emails` by someone who has read the error. Otherwise every press of
 * "Send the rest" would re-attempt the same dead address and re-fail it.
 */
export async function listQueuedForSource(
  db: Database,
  sourceType: EmailSourceType,
  sourceId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: emailDeliveries.id })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.sourceType, sourceType),
        eq(emailDeliveries.sourceId, sourceId),
        eq(emailDeliveries.status, "queued"),
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id))
    .limit(limit);

  return rows.map((row) => row.id);
}

/**
 * How one fan-out is going, counted from the rows themselves.
 *
 * No counter column anywhere: a counter and the rows it summarises drift the
 * first time a process dies between the two writes, and this aggregate is
 * cheap — `(source_type, source_id)` is indexed.
 */
export async function countDeliveriesByStatus(
  db: Database,
  sourceType: EmailSourceType,
  sourceId: string,
): Promise<Record<EmailDeliveryStatus, number>> {
  const rows = await db
    .select({ status: emailDeliveries.status, total: count() })
    .from(emailDeliveries)
    .where(
      and(eq(emailDeliveries.sourceType, sourceType), eq(emailDeliveries.sourceId, sourceId)),
    )
    .groupBy(emailDeliveries.status);

  const counts: Record<EmailDeliveryStatus, number> = {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}
