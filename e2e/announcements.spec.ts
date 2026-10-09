import { expect, test } from "@playwright/test";
import { signIn, signUp } from "./fixtures/auth";
import { cardOn, portalCellOn } from "./fixtures/locators";
import {
  cancelledOccurrenceIdFor,
  deliveriesForSource,
  isBroadcastOptedOut,
  latestAnnouncementId,
  promoteToStaff,
  seedOpenSeasonWithClass,
} from "./fixtures/seed";

/*
 * One thread: a parent enrols, staff post and send an announcement, the parent
 * reads it and unsubscribes, and the next announcement skips them. Serial,
 * because each scenario builds on the last.
 *
 * Every wait in this file is on a signal that only exists once an action has
 * committed. These forms are client components, so a `.click()` resolves as
 * soon as the click is dispatched, not when the action lands.
 *
 * The two consequences differ in severity, and the comments below say which
 * is which. A wait that matches markup already on the page is simply broken:
 * it resolves instantly and lets the test end, or its context get torn down,
 * while the action is still in flight. A database read taken straight after a
 * click is subtler — measured on this machine the action does commit inside
 * the click-plus-query window, so such a read did see real rows. Waiting for
 * a definite signal first removes the dependence on that margin rather than
 * trusting it to hold on slower hardware or in CI.
 */
test.describe.configure({ mode: "serial" });

test.describe("announcements", () => {
  const stamp = Date.now();
  const parentEmail = `parent-news-${stamp}@example.com`;
  const staffEmail = `staff-news-${stamp}@example.com`;
  let className: string;

  test("a parent takes a seat so they have an audience to be in", async ({ page }) => {
    // Capacity 2, not 10, so taking one seat visibly changes the card:
    // `ClassCard` prints an exact count only at three seats or fewer, and
    // that count is the one signal that the request actually committed.
    const seeded = await seedOpenSeasonWithClass(2);
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

    /*
     * `createStudentAction` redirects to /portal/students. Navigating before
     * that lands aborts the POST, and /portal then renders the empty branch
     * of `EnrollmentRequestForm` — "Add a student to request a seat in this
     * class." — with no Request seat button at all, so the next step would
     * fail on a missing locator rather than on anything it means to test.
     * Both sibling specs guard this same step.
     */
    await expect(page.getByText("Nina News")).toBeVisible();

    await page.goto("/portal");
    await portalCellOn(page, className)
      .getByRole("button", { name: "Request seat" })
      .click();

    /*
     * The seat count dropping to "1 spot left" is the proof the enrollment
     * committed: `requestEnrollmentAction` calls `revalidatePath`, so Next
     * re-renders /portal into the action's own response and the card updates
     * in place.
     *
     * This replaces a wait on /seat is held|request/i, which matched the
     * "Request a class seat" heading and the "Requesting a seat holds it
     * right away" blurb — both on the page before any click, and neither
     * evidence of anything. It resolved instantly, so the test ended while
     * the action was still in flight and the context teardown could cancel
     * the very enrollment the rest of this file depends on.
     */
    await expect(cardOn(page, className).getByText("1 spot left")).toBeVisible();
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

    /*
     * The send panel only renders once the publish has committed and the page
     * re-rendered, so waiting for its button pins the read below to a known
     * state instead of to whatever the publish had managed by then. The read
     * was not actually blind before this — the publish does commit inside the
     * click-plus-query window here — but it was relying on that margin, and
     * the margin is not something this suite controls.
     */
    const sendButton = staff.getByRole("button", { name: "Send the email" });
    await expect(sendButton).toBeVisible();

    const announcementId = await latestAnnouncementId();
    expect(await deliveriesForSource("announcement", announcementId)).toHaveLength(0);

    await sendButton.click();
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

    /*
     * Visiting the link must opt nobody out — only pressing the button may.
     * Corporate mail scanners follow every link in every message, so a page
     * that unsubscribed on load would quietly unsubscribe families who never
     * clicked, at scale. Asserting only the state after the click would pass
     * against exactly that page, which is why the column is read here, in
     * between, rather than inferred from whether a later send reached anyone.
     */
    expect(await isBroadcastOptedOut(parentEmail)).toBe(false);

    await page.getByRole("button", { name: "Unsubscribe from studio news" }).click();
    await expect(page.getByText(/unsubscribed from studio news/i)).toBeVisible();
    expect(await isBroadcastOptedOut(parentEmail)).toBe(true);

    const context = await browser.newContext();
    const staff = await context.newPage();
    await signIn(staff, staffEmail);
    await staff.goto("/admin/announcements/new");
    await staff.getByLabel("Title").fill("Second notice");
    await staff.getByLabel("Body").fill("This one should reach nobody.");
    await staff.getByRole("button", { name: "Save draft" }).click();
    await staff.getByRole("button", { name: "Publish" }).click();

    /*
     * "Nobody matches this audience right now" is the only copy specific to
     * an empty audience — `AnnouncementSendPanel` renders it when
     * `recipientCount` is 0. The count sentence beside it is an unanchored
     * substring, so matching /0 recipients/ would also match "10 recipients"
     * and call an audience empty that was not.
     */
    await expect(
      staff.getByText("Nobody matches this audience right now"),
    ).toBeVisible();

    const second = await latestAnnouncementId();
    await staff.getByRole("button", { name: "Send the email" }).click();

    /*
     * `sendAnnouncement` stamps `emailedAt` as it claims the row, before it
     * resolves the audience, so even a send that reaches nobody flips the
     * panel to its emailed state with nothing waiting. That text is the
     * signal the send finished, so the emptiness asserted below is the
     * emptiness of a completed send rather than of a send that may not have
     * started. Verified by mutation: disabling the opt-out filter in
     * `resolveAnnouncementAudience` turns this scenario red.
     */
    await expect(staff.getByText("Every message has gone out.")).toBeVisible();
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
