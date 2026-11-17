/**
 * The cake's chips as the browser draws them: each alignment state's background and text
 * color, and a keyboard-focused chip's outline. Read from the computed style, not the
 * class names, because a stylesheet loaded outside Tailwind's layers overrides its
 * utilities while the classes stay on the element.
 *
 * Each expected color is the semantic color token the state is meant to use (see
 * `docs/architecture/color-tokens.md`), resolved in the same page, so the comparison does
 * not depend on how the browser writes a color.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { chips, openBridge } from "./cake";

/** Each alignment state, as the Status facet writes it, with its chip's tokens. */
const STATES = [
  {
    status: "zero-trust-aligned",
    background: "state-aligned",
    text: "on-accent",
  },
  {
    status: "zt-aligned-with-enhancements",
    background: "state-aligned-enh",
    text: "on-accent",
  },
  { status: "zt-via-enhancements", background: "state-enh", text: "ink" },
  { status: "compliance", background: "state-none", text: "state-none-ink" },
] as const;

const FOCUS_OUTLINE = "focus";

/** What an undefined custom property leaves `background-color` at. */
const TRANSPARENT = "rgba(0, 0, 0, 0)";

/**
 * What these color tokens compute to. Each is read through `background-color`, which does
 * not inherit: a token that does not exist resolves to transparent without an error, so a
 * renamed token fails here, on the expectation itself, rather than as a color mismatch on
 * the chip. Read through `color`, it would quietly take the page's text color instead.
 */
async function resolveTokens(
  page: Page,
  background: string,
  text: string,
): Promise<{ background: string; text: string }> {
  const [bg, fg] = await page.evaluate(
    (tokens) => {
      const probe = document.createElement("div");
      document.body.append(probe);
      const values = tokens.map((token) => {
        probe.style.backgroundColor = `var(--color-${token})`;
        return getComputedStyle(probe).backgroundColor;
      });
      probe.remove();
      return values;
    },
    [background, text],
  );
  expect(bg, `--color-${background} is defined`).not.toBe(TRANSPARENT);
  expect(fg, `--color-${text} is defined`).not.toBe(TRANSPARENT);
  return { background: bg!, text: fg! };
}

/**
 * A chip's ring is set at 2px divided by the cake's zoom, so it renders at 2px. Chrome
 * rounds an outline to whole CSS pixels before the zoom shrinks it, so on screen it
 * lands within one zoomed pixel under 2px.
 */
function expectRendered2px(length: string, scale: number) {
  const rendered = parseFloat(length) * scale;
  expect(rendered).toBeGreaterThan(2 - scale - 0.01);
  expect(rendered).toBeLessThanOrEqual(2.01);
}

function computed(chip: Locator) {
  return chip.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      background: s.backgroundColor,
      text: s.color,
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
      outlineOffset: s.outlineOffset,
      // The cake's zoom: the ring is drawn at 2px divided by it, so it renders at 2px.
      scale: parseFloat(s.getPropertyValue("--cake-scale")) || 1,
      focusVisible: el.matches(":focus-visible"),
    };
  });
}

/** The first chip in a state: filter to it and collapse the cake to the matches. */
async function firstChipIn(page: Page, status: string): Promise<Locator> {
  await openBridge(page, `/?status=${status}`);
  await page.getByRole("button", { name: "Collapse to matches" }).click();
  const chip = chips(page).first();
  await expect(chip).toBeVisible();
  return chip;
}

for (const state of STATES) {
  test(`a ${state.status} chip draws ${state.background} with ${state.text} text, and keeps it under keyboard focus`, async ({
    page,
  }) => {
    const chip = await firstChipIn(page, state.status);
    const want = await resolveTokens(page, state.background, state.text);
    const outline = (await resolveTokens(page, FOCUS_OUTLINE, FOCUS_OUTLINE))
      .text;

    const idle = await computed(chip);
    expect(idle.background).toBe(want.background);
    expect(idle.text).toBe(want.text);

    // A key press first, so the browser treats the focus that follows as keyboard focus.
    await page.keyboard.press("Shift");
    await chip.focus();
    // The chip transitions every property, the outline included; read it once settled.
    // The ring follows the cake's zoom, so a pan on focus restarts its transition and
    // cancels the one before: wait until none is left running.
    await chip.evaluate(async (el) => {
      for (let i = 0; i < 20 && el.getAnimations().length > 0; i++) {
        await Promise.allSettled(el.getAnimations().map((a) => a.finished));
      }
    });
    const focused = await computed(chip);
    expect(focused.focusVisible).toBe(true);
    expect(focused.background).toBe(want.background);
    expect(focused.text).toBe(want.text);
    expect(focused.outlineStyle).toBe("solid");
    expectRendered2px(focused.outlineWidth, focused.scale);
    expectRendered2px(focused.outlineOffset, focused.scale);
    expect(focused.outlineColor).toBe(outline);
  });
}
