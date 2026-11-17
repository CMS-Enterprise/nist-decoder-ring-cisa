/**
 * What the flow tests share: loading the bridge and reading the layer cake the way a
 * reader does, by role, label and text rather than by class.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/** The count banner: "<n> controls" with no filter set, "Showing <m> of <n> controls" with one. */
export function banner(page: Page): Locator {
  return page.getByText(/^(Showing \d+ of )?\d+ controls$/);
}

/** The cake's control chips, one link per control under the family columns. */
export function chips(page: Page): Locator {
  return page.locator('[id^="family-"] a[href^="/control/"]');
}

/** A control's heading in the modal. The cake's own heading is also an h2, so match it exactly. */
export function controlHeading(page: Page, controlNumber: string): Locator {
  return page.getByRole("heading", {
    level: 2,
    name: controlNumber,
    exact: true,
  });
}

/** The banner's numbers: the matched count and the total, equal when nothing is filtered. */
export async function counts(
  page: Page,
): Promise<{ matched: number; total: number }> {
  const text = (await banner(page).textContent()) ?? "";
  const filtered = /^Showing (\d+) of (\d+) controls$/.exec(text);
  if (filtered) {
    return { matched: Number(filtered[1]), total: Number(filtered[2]) };
  }
  const all = /^(\d+) controls$/.exec(text);
  if (!all) throw new Error(`Unexpected banner text: "${text}"`);
  return { matched: Number(all[1]), total: Number(all[1]) };
}

/** Load a bridge address and wait until the cake has drawn its chips. */
export async function openBridge(page: Page, path = "/"): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(banner(page)).toBeVisible();
  await expect(chips(page)).not.toHaveCount(0);
}

/** The hrefs of the chips on screen, in order. */
export async function chipHrefs(page: Page): Promise<string[]> {
  return chips(page).evaluateAll((links) =>
    links.map((a) => a.getAttribute("href") ?? ""),
  );
}

/** The address bar's path and query, as a reader would copy it. */
export function pathAndQuery(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}
