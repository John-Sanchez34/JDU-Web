"use client";

import { useActionState } from "react";
import { retryDeliveryAction } from "@/app/admin/actions";
import { idleState } from "@/lib/action-state";

export function RetryDeliveryButton({
  deliveryId,
  recipientEmail,
}: {
  deliveryId: string;
  recipientEmail: string;
}) {
  const [state, formAction, pending] = useActionState(
    retryDeliveryAction,
    idleState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Retry the message to ${recipientEmail}`}
        className="btn btn-ghost min-h-0 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? "Sending…" : "Retry"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
