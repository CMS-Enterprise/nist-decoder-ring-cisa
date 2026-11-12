/**
 * The harness's smoke test: the built app, reading the seeded database, draws the
 * layer cake in a real browser. The flows come in their own files.
 */

import { expect, test } from "@playwright/test";

test("the bridge draws the seeded catalog", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The count banner reads "<n> controls" with no filter set, and the cake draws one
  // link per control under the family columns.
  const banner = page.getByText(/^\d+ controls$/);
  await expect(banner).toBeVisible();
  const total = Number((await banner.textContent())?.split(" ")[0]);
  expect(total).toBeGreaterThan(0);

  await expect(page.locator('[id^="family-"]')).not.toHaveCount(0);
  await expect(
    page.locator('[id^="family-"] a[href^="/control/"]'),
  ).toHaveCount(total);

  expect(pageErrors).toEqual([]);
});
