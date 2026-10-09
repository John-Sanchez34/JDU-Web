import { db } from "@/db";
import { listAnnouncementsForFamily } from "@/db/queries/announcements";
import { toParagraphs } from "@/lib/emails/layout";
import { formatIsoDate } from "@/lib/dates";
import { requireFamilyId } from "@/lib/guards";

export default async function PortalAnnouncementsPage() {
  const familyId = await requireFamilyId();
  const announcements = await listAnnouncementsForFamily(db, familyId);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">Announcements</h2>
      <p className="hint mt-2">
        Studio news, plus anything posted about a class one of your students is
        in.
      </p>

      {announcements.length === 0 ? (
        <p className="mt-8 text-mirror">Nothing to report just now.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-10">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <h3 className="font-semibold text-chalk">{announcement.title}</h3>
              {announcement.publishedAt && (
                <p className="eyebrow mt-1">
                  {formatIsoDate(announcement.publishedAt.toISOString().slice(0, 10))}
                </p>
              )}
              {toParagraphs(announcement.body).map((paragraph, index) => (
                <p key={index} className="mt-3 whitespace-pre-line text-sm leading-relaxed text-mirror">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
