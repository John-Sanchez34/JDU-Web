import { and, eq, sql } from "drizzle-orm";
import { classOfferings, enrollments, seasons, students, type Enrollment } from "@/db/schema";
import { todayIso } from "@/lib/dates";
import { recordAudit } from "./audit-log";
import type { Database } from "./executor";

export type RequestInput = {
  studentId: string;
  offeringId: string;
  actorUserId: string | null;
};

export type RequestResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; reason: "not-found" | "closed" | "full" | "duplicate" };

/**
 * Postgres unique-violation SQLSTATE.
 *
 * drizzle-orm wraps driver errors in a `DrizzleQueryError`, with the raw `pg`
 * error — the one actually carrying `code` — on `.cause`, so the check walks
 * the cause chain rather than trusting the top-level error shape.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

/**
 * Requests a seat, claiming it at request time.
 *
 * `familyId` comes first and the student is verified through it in SQL, so a
 * student ID belonging to another family simply finds nothing.
 *
 * The seat claim is a single conditional UPDATE whose affected-row count is the
 * decision — never a read followed by a write, which another transaction could
 * interleave with. The claim, the insert, and the audit row share one
 * transaction, so the counter and the roster can never disagree.
 */
export async function requestEnrollment(
  db: Database,
  familyId: string,
  input: RequestInput,
): Promise<RequestResult> {
  try {
    return await db.transaction(async (tx): Promise<RequestResult> => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, input.studentId), eq(students.familyId, familyId)))
        .limit(1);
      if (!student) return { ok: false, reason: "not-found" } as const;

      // The class must be published and its season still accepting requests.
      const [open] = await tx
        .select({ id: classOfferings.id })
        .from(classOfferings)
        .innerJoin(seasons, eq(classOfferings.seasonId, seasons.id))
        .where(
          and(
            eq(classOfferings.id, input.offeringId),
            eq(classOfferings.published, true),
            eq(seasons.registrationOpen, true),
          ),
        )
        .limit(1);
      if (!open) return { ok: false, reason: "closed" } as const;

      // Claim the seat. Zero rows means the class filled up.
      const claimed = await tx
        .update(classOfferings)
        .set({ seatsTaken: sql`${classOfferings.seatsTaken} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(classOfferings.id, input.offeringId),
            sql`${classOfferings.seatsTaken} < ${classOfferings.capacity}`,
          ),
        )
        .returning({ id: classOfferings.id });
      if (claimed.length === 0) return { ok: false, reason: "full" } as const;

      /*
       * No pre-check for an existing request: the partial unique index is the
       * guard, and letting it raise is race-free where a SELECT-then-INSERT is
       * not. The violation aborts this transaction, which is exactly right —
       * the seat increment above is rolled back with it. It is caught outside
       * the transaction because a Postgres transaction cannot continue after a
       * failed statement.
       */
      const [enrollment] = await tx
        .insert(enrollments)
        .values({ studentId: input.studentId, classOfferingId: input.offeringId })
        .returning();
      if (!enrollment) throw new Error("requestEnrollment: insert returned no row");

      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: "enrollment.requested",
        entityType: "enrollment",
        entityId: enrollment.id,
        before: null,
        after: { status: enrollment.status, classOfferingId: input.offeringId },
      });

      return { ok: true, enrollment } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export type TransitionInput = {
  enrollmentId: string;
  actorUserId: string | null;
};

export type TransitionResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; reason: "not-found" | "not-pending" };

/**
 * Marks a pending request confirmed after staff have taken payment in person.
 *
 * Deliberately does not touch `seats_taken`: a pending request already holds a
 * real seat, and the only thing changing here is whether the studio has been
 * paid.
 */
export async function confirmEnrollment(
  db: Database,
  input: TransitionInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.enrollmentId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(enrollments)
      .set({
        status: "active",
        confirmedAt: new Date(),
        confirmedByUserId: input.actorUserId,
        startDate: todayIso(),
        updatedAt: new Date(),
      })
      .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.status, "pending")))
      .returning();
    if (!row) return { ok: false, reason: "not-pending" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "enrollment.confirmed",
      entityType: "enrollment",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status },
    });

    return { ok: true, enrollment: row } as const;
  });
}

/**
 * Releases a pending request that never turned into a payment, returning the
 * seat to the class.
 *
 * The status predicate on the UPDATE is what makes this safe against two staff
 * members acting at once: the seat is only given back when this call is the one
 * that actually moved the row.
 */
export async function releaseEnrollment(
  db: Database,
  input: TransitionInput,
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, input.enrollmentId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const [row] = await tx
      .update(enrollments)
      .set({ status: "released", endDate: todayIso(), updatedAt: new Date() })
      .where(and(eq(enrollments.id, input.enrollmentId), eq(enrollments.status, "pending")))
      .returning();
    if (!row) return { ok: false, reason: "not-pending" } as const;

    await tx
      .update(classOfferings)
      .set({ seatsTaken: sql`${classOfferings.seatsTaken} - 1`, updatedAt: new Date() })
      .where(
        and(
          eq(classOfferings.id, row.classOfferingId),
          sql`${classOfferings.seatsTaken} > 0`,
        ),
      );

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "enrollment.released",
      entityType: "enrollment",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status },
    });

    return { ok: true, enrollment: row } as const;
  });
}
