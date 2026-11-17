/**
 * A chip the filter dims is inert: out of the tab order, out of the accessibility tree,
 * and a click on it lands on the column behind. jsdom keeps an inert element in the
 * accessibility tree, so FamilyColumn's unit tests check only the attribute, and these
 * check what it does in the browser. Its low-contrast text is allowed only because it is
 * inactive (1.4.3).
 *
 * The dimmed chips are found by their dim class rather than by role, unlike the other
 * flow tests: a chip that is dimmed but not inert is the regression these catch, and
 * nothing but the class marks it.
 */

import { expect, test } from "@playwright/test";

import { chips, openBridge } from "./cake";

const DIM = ".opacity-30";

test("a chip the filter dims takes no focus or click and leaves the accessibility tree", async ({
  page,
}) => {
  await openBridge(page, "/?pillar=IDENTITY");
  const dimmed = chips(page).and(page.locator(DIM)).first();
  const match = chips(page)
    .and(page.locator(`:not(${DIM})`))
    .first();
  await expect(dimmed).toBeAttached();
  const name = await dimmed.getAttribute("aria-label");
  const matchName = await match.getAttribute("aria-label");
  expect(name).toBeTruthy();
  expect(matchName).toBeTruthy();

  const takesFocus = (el: HTMLElement) => {
    el.focus();
    return document.activeElement === el;
  };
  expect(await dimmed.evaluate(takesFocus)).toBe(false);
  expect(await match.evaluate(takesFocus)).toBe(true);

  // Chromium's own accessibility tree, since Playwright's role queries do not apply
  // inert. A match is checked alongside, so an empty tree cannot pass.
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const exposed = (label: string | null) =>
    nodes.filter((n) => !n.ignored && n.name?.value === label).length;
  expect(exposed(matchName)).toBeGreaterThan(0);
  expect(exposed(name)).toBe(0);

  // What a click at the centre of a dimmed chip would reach. The chip has to sit inside
  // the cake's clipped canvas, clear of the zoom controls, or the point lands on
  // something else whatever the chip is; so the hit must be the chip's own column.
  const reached = await chips(page)
    .and(page.locator(DIM))
    .evaluateAll((els) => {
      for (const chip of els) {
        const column = chip.closest('[id^="family-"]');
        const r = chip.getBoundingClientRect();
        const top = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        if (!column || !top) continue;
        if (chip.contains(top)) return "the chip";
        if (column.contains(top)) return "its column";
      }
      return "no dimmed chip in view";
    });
  expect(reached).toBe("its column");
});

test("with no filter, no chip is dimmed or inert", async ({ page }) => {
  await openBridge(page);
  await expect(chips(page).and(page.locator(DIM))).toHaveCount(0);
  await expect(chips(page).and(page.locator("[inert]"))).toHaveCount(0);
});
