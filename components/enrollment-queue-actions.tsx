"use client";

import { useActionState } from "react";
import {
  confirmEnrollmentAction,
  releaseEnrollmentAction,
} from "@/app/admin/actions";
import { idleState } from "@/lib/action-state";

/**
 * The two staff transitions for one queued request.
 *
 * Each is its own form with its own action state, so a failed release cannot
 * blank out or mislabel the confirm button beside it — and a race lost on one
 * row leaves every other row in the queue untouched.
 */
export function EnrollmentQueueActions({
  enrollmentId,
  studentName,
}: {
  enrollmentId: string;
  studentName: string;
}) {
  const [confirmState, confirm, confirming] = useActionState(
    confirmEnrollmentAction,
    idleState,
  );
  const [releaseState, release, releasing] = useActionState(
    releaseEnrollmentAction,
    idleState,
  );

  const error = confirmState.error ?? releaseState.error;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex gap-2">
        <form action={confirm}>
          <input type="hidden" name="enrollmentId" value={enrollmentId} />
          <button
            type="submit"
            disabled={confirming || releasing}
            aria-label={`Confirm ${studentName}`}
            className="btn btn-solid min-h-0 py-1.5 text-sm disabled:opacity-50"
          >
            {confirming ? "Confirming…" : "Confirm"}
          </button>
        </form>

        <form action={release}>
          <input type="hidden" name="enrollmentId" value={enrollmentId} />
          <button
            type="submit"
            disabled={confirming || releasing}
            aria-label={`Release ${studentName}`}
            className="btn btn-ghost min-h-0 py-1.5 text-sm disabled:opacity-50"
          >
            {releasing ? "Releasing…" : "Release"}
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
