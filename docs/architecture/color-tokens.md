# Color tokens

Standard sets every color through semantic tokens, defined once in `@theme` in `app/src/styles/globals.css`. A component writes `bg-surface` or `text-ink-muted`, never a palette class such as `bg-slate-50` or a hex value. A theme is a set of values for the same names, and Standard has two, light and dark. Switching between them changes no component.

Both themes' values are [USWDS](https://designsystem.digital.gov/design-tokens/color/system-tokens/) 3.14.0 system colors. They are copied into `@theme` with each USWDS name beside its value, rather than installed: Standard builds its styles with Tailwind and has no Sass pipeline, and a second one for a list of hex values isn't worth it. When USWDS changes a value, update it here and in `globals.css` together.

## The tokens

Each token has a light and a dark value, both USWDS 3.14.0 system colors. `scrim`, behind a modal, is black in both.

| Token | Light: USWDS | Light: hex | Dark: USWDS | Dark: hex |
|---|---|---|---|---|
| `ink` | gray-90 | `#1b1b1b` | gray-cool-5 | `#edeff0` |
| `ink-muted` | gray-cool-60 | `#565c65` | gray-cool-20 | `#c6cace` |
| `on-accent` | white | `#ffffff` | gray-90 | `#1b1b1b` |
| `surface` | white | `#ffffff` | gray-cool-80 | `#2d2e2f` |
| `surface-canvas` | gray-cool-2 | `#f7f9fa` | gray-cool-90 | `#1c1d1f` |
| `surface-muted` | gray-cool-5 | `#edeff0` | gray-cool-70 | `#3d4551` |
| `surface-strong` | gray-cool-10 | `#dfe1e2` | gray-cool-60 | `#565c65` |
| `surface-statement` | yellow-5 | `#faf3d1` | gold-90 | `#191714` |
| `surface-zt` | blue-5v | `#e8f5ff` | blue-90 | `#11181d` |
| `surface-family` | mint-10 | `#c7efe2` | mint-70 | `#204e34` |
| `surface-statement-raised` | white | `#ffffff` | gold-80 | `#322d26` |
| `surface-zt-raised` | white | `#ffffff` | blue-80 | `#1f303e` |
| `border` | gray-cool-10 | `#dfe1e2` | gray-cool-70 | `#3d4551` |
| `border-strong` | gray-cool-50 | `#71767a` | gray-cool-40 | `#8d9297` |
| `accent` | blue-60v | `#005ea2` | blue-30v | `#58b4ff` |
| `accent-strong` | blue-warm-70v | `#1a4480` | blue-20v | `#a1d3ff` |
| `accent-muted` | blue-10v | `#cfe8ff` | blue-80v | `#112f4e` |
| `accent-subtle` | blue-5v | `#e8f5ff` | blue-warm-80 | `#252f3e` |
| `focus` | blue-50v | `#0076d6` | blue-30v | `#58b4ff` |
| `zt` | cyan-60v | `#00687d` | cyan-30v | `#00bde3` |
| `zt-strong` | cyan-70v | `#0e4f5c` | cyan-20v | `#52daf2` |
| `zt-muted` | cyan-20v | `#52daf2` | cyan-70v | `#0e4f5c` |
| `zt-subtle` | cyan-5v | `#e5faff` | cyan-80v | `#093b44` |
| `state-aligned` | blue-60v | `#005ea2` | blue-40 | `#4f97d1` |
| `state-aligned-enh` | violet-warm-80v | `#481441` | indigo-cool-20 | `#bbc8f5` |
| `state-enh` | cyan-40v | `#009ec1` | cyan-60 | `#2a646d` |
| `state-none` | gray-cool-10 | `#dfe1e2` | gray-cool-80 | `#2d2e2f` |
| `state-none-ink` | gray-cool-70 | `#3d4551` | gray-cool-20 | `#c6cace` |
| `success` | green-cool-60v | `#216e1f` | green-cool-20 | `#b4d0b9` |
| `success-subtle` | green-cool-5v | `#e3f5e1` | green-cool-80v | `#19311e` |
| `warning` | gold-70v | `#5c410a` | gold-20v | `#ffbe2e` |
| `warning-subtle` | gold-5v | `#fef0c8` | gold-80v | `#3b2b15` |
| `error` | red-60v | `#b50909` | red-30v | `#ff8d7b` |
| `error-subtle` | red-5v | `#fff3f2` | red-80v | `#5c1111` |
| `highlight` | yellow-5v | `#fff5c2` | yellow-80v | `#422d19` |
| `highlight-edge` | gold-20v | `#ffbe2e` | gold-40v | `#c2850c` |
| `highlight-ring` | gray-90 | `#1b1b1b` | gold-30v | `#e5a000` |
| `scrim` | black | `#000000` | black | `#000000` |

## Checked pairs

Ratios are WCAG 2.2 contrast ratios computed from the hex values. Text needs 4.5:1 (1.4.3); input edges, control states and the focus indicator need 3:1 against what is next to them (1.4.11). The pairs are the ones a component draws: a text token on each surface it sits on. Tokens not listed never carry text.

### Light

| Token | Checked against (ratio, needed) |
|---|---|
| `ink` | `surface` 17.22 (≥4.5); `surface-canvas` 16.31 (≥4.5); `surface-muted` 14.93 (≥4.5); `surface-statement` 15.42 (≥4.5); `surface-zt` 15.53 (≥4.5); `surface-family` 13.84 (≥4.5); `highlight` 15.66 (≥4.5); `state-enh` 5.46 (≥4.5); `surface-strong` 13.13 (≥4.5); `surface-statement-raised` 17.22 (≥4.5); `surface-zt-raised` 17.22 (≥4.5) |
| `ink-muted` | `surface` 6.74 (≥4.5); `surface-canvas` 6.38 (≥4.5); `surface-muted` 5.85 (≥4.5); `surface-statement` 6.04 (≥4.5); `surface-zt` 6.08 (≥4.5); `surface-family` 5.42 (≥4.5); `warning-subtle` 5.94 (≥4.5); `surface-statement-raised` 6.74 (≥4.5); `surface-zt-raised` 6.74 (≥4.5) |
| `on-accent` | `accent` 6.72 (≥4.5); `accent-strong` 9.62 (≥4.5); `ink` 17.22 (≥4.5); `ink-muted` 6.74 (≥4.5); `zt` 6.41 (≥4.5); `zt-strong` 9.16 (≥4.5); `state-aligned` 6.72 (≥4.5); `state-aligned-enh` 14.46 (≥4.5); `success` 6.34 (≥4.5) |
| `border-strong` | `surface` 4.59 (≥3); `surface-canvas` 4.35 (≥3) |
| `accent` | `surface` 6.72 (≥4.5); `surface-canvas` 6.37 (≥4.5); `surface-statement` 6.02 (≥4.5); `surface-zt` 6.06 (≥4.5); `accent-subtle` 6.06 (≥4.5); `accent-muted` 5.33 (≥4.5); `surface-zt-raised` 6.72 (≥4.5) |
| `accent-strong` | `surface` 9.62 (≥4.5); `accent-muted` 7.62 (≥4.5); `accent-subtle` 8.68 (≥4.5) |
| `focus` | `surface` 4.60 (≥3); `surface-canvas` 4.36 (≥3); `surface-muted` 3.99 (≥3); `surface-statement` 4.12 (≥3); `surface-zt` 4.15 (≥3) |
| `zt` | `surface` 6.41 (≥4.5); `zt-subtle` 5.94 (≥4.5); `surface-statement` 5.74 (≥3) |
| `state-none-ink` | `state-none` 7.38 (≥4.5) |
| `success` | `surface` 6.34 (≥4.5); `success-subtle` 5.56 (≥4.5); `surface-zt` 5.71 (≥4.5); `accent-subtle` 5.71 (≥4.5); `surface-zt-raised` 6.34 (≥4.5) |
| `warning` | `surface` 9.48 (≥4.5); `warning-subtle` 8.36 (≥4.5); `surface-statement` 8.49 (≥4.5); `highlight` 8.62 (≥4.5) |
| `error` | `surface` 6.98 (≥4.5); `error-subtle` 6.43 (≥4.5) |
| `highlight-ring` | `highlight` 15.66 (≥3); `surface-statement-raised` 17.22 (≥3) |

### Dark

| Token | Checked against (ratio, needed) |
|---|---|
| `ink` | `surface` 11.80 (≥4.5); `surface-canvas` 14.62 (≥4.5); `surface-muted` 8.40 (≥4.5); `surface-statement` 15.51 (≥4.5); `surface-zt` 15.53 (≥4.5); `surface-family` 8.27 (≥4.5); `highlight` 11.23 (≥4.5); `state-enh` 5.79 (≥4.5); `surface-strong` 5.85 (≥4.5); `surface-statement-raised` 11.83 (≥4.5); `surface-zt-raised` 11.74 (≥4.5) |
| `ink-muted` | `surface` 8.25 (≥4.5); `surface-canvas` 10.23 (≥4.5); `surface-muted` 5.88 (≥4.5); `surface-statement` 10.85 (≥4.5); `surface-zt` 10.87 (≥4.5); `surface-family` 5.79 (≥4.5); `warning-subtle` 8.26 (≥4.5); `surface-statement-raised` 8.28 (≥4.5); `surface-zt-raised` 8.22 (≥4.5) |
| `on-accent` | `accent` 7.70 (≥4.5); `accent-strong` 10.89 (≥4.5); `ink` 14.93 (≥4.5); `ink-muted` 10.45 (≥4.5); `zt` 7.70 (≥4.5); `zt-strong` 10.39 (≥4.5); `state-aligned` 5.48 (≥4.5); `state-aligned-enh` 10.41 (≥4.5); `success` 10.39 (≥4.5) |
| `border-strong` | `surface` 4.34 (≥3); `surface-canvas` 5.37 (≥3) |
| `accent` | `surface` 6.08 (≥4.5); `surface-canvas` 7.54 (≥4.5); `surface-statement` 8.00 (≥4.5); `surface-zt` 8.01 (≥4.5); `accent-subtle` 6.04 (≥4.5); `accent-muted` 6.09 (≥4.5); `surface-zt-raised` 6.05 (≥4.5) |
| `accent-strong` | `surface` 8.60 (≥4.5); `accent-muted` 8.62 (≥4.5); `accent-subtle` 8.54 (≥4.5) |
| `focus` | `surface` 6.08 (≥3); `surface-canvas` 7.54 (≥3); `surface-muted` 4.33 (≥3); `surface-statement` 8.00 (≥3); `surface-zt` 8.01 (≥3) |
| `zt` | `surface` 6.08 (≥4.5); `zt-subtle` 5.46 (≥4.5); `surface-statement` 8.00 (≥3) |
| `state-none-ink` | `state-none` 8.25 (≥4.5) |
| `success` | `surface` 8.20 (≥4.5); `success-subtle` 8.45 (≥4.5); `surface-zt` 10.80 (≥4.5); `accent-subtle` 8.14 (≥4.5); `surface-zt-raised` 8.17 (≥4.5) |
| `warning` | `surface` 8.20 (≥4.5); `warning-subtle` 8.21 (≥4.5); `surface-statement` 10.78 (≥4.5); `highlight` 7.81 (≥4.5) |
| `error` | `surface` 6.06 (≥4.5); `error-subtle` 6.06 (≥4.5) |
| `highlight-ring` | `highlight` 5.77 (≥3); `surface-statement-raised` 6.08 (≥3) |

## Decisions

- **Two text colors.** `ink` and `ink-muted` carry all text on a light surface, and `on-accent` all text on a filled color. USWDS's `gray-cool-50` would be the obvious third, lighter gray, but it is 4.59:1 on white and falls under 4.5:1 on every tint here (3.98 on `surface-muted`), so it is used only as `border-strong`.
- **Focus is `blue-50v`, not USWDS's `blue-40v`.** `blue-40v` is 3.20:1 on white but 2.8:1 on the Zero Trust pane and 2.1:1 next to a blue chip. One rule in `globals.css` draws a 2px outline 2px off every focused element, so the color beside the outline is the surface behind the control, and `blue-50v` clears 3:1 on every surface listed above.
- **The cake's states step in lightness.** The three filled states once shared a lightness (L* 39, 39, 40) and merged in grayscale and for color-blind readers. They now step from light to dark as coverage grows: not mapped L* 89, enhancements only 60, aligned 39, aligned with enhancements 17. At the cake's zoomed-out view, where the glyphs are too small to read, that step is what separates them. The enhancements-only chip takes `ink` text, since white on cyan-40v is 3.15:1. The modal's mapped tabs keep the darker `zt` (cyan-60v) with white text, so the two teals differ.
- **State is never color alone (1.4.1).** The four Zero Trust states on the cake each have a glyph as well as a fill (● aligned, ◆ aligned with enhancements, ▲ enhancements only, ○ not mapped), and each chip's accessible name says its state. The chips and the legend read one list, `ZT_STATES` in `FamilyColumn.tsx`. In the control modal, the open tab is pressed (`aria-pressed`) and carries a bar, and a tab whose control is mapped is marked "ZT" in text and in its name.
- **Borders.** `border` is for decorative dividers between areas that their content already separates. Inputs and input-like controls use `border-strong`, which is 3:1 against the page.
- **A mark that carries meaning is 3:1 (1.4.11).** The left border on a statement item covered by Zero Trust is the only sign that it is covered, so it and its legend use `zt`, not `zt-muted`. A highlighted statement item has an `ink` ring, since its `highlight` fill is close to the pane. The enhancements-only chip has a `border-strong` edge, since its fill is 2.99:1 on the light canvas.
- **In dark, filled colors turn light.** The accent, the Zero Trust cyan, the state fills and success all take a light grade, so `on-accent`, the text on them, turns dark (gray-90). One token pairing then holds in both themes, with no component naming a theme.
- **Dark fills are the plain grades, not the vivid ones.** Vivid grades (the USWDS `v` colors) glare on a near-black page, and on the cake they covered about half the chips, so the most-covered state read as an alarm. The chips and success take the plain grade at the same lightness: cyan-60, blue-40, indigo-cool-20 and green-cool-20. The three mapped states are neighboring cool hues, cyan to blue to periwinkle, so they read as one scale while each keeps a hue of its own; the rare enhancements-only chip stays teal and easy to find. The order matches light mode's cyan, blue and violet. Accent, focus and the Zero Trust cyan stay vivid, since they mark links, focus and the mapped tabs, which should stand out.
- **The cake's ladder runs the other way in dark.** The states step lighter as coverage grows: not mapped L* 19, enhancements only 39, aligned 60, aligned with enhancements 81. The steps are still about 20 apart, so grayscale and color-blind reading hold. The enhancements-only chip keeps `ink` text, which is light in dark mode, on a dark cyan-60. The chip's `border-strong` edge, not its fill, separates it from the canvas (5.37:1).
- **Hovers on the chips lighten or darken in both themes.** Each chip's hover is a `brightness` filter, chosen so its text stays above 4.5:1 in light and dark. ZT Aligned lightens (`brightness-110`), since darkening it in dark mode took its text to 4.43:1. ZT Aligned + Enhancements lightens in light (`brightness-150`) and darkens in dark (`dark:hover:brightness-90`), since lightening its pale dark fill washes it to white; it is the one class that names a theme.
- **Each modal pane's cards are raised in its own hue.** The statement and Zero Trust panes are near-black in dark. Their cards take `surface-statement-raised` (gold-80) and `surface-zt-raised` (blue-80), a step lighter than the pane, so the cards read as raised and each pane keeps its color where the text is. Both tokens are white in light, as the cards were.
- **The highlight ring has its own token.** `highlight-ring` is ink in light, where the gold edge is too faint against the pane, and gold-30v in dark, where ink would draw a white box. Either way it is 3:1 against the highlight.
- **`surface-strong` is a step past `surface-muted` in dark too** (gray-cool-60 against gray-cool-70), so a hover from one to the other shows. The statement's item letters sit on it, so they use `ink`.
- **A scrim of its own.** The layer behind a modal was `ink` at 70%, which turns light in dark mode. `scrim` is black in both themes.
- **A Download button that's off looks off in grayscale.** While the export is blocked or preparing, the button is `surface-muted` with a `border-strong` edge and `ink-muted` text, not a filled gray. A filled `ink-muted` was the same lightness as the `accent` fill in light (1.00:1), so off and on looked alike without color. Now the two fills are L* 94 and 39 in light (5.83:1) and L* 29 and 71 in dark (4.33:1).

## Switching themes

The page shows one theme at a time through one attribute, `<html data-theme="light">` or `"dark"`. Every token's dark value is set on `:root[data-theme="dark"]`, which also sets `color-scheme: dark` so scrollbars and form controls follow. A `dark:` Tailwind variant keyed to the same attribute exists for exceptions; one chip hover uses it.

- **The choice.** The header's Theme control offers Light, Dark and System. Light or Dark is stored in `localStorage` under `decoder-ring-theme`; System removes it. With nothing stored, the page follows `prefers-color-scheme`, including when the system setting changes. A choice made in one tab shows in the others at once, through the storage event.
- **Before first paint.** The root layout puts a small script in `<head>` that sets the attribute from the stored choice or the system setting before the body renders, so a dark choice never flashes light. The script is `applyTheme` in `app/src/app/_components/theme/theme.ts`, inlined from its own source, and the toggle calls the same function.
- **No server state.** Nothing about the theme goes to the server, so pages stay static.
- **For Tailored and the accessibility scan.** Tailored's dark mode can use the same attribute and key. A scan sets dark by choosing Dark in the Theme control; frostfall can't emulate `prefers-color-scheme`, and doesn't yet set storage directly. Each state in `app/e2e/frostfall/frostfall.yml` has a dark twin that does this before its steps.
- **Under a Content Security Policy.** The app sets none today, so the inline script runs. If one is added, the script needs to be allowed in `script-src`. It's the same on every request, so a `sha256` hash of it covers it with no nonce plumbing. The script is built from `applyTheme`'s compiled source, though, so the hash changes when that function or the build's minifier does: compute it from the built page, not by hand.

## Adding a color

Add a token only for a new role, not a new shade of an existing one. Give it a USWDS value, add its row here with the pairs it is drawn on, and check each pair with the frostfall scan or a contrast checker before using it.
