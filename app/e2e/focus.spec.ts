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
  expect(await focusOutline(chip)).toEqual(EXPECTED);
});

test("a focused tab in the control modal shows the 2px focus outline", async ({
  page,
}) => {
  await page.goto("/control/AC-02");
  const tab = page.getByRole("button", { name: /^Base( |,|$)/ });
  expect(await focusOutline(tab)).toEqual(EXPECTED);
});
