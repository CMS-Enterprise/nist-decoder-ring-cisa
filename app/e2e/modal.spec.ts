/**
 * The control modal: opened from the cake, it shows over the same cake rather than a new
 * page, and closing it returns to the view it was opened from.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  banner,
  controlHeading,
  counts,
  openBridge,
  pathAndQuery,
} from "./cake";

const FILTERED = "/?pillar=IDENTITY";

/**
 * Tag the cake's family column with a property only this test sets, and return a check
 * that the same element, still in the document, carries it. A remount or a full page
 * load would replace the element and lose the property.
 */
async function markCake(page: Page): Promise<() => Promise<boolean>> {
  const column = await page.locator('[id^="family-"]').first().elementHandle();
  if (!column) throw new Error("The cake drew no family column");
  const token = `${Date.now()}-${Math.random()}`;
  await column.evaluate((el, t) => {
    (el as unknown as { e2eMark?: string }).e2eMark = t;
  }, token);
  // A full page load destroys the element's document, and reading it then throws.
  return () =>
    column
      .evaluate(
        (el, t) =>
          el.isConnected &&
          (el as unknown as { e2eMark?: string }).e2eMark === t,
        token,
      )
      .catch(() => false);
}

/** Open IA-02 from its chip on the filtered cake. */
async function openFromCake(page: Page): Promise<void> {
  await page.locator('[id^="family-"] a[href^="/control/IA-02"]').click();
  await expect(controlHeading(page, "IA-02")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/control/IA-02");
}

test("a control opened from the cake shows over the same cake, and Close returns to the filtered view", async ({
  page,
}) => {
  await openBridge(page, FILTERED);
  const before = await counts(page);
  const sameCake = await markCake(page);

  await openFromCake(page);
  expect(await sameCake()).toBe(true);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(controlHeading(page, "IA-02")).toBeHidden();
  expect(pathAndQuery(page)).toBe(FILTERED);
  await expect(banner(page)).toHaveText(
    `Showing ${before.matched} of ${before.total} controls`,
  );
  expect(await sameCake()).toBe(true);
});

test("a control opened from the keyboard takes focus on its heading, keeps Tab inside, and Escape gives it back to the chip", async ({
  page,
}) => {
  await openBridge(page, FILTERED);
  const chip = page.locator('[id^="family-"] a[href^="/control/IA-02"]');
  await chip.focus();
  await page.keyboard.press("Enter");
  // Through the loading frame, which hands focus on to the control's dialog.
  await expect(controlHeading(page, "IA-02")).toBeFocused();

  const dialog = page.getByRole("dialog");
  const focusInside = () =>
    dialog.evaluate((d) => d.contains(document.activeElement));
  // At either end, Tab and Shift+Tab wrap rather than leave for the page behind.
  await page.keyboard.press("Shift+Tab");
  expect(await focusInside()).toBe(true);
  await page.keyboard.press("Tab");
  expect(await focusInside()).toBe(true);

  await page.keyboard.press("Escape");
  await expect(controlHeading(page, "IA-02")).toBeHidden();
  await expect(chip).toBeFocused();
});

test("Escape closes the modal back to the filtered view", async ({ page }) => {
  await openBridge(page, FILTERED);
  const sameCake = await markCake(page);

  await openFromCake(page);
  await page.keyboard.press("Escape");
  await expect(controlHeading(page, "IA-02")).toBeHidden();
  expect(pathAndQuery(page)).toBe(FILTERED);
  expect(await sameCake()).toBe(true);
});

test("a cross-reference in a control's discussion opens that control", async ({
  page,
}) => {
  await openBridge(page);
  await openFromCake(page);

  await page.getByRole("button", { name: "IA-8", exact: true }).click();
  await expect(controlHeading(page, "IA-08")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/control/IA-08");
});
