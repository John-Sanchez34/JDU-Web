import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import {
  announcements,
  enrollments,
  students,
  type Announcement,
  type AnnouncementAudience,
} from "@/db/schema";
import { todayIso } from "@/lib/dates";
import { ANNOUNCEMENT_TEMPLATE, renderAnnouncementEmail } from "@/lib/emails/announcement";
import { unsubscribeUrl } from "@/lib/unsubscribe-token";
import { resolveAnnouncementAudience } from "./audience";
import { recordAudit } from "./audit-log";
import { queueDeliveries } from "./email-deliveries";
import type { Database } from "./executor";

export type NewAnnouncementInput = {
  title: string;
  body: string;
  audienceType: AnnouncementAudience;
  classOfferingId: string | null;
  createdByUserId: string | null;
};

export async function createAnnouncement(
  db: Database,
  input: NewAnnouncementInput,
): Promise<Announcement> {
  const [row] = await db.insert(announcements).values(input).returning();
  if (!row) throw new Error("createAnnouncement: insert returned no row");
  return row;
}

/**
 * Edits the copy.
 *
 * Allowed after sending on purpose: the site is the system of record and a
 * typo should be fixable there. It never re-sends, and the delivery rows keep
 * what was actually mailed — the page tells staff as much.
 */
export async function updateAnnouncement(
  db: Database,
  announcementId: string,
  input: Pick<NewAnnouncementInput, "title" | "body">,
): Promise<Announcement | null> {
  const [row] = await db
    .update(announcements)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(announcements.id, announcementId))
    .returning();
  return row ?? null;
}

export async function getAnnouncement(
  db: Database,
  announcementId: string,
): Promise<Announcement | null> {
  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, announcementId))
    .limit(1);
  return row ?? null;
}

export type PublishResult =
  | { ok: true; announcement: Announcement }
  | { ok: false; reason: "not-found" | "not-draft" };

/**
 * Puts an announcement on the site. Sends nothing.
 *
 * The status predicate makes a double submit harmless: the second call moves
 * zero rows and says so, rather than overwriting `published_at` with a later
 * time.
 */
export async function publishAnnouncement(
  db: Database,
  input: { announcementId: string; actorUserId: string | null },
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, input.announcementId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;

    const now = new Date();
    const [row] = await tx
      .update(announcements)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(
        and(eq(announcements.id, input.announcementId), eq(announcements.status, "draft")),
      )
      .returning();
    if (!row) return { ok: false, reason: "not-draft" } as const;

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "announcement.published",
      entityType: "announcement",
      entityId: row.id,
      before: { status: before.status },
      after: { status: row.status, audienceType: row.audienceType },
    });

    return { ok: true, announcement: row } as const;
  });
}

export type SendAnnouncementResult =
  | { ok: true; deliveryIds: string[]; recipientCount: number }
  | { ok: false; reason: "not-found" | "not-published" | "already-emailed" };

/**
 * Queues the fan-out, exactly once.
 *
 * The conditional UPDATE runs first — before the audience is resolved and
 * before a single row is written — so two staff members pressing Send at the
 * same moment means the second one aborts having queued nothing. Same
 * discipline as the seat claim and the delivery claim: the affected-row count
 * is the decision.
 *
 * Rendering happens per recipient because each body carries that recipient's
 * own unsubscribe link.
 */
export async function sendAnnouncement(
  db: Database,
  input: { announcementId: string; actorUserId: string | null; today?: string },
): Promise<SendAnnouncementResult> {
  const today = input.today ?? todayIso();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(announcements)
      .where(eq(announcements.id, input.announcementId))
      .limit(1);
    if (!before) return { ok: false, reason: "not-found" } as const;
    if (before.status !== "published") {
      return { ok: false, reason: "not-published" } as const;
    }

    const now = new Date();
    const [claimed] = await tx
      .update(announcements)
      .set({ emailedAt: now, updatedAt: now })
      .where(
        and(
          eq(announcements.id, input.announcementId),
          eq(announcements.status, "published"),
          isNull(announcements.emailedAt),
        ),
      )
      .returning();
    if (!claimed) return { ok: false, reason: "already-emailed" } as const;

    const recipients = await resolveAnnouncementAudience(tx, claimed, today);

    const deliveryIds = await queueDeliveries(tx, {
      sourceType: "announcement",
      sourceId: claimed.id,
      template: ANNOUNCEMENT_TEMPLATE,
      category: "broadcast",
      recipients,
      render: (recipient) =>
        renderAnnouncementEmail({
          title: claimed.title,
          body: claimed.body,
          unsubscribeUrl: unsubscribeUrl(recipient.userId),
        }),
    });

    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: "announcement.emailed",
      entityType: "announcement",
      entityId: claimed.id,
      before: null,
      after: { audienceType: claimed.audienceType, recipientCount: recipients.length },
    });

    return { ok: true, deliveryIds, recipientCount: recipients.length } as const;
  });
}

/** Everything, newest first — the admin list. */
export async function listAnnouncementsForAdmin(db: Database): Promise<Announcement[]> {
  return db.select().from(announcements).orderBy(desc(announcements.createdAt));
}

/**
 * What the open web sees: published, addressed to everyone.
 *
 * A class-targeted announcement is for the families in that class, so it never
 * appears here — the audience is part of what the announcement means, not just
 * a mailing decision.
 */
export async function listPublicAnnouncements(db: Database): Promise<Announcement[]> {
  return db
    .select()
    .from(announcements)
    .where(and(eq(announcements.status, "published"), eq(announcements.audienceType, "all")))
    .orderBy(desc(announcements.publishedAt));
}

/**
 * What one family is addressed by: everything public, plus announcements
 * targeting a class they hold a live seat in.
 *
 * `familyId` is a required first parameter and is filtered in SQL, like every
 * other family-scoped read in this directory.
 */
export async function listAnnouncementsForFamily(
  db: Database,
  familyId: string,
): Promise<Announcement[]> {
  const targetsAClassThisFamilyIsIn = exists(
    db
      .select({ one: sql`1` })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(students.familyId, familyId),
          inArray(enrollments.status, ["pending", "active"]),
          eq(enrollments.classOfferingId, announcements.classOfferingId),
        ),
      ),
  );

  return db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        or(eq(announcements.audienceType, "all"), targetsAClassThisFamilyIsIn),
      ),
    )
    .orderBy(desc(announcements.publishedAt));
}
