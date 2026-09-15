"use client";

import { useActionState } from "react";
import { setBroadcastPreferenceAction } from "@/app/portal/actions";
import { idleState } from "@/lib/action-state";

export function BroadcastPreferenceForm({ optedOut }: { optedOut: boolean }) {
  const [state, formAction, pending] = useActionState(
    setBroadcastPreferenceAction,
    idleState,
  );

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="subscribe" value={optedOut ? "yes" : "no"} />
      <p className="text-mirror">
        {optedOut
          ? "You are not receiving studio news."
          : "You are receiving studio news."}
      </p>
      <button type="submit" disabled={pending} className="btn btn-solid mt-4 disabled:opacity-50">
        {pending ? "Saving…" : optedOut ? "Start receiving studio news" : "Stop receiving studio news"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
