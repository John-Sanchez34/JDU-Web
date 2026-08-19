"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { idleState } from "@/lib/action-state";

export function AdminForm({
  action,
  submitLabel,
  className,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm font-medium text-alarm sm:col-span-2">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-solid self-start disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
