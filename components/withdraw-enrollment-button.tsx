"use client";

import { useActionState } from "react";
import { withdrawEnrollmentAction } from "@/app/portal/actions";
import { idleState } from "@/lib/action-state";

export function WithdrawEnrollmentButton({
  enrollmentId,
}: {
  enrollmentId: string;
}) {
  const [state, formAction, pending] = useActionState(
    withdrawEnrollmentAction,
    idleState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="enrollmentId" value={enrollmentId} />

      <button
        type="submit"
        disabled={pending}
        className="btn disabled:opacity-50"
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>

      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
