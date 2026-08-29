import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  classOfferings,
  emailDeliveries,
  enrollments,
  students,
  user,
  type EmailDelivery,
} from "@/db/schema";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailTemplate,
} from "@/lib/emails/enrollment";
import type { Database, Executor } from "./executor";

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

  const rows = await exec
    .insert(emailDeliveries)
    .values(
      recipients.map((recipient) => ({
        sourceType: "enrollment" as const,
        sourceId: input.enrollmentId,
        template: input.template,
        category: "transactional" as const,
        recipientUserId: recipient.id,
        recipientEmail: recipient.email,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
      })),
    )
    .returning({ id: emailDeliveries.id });

  return rows.map((row) => row.id);
}

/**
 * How long a row may sit in `sending` before it is assumed abandoned.
 *
 * Nothing sweeps on a timer, so without this a process that died mid-send
 * would strand a row in a state nothing ever looks at again.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Takes exclusive responsibility for sending one delivery.
 *
 * The status predicate is what makes this exactly-once: the affected-row count
 * is the decision, never a read followed by a write that another process could
 * interleave with — the same discipline as the seat claim in `enrollments.ts`.
 * Null means someone else holds it, or it has already been sent.
 */
export async function claimForSend(
  db: Database,
  deliveryId: string,
): Promise<EmailDelivery | null> {
  const [row] = await db
    .update(emailDeliveries)
    .set({
      status: "sending",
      attempts: sql`${emailDeliveries.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        inArray(emailDeliveries.status, ["queued", "failed"]),
      ),
    )
    .returning();
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
 * Everything a staff member should look at: outright failures, plus rows still
 * `sending` long enough that the process handling them is gone.
 *
 * `now` is a parameter so the boundary is testable without waiting fifteen
 * minutes.
 */
export async function listRetriableDeliveries(
  db: Database,
  now: Date = new Date(),
): Promise<EmailDelivery[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);

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
      ),
    )
    .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id));
}
