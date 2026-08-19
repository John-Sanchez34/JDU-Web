"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { createStudent, updateStudent } from "@/db/queries/students";
import { requireFamilyId } from "@/lib/guards";
import type { ActionState } from "@/lib/action-state";
import { studentInputSchema } from "@/lib/validation";

/*
 * Actions take `prevState` first so they can be driven by `useActionState`,
 * which is what lets the form render the error instead of silently
 * discarding it. A form action passed straight to `<form action={...}>`
 * throws its return value away.
 *
 * `ActionState` and `idleState` live in `@/lib/action-state` because a
 * `"use server"` module may only export async functions.
 */

function readForm(formData: FormData) {
  return {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    birthdate: String(formData.get("birthdate") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createStudentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = await requireFamilyId();
  const parsed = studentInputSchema.safeParse(readForm(formData));

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  await createStudent(db, familyId, parsed.data);
  revalidatePath("/portal/students");
  redirect("/portal/students");
}

export async function updateStudentAction(
  studentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = await requireFamilyId();
  const parsed = studentInputSchema.safeParse(readForm(formData));

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  // Scoping lives in the query's WHERE clause: a student belonging to another
  // family matches nothing and returns null.
  const updated = await updateStudent(db, familyId, studentId, parsed.data);
  if (!updated) {
    return { error: "That student could not be found." };
  }

  revalidatePath("/portal/students");
  redirect("/portal/students");
}
