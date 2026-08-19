import Link from "next/link";
import { db } from "@/db";
import { listSeasons } from "@/db/queries/seasons";

export default async function AdminHome() {
  const seasons = await listSeasons(db);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Overview</h2>
      <p className="mt-3 text-mirror">
        {seasons.length === 0
          ? "No seasons yet. Create one to start adding classes."
          : `${seasons.length} ${
              seasons.length === 1 ? "season" : "seasons"
            } configured.`}
      </p>
      <p className="mt-6">
        <Link
          href="/admin/seasons"
          className="font-medium text-maple transition-colors hover:text-chalk"
        >
          Manage seasons
        </Link>
      </p>
    </section>
  );
}
