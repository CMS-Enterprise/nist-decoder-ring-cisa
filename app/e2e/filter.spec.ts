/**
 * Filtering the layer cake: a facet narrows the cake, writes itself to the address, and a
 * reload of that address gives the same view back.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  banner,
  chipHrefs,
  chips,
  counts,
  openBridge,
  pathAndQuery,
} from "./cake";

/** The Pillar dropdown's toggle. Its text gains a count once a pillar is picked. */
function pillarFacet(page: Page) {
  return page.locator("summary").filter({ hasText: /^Pillar/ });
}

test("a pillar filter narrows the cake, and a reload gives the same view back", async ({
  page,
}) => {
  await openBridge(page);
  const { total } = await counts(page);

  await pillarFacet(page).click();
  await page.getByRole("checkbox", { name: "Identity", exact: true }).check();

  await expect(banner(page)).toHaveText(
    new RegExp(`^Showing \\d+ of ${total} controls$`),
  );
  const { matched } = await counts(page);
  expect(matched).toBeGreaterThan(0);
  expect(matched).toBeLessThan(total);
  await expect(page).toHaveURL(/[?&]pillar=IDENTITY(&|$)/);
  await expect(
    page.getByRole("button", { name: "Pillar: Identity" }),
  ).toBeVisible();

  // Collapsing to the matches leaves exactly the controls the banner counts.
  await page.getByRole("button", { name: "Collapse to matches" }).click();
  await expect(chips(page)).toHaveCount(matched);
  const matchedHrefs = await chipHrefs(page);

  const address = pathAndQuery(page);
  await page.reload();
  await expect(banner(page)).toHaveText(
    `Showing ${matched} of ${total} controls`,
  );
  expect(pathAndQuery(page)).toBe(address);
  await expect(
    page.getByRole("button", { name: "Pillar: Identity" }),
  ).toBeVisible();
  await pillarFacet(page).click();
  await expect(
    page.getByRole("checkbox", { name: "Identity", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Collapse to matches" }).click();
  expect(await chipHrefs(page)).toEqual(matchedHrefs);

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(banner(page)).toHaveText(`${total} controls`);
  await expect(chips(page)).toHaveCount(total);
  expect(pathAndQuery(page)).toBe("/");
});
