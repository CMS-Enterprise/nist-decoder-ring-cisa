/**
 * The focus indicator (2.4.7): one rule in globals.css draws it on every focusable
 * element, so these check that rule in the browser on a cake chip and a modal tab.
 */

import { expect, test, type Locator } from "@playwright/test";

// The focus token, blue-50v, as the browser computes it.
const FOCUS = "rgb(0, 118, 214)";

async function focusOutline(target: Locator) {
  await target.focus();
  return target.evaluate((el) => {
    // The chips and tabs transition their colors (the chips everything), which takes
    // the outline with them; finish the transition and read the settled style.
    for (const animation of el.getAnimations()) animation.finish();
    const style = getComputedStyle(el);
    return {
      focusVisible: el.matches(":focus-visible"),
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      offset: style.outlineOffset,
      // The cake's zoom (1 outside it): a chip's ring is 2px divided by it.
      scale: parseFloat(style.getPropertyValue("--cake-scale")) || 1,
    };
  });
}

const EXPECTED = {
  focusVisible: true,
  style: "solid",
  width: "2px",
  color: FOCUS,
  offset: "2px",
};

test("a focused chip on the cake shows the 2px focus outline", async ({
  page,
}) => {
  await page.goto("/");
  const chip = page.locator('[id^="family-"] a[href^="/control/"]').first();
  // The cake is drawn zoomed out, so the ring is set at 2px divided by the zoom and
  // renders at 2px on screen.
  const { width, offset, scale, ...rest } = await focusOutline(chip);
  expect(rest).toEqual({ ...EXPECTED, width: undefined, offset: undefined });
  // Chrome rounds an outline to whole CSS pixels before the zoom shrinks it, so on
  // screen it lands within one zoomed pixel under 2px.
  for (const length of [width, offset]) {
    expect(parseFloat(length) * scale).toBeGreaterThan(2 - scale - 0.01);
    expect(parseFloat(length) * scale).toBeLessThanOrEqual(2.01);
  }
});

test("a focused tab in the control modal shows the 2px focus outline", async ({
  page,
}) => {
  await page.goto("/control/AC-02");
  const tab = page.getByRole("button", { name: /^Base( |,|$)/ });
  // Outside the cake, so at its own size: no zoom to divide by.
  expect(await focusOutline(tab)).toEqual({ ...EXPECTED, scale: 1 });
});
