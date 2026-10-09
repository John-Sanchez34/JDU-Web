import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/announcement-form";
import { AnnouncementSendPanel } from "@/components/announcement-send-panel";
import { updateAnnouncementAction } from "@/app/admin/announcements/actions";
import { db } from "@/db";
import { getAnnouncement } from "@/db/queries/announcements";
import { audienceSeasonId, resolveAnnouncementAudience } from "@/db/queries/audience";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { countDeliveriesByStatus } from "@/db/queries/email-deliveries";
import { getSeason } from "@/db/queries/seasons";
import { formatIsoDate, todayIso } from "@/lib/dates";
import { requireStaff } from "@/lib/guards";

export default async function AnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>;
}) {
  await requireStaff();
  const { announcementId } = await params;
  const announcement = await getAnnouncement(db, announcementId);
  if (!announcement) notFound();

  const today = todayIso();
  const seasonId = await audienceSeasonId(db, today);
  const season = seasonId ? await getSeason(db, seasonId) : null;
  const offerings = seasonId ? await listPublishedOfferings(db, seasonId) : [];

  // Counted only once it has been sent; before that the number that matters is
  // how many it *would* reach.
  const counts = announcement.emailedAt
    ? await countDeliveriesByStatus(db, "announcement", announcement.id)
    : null;
  const recipients = announcement.emailedAt
    ? []
    : await resolveAnnouncementAudience(db, announcement, today);

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">{announcement.title}</h2>

      <AnnouncementSendPanel
        announcementId={announcement.id}
        status={announcement.status}
        emailed={announcement.emailedAt !== null}
        queued={counts?.queued ?? 0}
        sending={counts?.sending ?? 0}
        recipientCount={recipients.length}
        seasonName={season?.name ?? null}
      />

      {counts && (
        <dl className="panel mt-6 grid grid-cols-3 gap-4 p-5 text-sm">
          <div>
            <dt className="text-mirror">Sent</dt>
            <dd className="tabular text-lg text-chalk">{counts.sent}</dd>
          </div>
          <div>
            <dt className="text-mirror">Waiting</dt>
            <dd className="tabular text-lg text-chalk">{counts.queued + counts.sending}</dd>
          </div>
          <div>
            <dt className="text-mirror">Failed</dt>
            <dd className="tabular text-lg text-alarm">{counts.failed}</dd>
          </div>
        </dl>
      )}

      {announcement.emailedAt && (
        <p className="hint mt-6">
          Emailed on{" "}
          {formatIsoDate(announcement.emailedAt.toISOString().slice(0, 10))}. Editing
          the text below changes the site, not the messages families already
          received — those said what they said.
        </p>
      )}

      <AnnouncementForm
        action={updateAnnouncementAction}
        offerings={offerings.map((offering) => ({ id: offering.id, name: offering.name }))}
        announcement={{
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          audienceType: announcement.audienceType,
          classOfferingId: announcement.classOfferingId,
        }}
        submitLabel="Save changes"
      />
    </section>
  );
}
