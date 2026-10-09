import { type Page } from "@playwright/test";

/*
 * Locators shared by more than one spec. Both of these depend on `ClassCard`
 * keeping its class name as a heading directly inside its <article>, so they
 * live in one place rather than being copied per spec — two copies drift, and
 * the drift shows up as a timeout in whichever spec was not updated.
 */

/** The public catalog card for one class, by its heading. */
export function cardOn(page: Page, className: string) {
  return page.locator("article").filter({
    has: page.getByRole("heading", { name: className }),
  });
}

/** The portal cell wrapping a class card and its request form. */
export function portalCellOn(page: Page, className: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: className }) })
    .last();
}
