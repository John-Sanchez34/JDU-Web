import { expect, test, type Page } from "@playwright/test";
import { signIn, signUp } from "./fixtures/auth";
import {
  deliveriesForEnrollment,
  latestEnrollmentIdFor,
  promoteToStaff,
  seedOpenSeasonWithClass,
  type SeededClass,
} from "./fixtures/seed";

/*
 * One thread of the enrollment path, in order: a parent requests a seat, staff
 * confirm it, and the parent gives it back. Each scenario builds on the last,
 * so they run serially and a failure stops the rest rather than reporting the
 * same broken state four times.
 */
test.describe.configure({ mode: "serial" });

/** The public catalog card for one class, by its heading. */
function cardOn(page: Page, className: string) {
  return page.locator("article").filter({
    has: page.getByRole("heading", { name: className }),
  });
}

/** The portal cell wrapping a class card and its request form. */
function portalCellOn(page: Page, className: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: className }) })
    .last();
}

test.describe("enrollment", () => {
  let open: SeededClass;
  let full: SeededClass;
  const parentEmail = `e2e-enroll-parent+${Date.now()}@example.com`;
  const staffEmail = `e2e-enroll-staff+${Date.now()}@example.com`;

  test.beforeAll(async () => {
    // Two seats, so one request visibly takes one and withdrawing gives it
    // back. The full class shares the season because the portal only ever
    // lists the current one.
    open = await seedOpenSeasonWithClass(2);
    full = await seedOpenSeasonWithClass(1, {
      seasonId: open.seasonId,
      seatsTaken: 1,
      name: `E2E Sold Out ${Date.now()}`,
    });
  });

  test("a parent requests a seat", async ({ page }) => {
    await signUp(page, "Vera Vasquez", parentEmail);
    await signIn(page, parentEmail);
    await expect(page).toHaveURL(/\/portal$/);

    await page.getByRole("link", { name: "Students", exact: true }).click();
    await page.getByRole("link", { name: "Add a student" }).click();
    await page.getByLabel("First name").fill("Lucia");
    await page.getByLabel("Last name").fill("Vasquez");
    await page.getByLabel("Date of birth").fill("2016-02-02");
    await page.getByRole("button", { name: "Save student" }).click();
    await expect(page.getByText("Lucia Vasquez")).toBeVisible();

    await page.goto("/portal");
    await portalCellOn(page, open.className)
      .getByRole("button", { name: "Request seat" })
      .click();

    /*
     * The request form is a client component with no success message, so
     * `.click()` resolves before the action commits. Navigating away here
     * races it: the enrollments page is server-rendered, so a goto that wins
     * the race renders "No class requests yet." and never re-fetches, which
     * no `toBeVisible` timeout can recover from. The card's seat count
     * dropping is the signal that the seat was really taken.
     */
    await expect(
      cardOn(page, open.className).getByText("1 spot left"),
    ).toBeVisible();

    await page.goto("/portal/enrollments");
    await expect(page.getByText("Requested")).toBeVisible();

    // after() runs once the response is finished, so the row may still be in
    // flight for a moment after the page renders.
    const enrollmentId = await latestEnrollmentIdFor("Lucia");
    await expect
      .poll(async () => {
        const rows = await deliveriesForEnrollment(enrollmentId);
        return rows.map((row) => `${row.template}:${row.status}`);
      })
      .toEqual(["enrollment.requested:sent"]);
  });

  test("staff confirm the request", async ({ browser }) => {
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await signUp(staff, "Sonia Staff", staffEmail);
    await promoteToStaff(staffEmail);
    await signIn(staff, staffEmail);

    await staff.goto("/admin/enrollments");
    await expect(staff.getByText("Lucia Vasquez")).toBeVisible();
    await expect(staff.getByText(open.className)).toBeVisible();

    await staff.getByRole("button", { name: "Confirm Lucia Vasquez" }).click();
    await expect(staff.getByText("No requests waiting.")).toBeVisible();

    await staff.goto("/admin/emails");
    await expect(staff.getByText("Everything has been delivered.")).toBeVisible();
    await staffContext.close();

    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, parentEmail);
    await parent.goto("/portal/enrollments");
    await expect(parent.getByText("Enrolled")).toBeVisible();

    const enrollmentId = await latestEnrollmentIdFor("Lucia");
    await expect
      .poll(async () => {
        const rows = await deliveriesForEnrollment(enrollmentId);
        return rows.map((row) => `${row.template}:${row.status}`);
      })
      .toEqual(["enrollment.requested:sent", "enrollment.confirmed:sent"]);
    await parentContext.close();
  });

  test("a full class cannot be requested", async ({ page }) => {
    await page.goto("/classes");
    await expect(
      cardOn(page, full.className).getByText("Full", { exact: true }),
    ).toBeVisible();

    await signIn(page, parentEmail);
    await page.goto("/portal");
    // The card is listed, but with no way to ask for a seat.
    await expect(
      page.getByRole("heading", { name: full.className }),
    ).toBeVisible();
    await expect(
      portalCellOn(page, full.className).getByRole("button", {
        name: "Request seat",
      }),
    ).toHaveCount(0);
  });

  test("withdrawing returns the seat", async ({ page }) => {
    await page.goto("/classes");
    await expect(cardOn(page, open.className).getByText("1 spot left")).toBeVisible();

    await signIn(page, parentEmail);
    await page.goto("/portal/enrollments");
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Withdrawn")).toBeVisible();

    await page.goto("/classes");
    await expect(cardOn(page, open.className).getByText("2 spots left")).toBeVisible();
  });
});
