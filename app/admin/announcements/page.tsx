import Link from "next/link";
import { db } from "@/db";
import { listAnnouncementsForAdmin } from "@/db/queries/announcements";
import { requireStaff } from "@/lib/guards";

export default async function AdminAnnouncementsPage() {
  await requireStaff();
  const announcements = await listAnnouncementsForAdmin(db);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-chalk">Announcements</h2>
          <p className="hint mt-2">
            Publishing puts an announcement on the site. Emailing it is a
            separate, deliberate step.
          </p>
        </div>
        <Link href="/admin/announcements/new" className="btn btn-solid">
          New announcement
        </Link>
      </div>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing has been posted yet.</p>
      ) : (
        <ul className="panel mt-8 divide-y divide-barre/25">
          {announcements.map((announcement) => (
            <li key={announcement.id} className="p-5">
              <Link
                href={`/admin/announcements/${announcement.id}`}
                className="font-semibold text-chalk hover:text-maple"
              >
                {announcement.title}
              </Link>
              <p className="mt-1 text-sm text-mirror">
                {announcement.status === "draft" ? "Draft" : "Published"}
                {" · "}
                {announcement.audienceType === "all" ? "Everyone" : "One class"}
                {" · "}
                {announcement.emailedAt ? "Emailed" : "Not emailed"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
