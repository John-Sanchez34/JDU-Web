"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import {
  createAnnouncement,
  publishAnnouncement,
  sendAnnouncement,
  updateAnnouncement,
} from "@/db/queries/announcements";
import type { ActionState } from "@/lib/action-state";
import {
  announcementEditSchema,
  announcementIdSchema,
  announcementInputSchema,
} from "@/lib/announcement-validation";
import { requireStaff } from "@/lib/guards";
import { deliverBatchForSource } from "@/lib/notifications/deliver";

function toObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

/** Everything an announcement touches on the site. */
function revalidateAnnouncement(announcementId: string): void {
  revalidatePath("/admin/announcements");
  revalidatePath(`/admin/announcements/${announcementId}`);
  revalidatePath("/announcements");
  revalidatePath("/portal/announcements");
}

export async function createAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementInputSchema.safeParse(toObject(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const announcement = await createAnnouncement(db, {
    ...parsed.data,
    createdByUserId: staff.id,
  });

  revalidatePath("/admin/announcements");
  // Straight to the detail page: publishing and sending live there, and a
  // draft nobody can find is a draft nobody sends.
  redirect(`/admin/announcements/${announcement.id}`);
}

export async function updateAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const raw = toObject(formData);
  const id = announcementIdSchema.safeParse(raw);
  if (!id.success) return { error: "That announcement could not be found." };

  const parsed = announcementEditSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const updated = await updateAnnouncement(db, id.data.announcementId, {
    title: parsed.data.title,
    body: parsed.data.body,
  });
  if (!updated) return { error: "That announcement could not be found." };

  revalidateAnnouncement(id.data.announcementId);
  return { error: null };
}

export async function publishAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  const result = await publishAnnouncement(db, {
    announcementId: parsed.data.announcementId,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That announcement no longer exists."
          : "That announcement is already published.",
    };
  }

  revalidateAnnouncement(parsed.data.announcementId);
  return { error: null };
}

export async function sendAnnouncementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  const result = await sendAnnouncement(db, {
    announcementId: parsed.data.announcementId,
    actorUserId: staff.id,
  });
  if (!result.ok) {
    return {
      error:
        result.reason === "not-found"
          ? "That announcement no longer exists."
          : result.reason === "not-published"
            ? "Publish it before sending it."
            : "That announcement has already been sent.",
    };
  }

  /*
   * After the response, like every other send in this system: nobody should
   * watch a spinner while fifty paced messages go out.
   */
  after(() =>
    deliverBatchForSource(db, {
      sourceType: "announcement",
      sourceId: parsed.data.announcementId,
    }),
  );

  revalidateAnnouncement(parsed.data.announcementId);
  return { error: null };
}

export async function sendRemainingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireStaff();
  const parsed = announcementIdSchema.safeParse(toObject(formData));
  if (!parsed.success) return { error: "That announcement could not be found." };

  /*
   * Awaited, not deferred: a person pressed this and is waiting to see the
   * counts move. A batch is bounded, so the wait is bounded too.
   */
  const outcome = await deliverBatchForSource(db, {
    sourceType: "announcement",
    sourceId: parsed.data.announcementId,
  });

  revalidateAnnouncement(parsed.data.announcementId);

  if (outcome.rateLimited) {
    return {
      error: `The provider asked us to slow down after ${outcome.sent} message${
        outcome.sent === 1 ? "" : "s"
      }. Wait a minute and press it again.`,
    };
  }
  return { error: null };
}
