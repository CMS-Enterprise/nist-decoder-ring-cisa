/**
 * Searching for a control: the term narrows the cake through the address, and the
 * dropdown's result opens the control.
 */

import { expect, test } from "@playwright/test";

import {
  banner,
  controlHeading,
  counts,
  openBridge,
  pathAndQuery,
} from "./cake";

test("searching for a control number narrows the cake and its result opens the control", async ({
  page,
}) => {
  await openBridge(page);
  const { total } = await counts(page);

  const box = page.getByRole("combobox", { name: "Search controls" });
  await box.fill("IA-02");

  await expect(page).toHaveURL(/[?&]q=IA-02(&|$)/);
  await expect(banner(page)).toHaveText(
    new RegExp(`^Showing \\d+ of ${total} controls$`),
  );
  const { matched } = await counts(page);
  expect(matched).toBeGreaterThan(0);
  expect(matched).toBeLessThan(total);

  // The result links the control and says what matched.
  const result = page.getByRole("option", { name: /^IA-02 .*control number$/ });
  await expect(result).toBeVisible();
  await result.click();

  await expect(controlHeading(page, "IA-02")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/control/IA-02");
  expect(pathAndQuery(page)).toMatch(/[?&]q=IA-02(&|$)/);
});

test("closing a control opened from a result gives focus back to the box without reopening the list", async ({
  page,
}) => {
  await openBridge(page);
  const box = page.getByRole("combobox", { name: "Search controls" });
  await box.fill("IA-02");
  const result = page.getByRole("option", { name: /^IA-02 .*control number$/ });
  await result.click();
  await expect(controlHeading(page, "IA-02")).toBeVisible();

  // The address keeps the term, so the box does; the dialog hands focus back to it,
  // and that return must not reopen the list the pick closed.
  await page.keyboard.press("Escape");
  await expect(controlHeading(page, "IA-02")).toBeHidden();
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("IA-02");
  await expect(result).toBeHidden();

  // Once focus has left, coming back to the box opens the list again.
  await page.keyboard.press("Tab");
  await expect(box).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(box).toBeFocused();
  await expect(result).toBeVisible();
});

test("the arrow keys and Enter open a result without leaving the box", async ({
  page,
}) => {
  await openBridge(page);
  const box = page.getByRole("combobox", { name: "Search controls" });
  await box.fill("IA-02");
  const result = page.getByRole("option", { name: /^IA-02 .*control number$/ });
  await expect(result).toBeVisible();

  await box.press("ArrowDown");
  await expect(box).toHaveAttribute(
    "aria-activedescendant",
    (await page.getByRole("option").first().getAttribute("id"))!,
  );
  await expect(box).toBeFocused();
  await box.press("Enter");

  await expect(controlHeading(page, "IA-02")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/control/IA-02");
});
