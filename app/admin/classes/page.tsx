import {
  createOfferingAction,
  publishOfferingAction,
} from "@/app/admin/actions";
import { AdminForm } from "@/components/admin-form";
import { db } from "@/db";
import { listAllOfferings } from "@/db/queries/class-offerings";
import { listSeasons } from "@/db/queries/seasons";
import { formatDayOfWeek } from "@/lib/dates";
import { formatCents, formatTimeRange } from "@/lib/format";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export default async function AdminClassesPage() {
  const seasons = await listSeasons(db);
  const activeSeason = seasons[0];

  if (!activeSeason) {
    return (
      <section>
        <h2 className="text-xl font-semibold text-chalk">Classes</h2>
        <p className="mt-4 text-mirror">Create a season first.</p>
      </section>
    );
  }

  const offerings = await listAllOfferings(db, activeSeason.id);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">
        Classes — {activeSeason.name}
      </h2>

      <AdminForm
        action={createOfferingAction}
        submitLabel="Add class"
        className="panel mt-6 grid gap-5 p-5 sm:grid-cols-2"
      >
        <input type="hidden" name="seasonId" value={activeSeason.id} />
        <label className="block">
          <span className="label">Class name</span>
          <input name="name" required className="input" />
        </label>
        <label className="block">
          <span className="label">Instructor</span>
          <input name="instructor" className="input" />
        </label>
        <label className="block">
          <span className="label">Day</span>
          <select name="dayOfWeek" required className="input">
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {formatDayOfWeek(day)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Room</span>
          <input name="room" className="input" />
        </label>
        <label className="block">
          <span className="label">Starts</span>
          <input name="startTime" type="time" required className="input tabular" />
        </label>
        <label className="block">
          <span className="label">Ends</span>
          <input name="endTime" type="time" required className="input tabular" />
        </label>
        <label className="block">
          <span className="label">Capacity</span>
          <input
            name="capacity"
            type="number"
            min={1}
            required
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
              className="input tabular"
            />
            <input
              name="maxAge"
              type="number"
              min={0}
              placeholder="max"
              aria-label="Maximum age"
              className="input tabular"
            />
          </span>
        </fieldset>
        <label className="block">
          <span className="label">Monthly tuition (dollars)</span>
          <input
            name="monthlyPrice"
            required
            placeholder="65.00"
            className="input tabular"
          />
        </label>
        <label className="block">
          <span className="label">Season fee (dollars)</span>
          <input name="seasonFee" placeholder="50.00" className="input tabular" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Description</span>
          <textarea name="description" rows={2} className="input" />
        </label>
      </AdminForm>

      {offerings.length === 0 ? (
        <p className="mt-8 text-mirror">No classes in this season yet.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {offerings.map((offering) => (
            <li
              key={offering.id}
              className="flex flex-wrap items-center justify-between gap-4 p-5"
            >
              <div>
                <p className="font-semibold text-chalk">
                  {offering.name}
                  {!offering.published && (
                    <span className="eyebrow ml-3 text-barre">Draft</span>
                  )}
                </p>
                <p className="tabular mt-1 text-sm text-mirror">
                  {formatDayOfWeek(offering.dayOfWeek)}{" "}
                  {formatTimeRange(offering.startTime, offering.endTime)} ·{" "}
                  {formatCents(offering.monthlyPriceCents)}/mo ·{" "}
                  {offering.seatsTaken}/{offering.capacity} enrolled
                </p>
              </div>
              <form
                action={publishOfferingAction.bind(
                  null,
                  offering.id,
                  !offering.published,
                )}
              >
                <button type="submit" className="btn btn-ghost min-h-0 py-1.5 text-sm">
                  {offering.published ? "Unpublish" : "Publish"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
