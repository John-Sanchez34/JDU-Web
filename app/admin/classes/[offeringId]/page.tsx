import Link from "next/link";
import { notFound } from "next/navigation";
import { updateOfferingAction } from "@/app/admin/actions";
import { AdminForm } from "@/components/admin-form";
import { EnrollmentStatusBadge } from "@/components/enrollment-status-badge";
import { db } from "@/db";
import { getOffering } from "@/db/queries/class-offerings";
import { listRoster } from "@/db/queries/enrollments";
import { formatDayOfWeek } from "@/lib/dates";
import { formatCents } from "@/lib/format";
import { requireStaff } from "@/lib/guards";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Renders integer cents back into the dollar string the form expects. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `16:00:00` back to the `HH:MM` an `<input type="time">` wants. */
function toInputTime(time: string): string {
  return time.slice(0, 5);
}

export default async function AdminClassPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  await requireStaff();

  const offering = await getOffering(db, offeringId);
  if (!offering) notFound();

  const roster = await listRoster(db, offering.id);

  return (
    <section>
      <p className="eyebrow">
        <Link
          href="/admin/classes"
          className="text-mirror transition-colors hover:text-chalk"
        >
          ← All classes
        </Link>
      </p>

      <h2 className="mt-3 text-xl font-semibold text-chalk">{offering.name}</h2>
      <p className="tabular mt-1 text-sm text-mirror">
        {formatDayOfWeek(offering.dayOfWeek)} · {offering.seatsTaken} of{" "}
        {offering.capacity} seats taken
      </p>

      <h3 className="mt-10 text-lg font-semibold text-chalk">Roster</h3>
      {roster.length === 0 ? (
        <p className="mt-3 text-mirror">Nobody has requested this class yet.</p>
      ) : (
        <ul className="panel mt-3 divide-y divide-barre/25">
          {roster.map((entry) => (
            <li
              key={entry.enrollmentId}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <p className="font-semibold text-chalk">
                  {entry.studentFirstName} {entry.studentLastName}
                </p>
                <p className="mt-1 text-sm text-mirror">{entry.familyName}</p>
              </div>
              <EnrollmentStatusBadge status={entry.status} />
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-10 text-lg font-semibold text-chalk">Edit class</h3>
      <p className="hint mt-2">
        Capacity cannot go below the seats already taken — release those
        requests first.
      </p>

      <AdminForm
        action={updateOfferingAction}
        submitLabel="Save changes"
        className="panel mt-4 grid gap-5 p-5 sm:grid-cols-2"
      >
        <input type="hidden" name="offeringId" value={offering.id} />
        <input type="hidden" name="seasonId" value={offering.seasonId} />
        <label className="block">
          <span className="label">Class name</span>
          <input
            name="name"
            required
            defaultValue={offering.name}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Instructor</span>
          <input
            name="instructor"
            defaultValue={offering.instructor ?? ""}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Day</span>
          <select
            name="dayOfWeek"
            required
            defaultValue={offering.dayOfWeek}
            className="input"
          >
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {formatDayOfWeek(day)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Room</span>
          <input
            name="room"
            defaultValue={offering.room ?? ""}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Level</span>
          <input
            name="level"
            defaultValue={offering.level ?? ""}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Starts</span>
          <input
            name="startTime"
            type="time"
            required
            defaultValue={toInputTime(offering.startTime)}
            className="input tabular"
          />
        </label>
        <label className="block">
          <span className="label">Ends</span>
          <input
            name="endTime"
            type="time"
            required
            defaultValue={toInputTime(offering.endTime)}
            className="input tabular"
          />
        </label>
        <label className="block">
          <span className="label">Capacity</span>
          <input
            name="capacity"
            type="number"
            min={1}
            required
            defaultValue={offering.capacity}
            className="input tabular"
          />
        </label>
        <fieldset className="block border-0 p-0">
          <legend className="label">Suggested ages</legend>
          <span className="flex gap-3">
            <input
              name="minAge"
              type="number"
              min={0}
              placeholder="min"
              aria-label="Minimum age"
              defaultValue={offering.minAge ?? ""}
              className="input tabular"
            />
            <input
              name="maxAge"
              type="number"
              min={0}
              placeholder="max"
              aria-label="Maximum age"
              defaultValue={offering.maxAge ?? ""}
              className="input tabular"
            />
          </span>
        </fieldset>
        <label className="block">
          <span className="label">Monthly tuition (dollars)</span>
          <input
            name="monthlyPrice"
            required
            defaultValue={centsToDollars(offering.monthlyPriceCents)}
            className="input tabular"
          />
        </label>
        <label className="block">
          <span className="label">Season fee (dollars)</span>
          <input
            name="seasonFee"
            defaultValue={centsToDollars(offering.seasonFeeCents)}
            className="input tabular"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Description</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={offering.description ?? ""}
            className="input"
          />
        </label>
        <p className="hint sm:col-span-2">
          Tuition is currently {formatCents(offering.monthlyPriceCents)} per
          month. Changes to capacity and prices are recorded in the audit log.
        </p>
      </AdminForm>
    </section>
  );
}
