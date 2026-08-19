"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { idleState } from "@/lib/action-state";
import type { Student } from "@/db/schema";

export function StudentForm({
  action,
  student,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  student?: Student;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className="mt-8 max-w-md space-y-6">
      <label className="block">
        <span className="label">First name</span>
        <input
          name="firstName"
          required
          maxLength={80}
          autoComplete="off"
          defaultValue={student?.firstName ?? ""}
          className="input"
        />
      </label>

      <label className="block">
        <span className="label">Last name</span>
        <input
          name="lastName"
          required
          maxLength={80}
          autoComplete="off"
          defaultValue={student?.lastName ?? ""}
          className="input"
        />
      </label>

      <label className="block">
        <span className="label">Date of birth</span>
        <input
          name="birthdate"
          type="date"
          required
          defaultValue={student?.birthdate ?? ""}
          className="input tabular"
        />
      </label>

      <label className="block">
        <span className="label">Notes for instructors (optional)</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={student?.notes ?? ""}
          className="input"
        />
        <span className="hint">
          Allergies, injuries, or anything the studio should know.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-solid disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
