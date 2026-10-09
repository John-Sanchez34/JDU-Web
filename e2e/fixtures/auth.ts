import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";

export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // Sign-up is an async request; navigating away before it lands would cancel
  // it, so wait for the redirect that only happens on success.
  await expect(page).toHaveURL(/\/verify$/);
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Same hazard as sign-up: navigating away while the sign-in request is in
  // flight cancels it and leaves the page signed out, so wait for the redirect.
  await expect(page).not.toHaveURL(/\/sign-in$/);
}
