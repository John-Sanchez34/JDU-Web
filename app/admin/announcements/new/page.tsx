import { AnnouncementForm } from "@/components/announcement-form";
import { createAnnouncementAction } from "@/app/admin/announcements/actions";
import { db } from "@/db";
import { listPublishedOfferings } from "@/db/queries/class-offerings";
import { getCurrentSeason } from "@/db/queries/seasons";
import { todayIso } from "@/lib/dates";
import { requireStaff } from "@/lib/guards";

export default async function NewAnnouncementPage() {
  await requireStaff();
  const season = await getCurrentSeason(db, todayIso());
  const offerings = season ? await listPublishedOfferings(db, season.id) : [];

  return (
    <section>
      <h2 className="text-xl font-semibold text-chalk">New announcement</h2>
      <p className="hint mt-2">
        This saves a draft. Nothing is posted or emailed until you say so.
      </p>
      <AnnouncementForm
        action={createAnnouncementAction}
        offerings={offerings.map((offering) => ({ id: offering.id, name: offering.name }))}
        submitLabel="Save draft"
      />
    </section>
  );
}
