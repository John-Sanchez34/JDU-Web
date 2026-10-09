import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDatabase, type TestDb } from "@/tests/setup/db";
import { seedTwoFamilies } from "@/tests/setup/enrollment-fixtures";
import {
  createAnnouncement,
  listAnnouncementsForFamily,
  listPublicAnnouncements,
  publishAnnouncement,
  sendAnnouncement,
} from "@/db/queries/announcements";
import { requestEnrollment } from "@/db/queries/enrollments";
import { announcements, auditLog, emailDeliveries, user } from "@/db/schema";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const TODAY = "2026-10-01";

describe("announcements", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await getTestDb();
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedEnrolledFamily() {
    const seeded = await seedTwoFamilies(db, 5);
    await db
      .insert(user)
      .values({ id: "a1", name: "One", email: "a1@example.com", familyId: seeded.familyA.id });
    const requested = await requestEnrollment(db, seeded.familyA.id, {
      studentId: seeded.studentA.id,
      offeringId: seeded.offering.id,
      actorUserId: null,
    });
    if (!requested.ok) throw new Error("expected the request to succeed");
    // The enrollment queued its own transactional mail; this suite is about
    // announcement rows, so start from an empty table.
    await db.delete(emailDeliveries);
    return seeded;
  }

  async function draft() {
    return createAnnouncement(db, {
      title: "Recital tickets",
      body: "Tickets are at the desk.",
      audienceType: "all",
      classOfferingId: null,
      createdByUserId: null,
    });
  }

  it("publishing sets the timestamp, writes an audit row, and sends nothing", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();

    const result = await publishAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcement.id));
    expect(row!.status).toBe("published");
    expect(row!.publishedAt).not.toBeNull();
    expect(row!.emailedAt).toBeNull();
    expect(await db.select().from(emailDeliveries)).toHaveLength(0);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, announcement.id));
    expect(audits.map((a) => a.action)).toEqual(["announcement.published"]);
  });

  it("refuses to publish twice", async () => {
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const second = await publishAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
    });

    expect(second).toEqual({ ok: false, reason: "not-draft" });
  });

  it("refuses to send an unpublished draft", async () => {
    const announcement = await draft();

    const result = await sendAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
      today: TODAY,
    });

    expect(result).toEqual({ ok: false, reason: "not-published" });
  });

  it("queues one row per recipient and stamps emailed_at", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const result = await sendAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
      today: TODAY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipientCount).toBe(1);
    const rows = await db.select().from(emailDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("broadcast");
    expect(rows[0]!.sourceType).toBe("announcement");
    expect(rows[0]!.bodyText).toContain("/unsubscribe?u=");
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcement.id));
    expect(row!.emailedAt).not.toBeNull();
  });

  it("gives each parent on a family their own unsubscribe link", async () => {
    const seeded = await seedEnrolledFamily();
    await db.insert(user).values({
      id: "a2",
      name: "Two",
      email: "a2@example.com",
      familyId: seeded.familyA.id,
    });
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const result = await sendAnnouncement(db, {
      announcementId: announcement.id,
      actorUserId: null,
      today: TODAY,
    });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(emailDeliveries)
      .orderBy(asc(emailDeliveries.recipientEmail));
    expect(rows.map((r) => r.recipientEmail)).toEqual([
      "a1@example.com",
      "a2@example.com",
    ]);

    const tokens = rows.map((r) => r.bodyText.match(/\/unsubscribe\?u=(\S+)/)?.[1]);
    /*
     * Two different tokens, each naming its own recipient. This is the
     * composition that `queueDeliveries`' per-recipient render exists for: if
     * `sendAnnouncement` ever passed a pre-rendered message instead of a
     * callback, both parents would share one link, and either parent's click
     * would silently unsubscribe the other. The generic mechanism is tested in
     * `queue-deliveries.test.ts`; this pins it where it is actually used.
     */
    expect(tokens[0]).not.toEqual(tokens[1]);
    expect(verifyUnsubscribeToken(tokens[0]!)).toBe("a1");
    expect(verifyUnsubscribeToken(tokens[1]!)).toBe("a2");
  });

  it("queues exactly one set of rows when two sends race", async () => {
    await seedEnrolledFamily();
    const announcement = await draft();
    await publishAnnouncement(db, { announcementId: announcement.id, actorUserId: null });

    const [first, second] = await Promise.all([
      sendAnnouncement(db, { announcementId: announcement.id, actorUserId: null, today: TODAY }),
      sendAnnouncement(db, { announcementId: announcement.id, actorUserId: null, today: TODAY }),
    ]);

    // One wins; the other is told it was already sent. Never both.
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(emailDeliveries)).toHaveLength(1);
  });

  it("shows an 'all' announcement publicly and a class one only in the portal", async () => {
    const seeded = await seedEnrolledFamily();
    const everyone = await draft();
    await publishAnnouncement(db, { announcementId: everyone.id, actorUserId: null });
    const classOnly = await createAnnouncement(db, {
      title: "Ballet I moves rooms",
      body: "Studio B from Monday.",
      audienceType: "class_offering",
      classOfferingId: seeded.offering.id,
      createdByUserId: null,
    });
    await publishAnnouncement(db, { announcementId: classOnly.id, actorUserId: null });

    const publicList = await listPublicAnnouncements(db);
    const familyList = await listAnnouncementsForFamily(db, seeded.familyA.id);

    expect(publicList.map((a) => a.title)).toEqual(["Recital tickets"]);
    expect(familyList.map((a) => a.title).sort()).toEqual([
      "Ballet I moves rooms",
      "Recital tickets",
    ]);
  });

  it("does not show an unrelated family a class announcement", async () => {
    const seeded = await seedEnrolledFamily();
    const classOnly = await createAnnouncement(db, {
      title: "Ballet I moves rooms",
      body: "Studio B from Monday.",
      audienceType: "class_offering",
      classOfferingId: seeded.offering.id,
      createdByUserId: null,
    });
    await publishAnnouncement(db, { announcementId: classOnly.id, actorUserId: null });

    expect(await listAnnouncementsForFamily(db, seeded.familyB.id)).toEqual([]);
  });
});
