import { createSeasonAction } from "@/app/admin/actions";
import { AdminForm } from "@/components/admin-form";
import { db } from "@/db";
import { listSeasons } from "@/db/queries/seasons";

export default async function AdminSeasonsPage() {
  const seasons = await listSeasons(db);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Seasons</h2>

      <AdminForm
        action={createSeasonAction}
        submitLabel="Add season"
        className="panel mt-6 flex flex-wrap items-end gap-5 p-5"
      >
        <label className="block">
          <span className="label">Name</span>
          <input name="name" required placeholder="Fall 2026" className="input" />
        </label>
        <label className="block">
          <span className="label">Starts</span>
          <input name="startDate" type="date" required className="input tabular" />
        </label>
        <label className="block">
          <span className="label">Ends</span>
          <input name="endDate" type="date" required className="input tabular" />
        </label>
      </AdminForm>

      {seasons.length === 0 ? (
        <p className="mt-8 text-mirror">No seasons yet.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {seasons.map((season) => (
            <li key={season.id} className="p-5">
              <p className="font-semibold text-chalk">{season.name}</p>
              <p className="tabular mt-1 text-sm text-mirror">
                {season.startDate} to {season.endDate}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
