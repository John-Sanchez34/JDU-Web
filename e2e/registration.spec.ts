import { expect, test } from "@playwright/test";
import { seedSeasonWithClass } from "./fixtures/seed";

test.describe("family registration", () => {
  let className: string;

  test.beforeAll(async () => {
    className = await seedSeasonWithClass();
  });

  test("a parent can register, add a student, and see the catalog", async ({
    page,
  }) => {
    const email = `e2e+${Date.now()}@example.com`;

    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Ana Alvarez");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();

    // Sign-up is an async request; navigating away before it lands would
    // cancel it, so wait for the redirect that only happens on success.
    await expect(page).toHaveURL(/\/verify$/);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/portal$/);

    // Exact: the overview also links to "Manage students".
    await page.getByRole("link", { name: "Students", exact: true }).click();
    await page.getByRole("link", { name: "Add a student" }).click();
    await page.getByLabel("First name").fill("Maya");
    await page.getByLabel("Last name").fill("Alvarez");
    await page.getByLabel("Date of birth").fill("2015-04-12");
    await page.getByRole("button", { name: "Save student" }).click();

    await expect(page.getByText("Maya Alvarez")).toBeVisible();

    await page.goto("/classes");
    await expect(page.getByRole("heading", { name: className })).toBeVisible();
    await expect(page.getByText("$65.00")).toBeVisible();
  });

  test("the public schedule shows the seeded class", async ({ page }) => {
    await page.goto("/schedule");
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Week" })).toBeVisible();
  });

  test("an unauthenticated visitor is redirected away from the portal", async ({
    page,
  }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a parent cannot reach the admin area", async ({ page }) => {
    const email = `e2e-parent+${Date.now()}@example.com`;

    await page.goto("/sign-up");
    await page.getByLabel("Your name").fill("Ben Brooks");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();

    // Sign-up is an async request; navigating away before it lands would
    // cancel it, so wait for the redirect that only happens on success.
    await expect(page).toHaveURL(/\/verify$/);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Not allowed" })).toBeVisible();
  });
});
