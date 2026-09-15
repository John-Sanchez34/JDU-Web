"use client";

import { useActionState } from "react";
import {
  publishAnnouncementAction,
  sendAnnouncementAction,
  sendRemainingAction,
} from "@/app/admin/announcements/actions";
import { idleState } from "@/lib/action-state";

function OneButton({
  action,
  announcementId,
  label,
  pendingLabel,
}: {
  action: typeof publishAnnouncementAction;
  announcementId: string;
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  return (
    <form action={formAction}>
      <input type="hidden" name="announcementId" value={announcementId} />
      <button type="submit" disabled={pending} className="btn btn-solid disabled:opacity-50">
        {pending ? pendingLabel : label}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function AnnouncementSendPanel({
  announcementId,
  status,
  emailed,
  /*
   * `queued` and `sending` are separate because only `queued` is resumable.
   * "Send the rest" runs `listQueuedForSource`, which deliberately returns
   * queued rows only — a row stuck in `sending` is recovered from
   * /admin/emails instead, once it is old enough to count as abandoned. Gating
   * the button on queued+sending would show a button that does nothing.
   */
  queued,
  sending,
  recipientCount,
  seasonName,
}: {
  announcementId: string;
  status: "draft" | "published";
  emailed: boolean;
  queued: number;
  sending: number;
  recipientCount: number;
  seasonName: string | null;
}) {
  if (status === "draft") {
    return (
      <div className="panel mt-8 p-5">
        <p className="text-mirror">
          This is a draft. Publishing puts it on the site; sending the email is a
          separate step.
        </p>
        <div className="mt-4">
          <OneButton
            action={publishAnnouncementAction}
            announcementId={announcementId}
            label="Publish"
            pendingLabel="Publishing…"
          />
        </div>
      </div>
    );
  }

  if (!emailed) {
    return (
      <div className="panel mt-8 p-5">
        <p className="text-mirror">
          Published. Sending will email{" "}
          <strong className="text-chalk">
            {recipientCount} {recipientCount === 1 ? "recipient" : "recipients"}
          </strong>
          {seasonName && ` from ${seasonName}`}.
        </p>
        {recipientCount === 0 && (
          <p className="mt-2 text-sm text-alarm">
            Nobody matches this audience right now, so sending would email no one.
          </p>
        )}
        <div className="mt-4">
          <OneButton
            action={sendAnnouncementAction}
            announcementId={announcementId}
            label="Send the email"
            pendingLabel="Queueing…"
          />
        </div>
      </div>
    );
  }

  const waiting = queued + sending;

  return (
    <div className="panel mt-8 p-5">
      <p className="text-mirror">
        {waiting === 0
          ? "Every message has gone out."
          : `${waiting} ${waiting === 1 ? "message is" : "messages are"} still waiting.`}
      </p>

      {queued > 0 && (
        <div className="mt-4">
          <OneButton
            action={sendRemainingAction}
            announcementId={announcementId}
            label="Send the rest"
            pendingLabel="Sending…"
          />
        </div>
      )}

      {queued === 0 && sending > 0 && (
        <p className="hint mt-3">
          {sending === 1 ? "That one is" : "Those are"} mid-send. If{" "}
          {sending === 1 ? "it is" : "they are"} still here in fifteen minutes,{" "}
          {sending === 1 ? "it" : "they"} will appear on the Email page to be
          retried — there is nothing to press here.
        </p>
      )}
    </div>
  );
}
