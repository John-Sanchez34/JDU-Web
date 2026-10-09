import { expect, test } from "@playwright/test";
import { signIn, signUp } from "./fixtures/auth";
import {
  cancelledOccurrenceIdFor,
  deliveriesForSource,
  latestAnnouncementId,
  promoteToStaff,
  seedOpenSeasonWithClass,
} from "./fixtures/seed";

/*
 * One thread: a parent enrols, staff post and send an announcement, the parent
 * reads it and unsubscribes, and the next announcement skips them. Serial,
 * because each scenario builds on the last.
 */
test.describe.configure({ mode: "serial" });

test.describe("announcements", () => {
  const stamp = Date.now();
  const parentEmail = `parent-news-${stamp}@example.com`;
  const staffEmail = `staff-news-${stamp}@example.com`;
  let className: string;

  test("a parent takes a seat so they have an audience to be in", async ({ page }) => {
    const seeded = await seedOpenSeasonWithClass(10);
    className = seeded.className;

    await signUp(page, "News Parent", parentEmail);
    await signIn(page, parentEmail);
    await page.goto("/portal/students/new");
    await page.getByLabel("First name").fill("Nina");
    await page.getByLabel("Last name").fill("News");
    await page.getByLabel("Date of birth").fill("2015-05-05");
    // "Save student" — the label app/portal/students/new/page.tsx passes to
    // StudentForm. Not "Add student"; check the component before changing it.
    await page.getByRole("button", { name: "Save student" }).click();

    await page.goto("/portal");
    const cell = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: className }) })
      .last();
    await cell.getByRole("button", { name: "Request seat" }).click();
    await expect(page.getByText(/seat is held|request/i).first()).toBeVisible();
  });

  test("staff draft, publish and send an announcement", async ({ browser }) => {
    /*
     * Sign the staff account up in a throwaway context and close it. Signing
     * up leaves the browser holding a parent session; the staff work below
     * needs a context that was signed in AFTER the role was promoted, because
     * the session cookie carries the role.
     */
    const signUpContext = await browser.newContext();
    await signUp(await signUpContext.newPage(), "News Staff", staffEmail);
    await signUpContext.close();
    await promoteToStaff(staffEmail);

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);

    await staff.goto("/admin/announcements/new");
    await staff.getByLabel("Title").fill("Recital tickets");
    await staff.getByLabel("Body").fill("Tickets are at the desk.\n\nBring exact change.");
    await staff.getByRole("button", { name: "Save draft" }).click();

    // Publishing puts it on the site and sends nothing.
    await staff.getByRole("button", { name: "Publish" }).click();
    const announcementId = await latestAnnouncementId();
    expect(await deliveriesForSource("announcement", announcementId)).toHaveLength(0);

    await staff.getByRole("button", { name: "Send the email" }).click();
    await expect(staff.getByText(/Every message has gone out|still waiting/)).toBeVisible();

    await expect
      .poll(async () => {
        const rows = await deliveriesForSource("announcement", announcementId);
        return rows.map((row) => `${row.recipientEmail}:${row.status}`);
      })
      .toEqual([`${parentEmail}:sent`]);

    await context.close();
  });

  test("the announcement is on the public page and in the portal", async ({ page }) => {
    await page.goto("/announcements");
    await expect(page.getByRole("heading", { name: "Recital tickets" })).toBeVisible();
    await expect(page.getByText("Bring exact change.")).toBeVisible();

    await signIn(page, parentEmail);
    await page.goto("/portal/announcements");
    await expect(page.getByRole("heading", { name: "Recital tickets" })).toBeVisible();
  });

  test("the parent unsubscribes and the next announcement skips them", async ({ page, browser }) => {
    const announcementId = await latestAnnouncementId();
    const [delivery] = await deliveriesForSource("announcement", announcementId);
    const link = delivery!.bodyText.match(/http:\/\/[^\s]*\/unsubscribe\?u=[^\s]+/)?.[0];
    expect(link, "the broadcast body must carry an unsubscribe link").toBeTruthy();

    await page.goto(link!);
    await page.getByRole("button", { name: "Unsubscribe from studio news" }).click();
    await expect(page.getByText(/unsubscribed from studio news/i)).toBeVisible();

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);
    await staff.goto("/admin/announcements/new");
    await staff.getByLabel("Title").fill("Second notice");
    await staff.getByLabel("Body").fill("This one should reach nobody.");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.getByRole("button", { name: "Publish" }).click();

    // The panel names the count before anything goes out — and it is zero.
    await expect(staff.getByText(/0 recipients|Nobody matches this audience/).first()).toBeVisible();

    const second = await latestAnnouncementId();
    await staff.getByRole("button", { name: "Send the email" }).click();
    expect(await deliveriesForSource("announcement", second)).toHaveLength(0);

    await context.close();
  });

  test("cancelling a date still reaches the unsubscribed parent", async ({ browser }) => {
    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);

    await staff.goto("/admin/classes");
    await staff.getByRole("link", { name: className }).click();
    const firstDate = staff.locator("li").filter({ hasText: "Cancel this date" }).first();
    await firstDate.getByPlaceholder("Why? Families will read this.").fill("The instructor is unwell.");
    await firstDate.getByRole("button", { name: "Cancel this date" }).click();

    await expect(staff.getByText("Cancelled — The instructor is unwell.")).toBeVisible();

    /*
     * The assertion this test is actually named for. The parent unsubscribed
     * from studio news in the previous scenario, and a cancellation is
     * transactional — it must reach them anyway. Checking only that the admin
     * page says "Cancelled" would pass even if the roster were never told,
     * which is the failure that matters here.
     */
    const occurrenceId = await cancelledOccurrenceIdFor(className);
    await expect
      .poll(async () => {
        const rows = await deliveriesForSource("class_occurrence", occurrenceId);
        return rows.map((row) => `${row.recipientEmail}:${row.template}:${row.status}`);
      })
      .toEqual([`${parentEmail}:class.cancelled:sent`]);

    // And it carries no way to opt out of it.
    const [delivery] = await deliveriesForSource("class_occurrence", occurrenceId);
    expect(delivery!.category).toBe("transactional");
    expect(delivery!.bodyText.toLowerCase()).not.toContain("unsubscribe");
    expect(delivery!.bodyHtml.toLowerCase()).not.toContain("unsubscribe");

    await context.close();
  });
});
