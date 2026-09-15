import { db } from "@/db";
import { listPublicAnnouncements } from "@/db/queries/announcements";
import { formatIsoDate, todayIso } from "@/lib/dates";
import { toParagraphs } from "@/lib/emails/layout";

// Same cadence as the catalog and the schedule. Publishing revalidates this
// path explicitly, so the interval is a backstop rather than the mechanism.
export const revalidate = 300;

export default async function AnnouncementsPage() {
  const announcements = await listPublicAnnouncements(db);

  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <h1 className="display text-3xl uppercase text-chalk">Studio news</h1>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing to report just now.</p>
      ) : (
        <ul className="mt-10 flex flex-col gap-12">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <h2 className="text-xl font-semibold text-chalk">{announcement.title}</h2>
              <p className="eyebrow mt-2">
                {announcement.publishedAt
                  ? formatIsoDate(announcement.publishedAt.toISOString().slice(0, 10))
                  : formatIsoDate(todayIso())}
              </p>
              {toParagraphs(announcement.body).map((paragraph, index) => (
                <p key={index} className="mt-4 whitespace-pre-line leading-relaxed text-mirror">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
