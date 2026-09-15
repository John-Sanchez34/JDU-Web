"use client";

import { useActionState, useState } from "react";
import { idleState } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";

export type OfferingChoice = { id: string; name: string };

export function AnnouncementForm({
  action,
  offerings,
  announcement,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  offerings: OfferingChoice[];
  announcement?: {
    id: string;
    title: string;
    body: string;
    audienceType: "all" | "class_offering";
    classOfferingId: string | null;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [audience, setAudience] = useState(announcement?.audienceType ?? "all");
  // Editing never changes the audience — the rows that went out were addressed
  // to the audience as it was, so changing it afterwards would describe a send
  // that never happened.
  const locked = announcement !== undefined;

  return (
    <form action={formAction} className="mt-8 flex max-w-2xl flex-col gap-5">
      {announcement && (
        <input type="hidden" name="announcementId" value={announcement.id} />
      )}

      <label className="flex flex-col gap-2">
        <span className="label">Title</span>
        <input
          name="title"
          defaultValue={announcement?.title}
          required
          maxLength={200}
          className="input"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="label">Body</span>
        <textarea
          name="body"
          defaultValue={announcement?.body}
          required
          rows={10}
          className="input"
        />
        <span className="hint">
          Plain text. Leave a blank line between paragraphs.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="label">Who is this for?</legend>
        <label className="flex items-center gap-2 text-sm text-mirror">
          <input
            type="radio"
            name="audienceType"
            value="all"
            checked={audience === "all"}
            onChange={() => setAudience("all")}
          />
          Everyone enrolled this season
        </label>
        <label className="flex items-center gap-2 text-sm text-mirror">
          <input
            type="radio"
            name="audienceType"
            value="class_offering"
            checked={audience === "class_offering"}
            onChange={() => setAudience("class_offering")}
          />
          One class
        </label>
        {audience === "class_offering" && (
          <select
            name="classOfferingId"
            defaultValue={announcement?.classOfferingId ?? ""}
            className="input mt-2"
          >
            <option value="">Choose a class…</option>
            {offerings.map((offering) => (
              <option key={offering.id} value={offering.id}>
                {offering.name}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <div>
        <button type="submit" disabled={pending} className="btn btn-solid disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
