"use client";

import { useActionState } from "react";
import { cancelOccurrenceAction, restoreOccurrenceAction } from "@/app/admin/actions";
import { idleState } from "@/lib/action-state";

export function CancelOccurrenceForm({
  occurrenceId,
  offeringId,
  date,
  cancelled,
  note,
}: {
  occurrenceId: string;
  offeringId: string;
  date: string;
  cancelled: boolean;
  note: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    cancelled ? restoreOccurrenceAction : cancelOccurrenceAction,
    idleState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <input type="hidden" name="offeringId" value={offeringId} />

      {cancelled ? (
        <p className="text-sm text-alarm">Cancelled{note ? ` — ${note}` : ""}</p>
      ) : (
        <label className="flex flex-1 flex-col gap-1">
          <span className="sr-only">Why is {date} cancelled?</span>
          <input
            name="reason"
            required
            maxLength={500}
            placeholder="Why? Families will read this."
            className="input text-sm"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-ghost min-h-0 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? "Saving…" : cancelled ? "Put it back" : "Cancel this date"}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
