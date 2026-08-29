import { asc, eq } from "drizzle-orm";
import {
  classOfferings,
  emailDeliveries,
  enrollments,
  students,
  user,
} from "@/db/schema";
import {
  renderEnrollmentEmail,
  type EnrollmentEmailTemplate,
} from "@/lib/emails/enrollment";
import type { Executor } from "./executor";

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
