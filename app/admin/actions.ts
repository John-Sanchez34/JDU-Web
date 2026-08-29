"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { deliverQueued } from "@/lib/notifications/deliver";
import { recordAudit } from "@/db/queries/audit-log";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import {
  createOffering,
  getOffering,
  updateOffering,
} from "@/db/queries/class-offerings";
import {
  confirmEnrollment,
  isCheckViolation,
  releaseEnrollment,
} from "@/db/queries/enrollments";
import { createSeason } from "@/db/queries/seasons";
import type { ActionState } from "@/lib/action-state";
import { offeringInputSchema, seasonInputSchema } from "@/lib/admin-validation";
import {
  deliveryIdSchema,
  enrollmentIdSchema,
} from "@/lib/enrollment-validation";
import { requireStaff } from "@/lib/guards";

/*
 * Same shape as the portal actions, for the same reason: `useActionState`
 * needs the previous state first so the form can render the error.
 *
 * `ActionState` and `idleState` live in `@/lib/action-state` because a
 * `"use server"` module may only export async functions.
 */

function toObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

export async function createSeasonAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = seasonInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  await createSeason(db, parsed.data);
  revalidatePath("/admin/seasons");
  return { error: null };
}

export async function createOfferingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = offeringInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const offering = await createOffering(db, parsed.data);
  // Build the calendar immediately so the class appears on /schedule.
  await syncOccurrencesForOffering(db, offering.id);

  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  revalidatePath("/schedule");
  return { error: null };
}

export async function publishOfferingAction(
  offeringId: string,
  published: boolean,
): Promise<void> {
  await requireStaff();
  await updateOffering(db, offeringId, { published });

  revalidatePath("/admin/classes");
  revalidatePath("/classes");
  revalidatePath("/schedule");
}

/** Re-runs occurrence generation, e.g. after a season's dates change. */
export async function syncOccurrencesAction(offeringId: string) {
  await requireStaff();
  const created = await syncOccurrencesForOffering(db, offeringId);

  revalidatePath("/schedule");
  return { created };
}

/*
 * Both transitions report the same two failures, and both are races rather
 * than user error: the request was already released, or another staff member
 * confirmed it a moment ago. Neither leaks anything a staff member cannot
 * already see, so the messages say plainly what happened.
 */
function transitionError(reason: "not-found" | "not-pending"): string {
  return reason === "not-found"
    ? "That request no longer exists."
    : "Someone else already acted on that request.";
}

export async function confirmEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = enrollmentIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await confirmEnrollment(db, {
    enrollmentId: parsed.data.enrollmentId,
    actorUserId: staff.id,
  });
  if (!result.ok) return { error: transitionError(result.reason) };

  after(() => deliverQueued(db, result.deliveryIds));

  // Confirming does not move `seats_taken` — the pending request already held
  // the seat — so only the queue itself goes stale here.
  revalidatePath("/admin/enrollments");
  return { error: null };
}

export async function releaseEnrollmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = enrollmentIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const result = await releaseEnrollment(db, {
    enrollmentId: parsed.data.enrollmentId,
    actorUserId: staff.id,
  });
  if (!result.ok) return { error: transitionError(result.reason) };

  after(() => deliverQueued(db, result.deliveryIds));

  // Releasing gives the seat back, so the public catalog's remaining-seat
  // count is stale until it is revalidated too.
  revalidatePath("/admin/enrollments");
  revalidatePath("/classes");
  return { error: null };
}

/** The fields §3 requires an audit trail for: capacity and the published prices. */
function auditedFields(offering: {
  capacity: number;
  monthlyPriceCents: number;
  seasonFeeCents: number;
  published: boolean;
}) {
  return {
    capacity: offering.capacity,
    monthlyPriceCents: offering.monthlyPriceCents,
    seasonFeeCents: offering.seasonFeeCents,
    published: offering.published,
  };
}

export async function updateOfferingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const raw = toObject(formData);
  const offeringId = raw.offeringId;
  if (!offeringId) return { error: "That class could not be found." };

  const parsed = offeringInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const before = await getOffering(db, offeringId);
  if (!before) return { error: "That class could not be found." };

  try {
    const after = await updateOffering(db, offeringId, parsed.data);

    /*
     * Audited because this is the record consulted when a parent says the
     * price was different when they signed up — see §3.
     */
    await recordAudit(db, {
      actorUserId: staff.id,
      action: "offering.updated",
      entityType: "class_offering",
      entityId: offeringId,
      before: auditedFields(before),
      after: after ? auditedFields(after) : null,
    });
  } catch (error) {
    /*
     * `class_offerings_seats_within_capacity` is the database refusing to
     * shrink a class below the seats families are already holding. It is
     * something staff can act on, so it becomes a sentence rather than a 500.
     */
    if (isCheckViolation(error)) {
      return {
        error:
          "That capacity is lower than the number of seats already taken. Release requests first.",
      };
    }
    throw error;
  }

  revalidatePath("/admin/classes");
  revalidatePath(`/admin/classes/${offeringId}`);
  revalidatePath("/classes");
  revalidatePath("/schedule");
  return { error: null };
}

export async function retryDeliveryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = deliveryIdSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  /*
   * Awaited, not deferred: a person pressed Retry and is waiting to see
   * whether it worked. `deliverQueued` never throws, and a row that someone
   * else already sent is skipped by the claim.
   */
  await deliverQueued(db, [parsed.data.deliveryId]);

  revalidatePath("/admin/emails");
  return { error: null };
}
