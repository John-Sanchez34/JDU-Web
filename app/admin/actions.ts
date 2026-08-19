"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { syncOccurrencesForOffering } from "@/db/queries/class-occurrences";
import { createOffering, updateOffering } from "@/db/queries/class-offerings";
import { createSeason } from "@/db/queries/seasons";
import type { ActionState } from "@/lib/action-state";
import { offeringInputSchema, seasonInputSchema } from "@/lib/admin-validation";
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
