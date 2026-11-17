import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import colors from "tailwindcss/colors";
import { describe, expect, it } from "vitest";

/**
 * Components set color only through the semantic tokens in globals.css, which is what
 * gives each one a value in every theme (docs/architecture/color-tokens.md). Tailwind
 * keeps its default palette beside the tokens, so a `text-slate-400` still builds, skips
 * the tokens and has no dark value. Resetting the palette in CSS would only make such a
 * class draw nothing, silently, so this fails on one instead.
 *
 * The palette names come from Tailwind itself, so one added in a later version is caught
 * too. `white`, `black`, `transparent` and `current` are not palettes and stay allowed.
 * An arbitrary color such as `bg-[#fff]` skips the tokens the same way and fails too:
 * a hex value or a CSS color function. A named color (`text-[red]`) is not caught, since
 * `[word]` is also how other utilities take keywords.
 */

const SRC = resolve(__dirname, "..");

const PALETTES = Object.entries(colors)
  .filter(([, value]) => typeof value === "object")
  .map(([name]) => name);

// Any utility ending in a palette color and shade, with a variant or opacity or not:
// bg-blue-600, hover:text-slate-400, border-red-500/40.
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])[\\w:-]*-(?:${PALETTES.join("|")})-(?:50|[1-9]00|950)(?:/[\\w.]+)?(?![\\w-])`,
  "g",
);
const ARBITRARY_COLOR =
  /(?<![\w-])[\w:-]*-\[(?:#|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|color:)[^\]]*\]/g;

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".tsx"))
    .filter((path) => !path.split(/[\\/]/).includes("__tests__"))
    .map((path) => join(dir, path));
}

function rawColors(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(PALETTE_CLASS), ...line.matchAll(ARBITRARY_COLOR)].map(
        ([match]) => `${relative(SRC, file)}:${i + 1}: ${match}`,
      ),
    );
}

describe("color classes", () => {
  it("reads Tailwind's palette names", () => {
    expect(PALETTES).toEqual(expect.arrayContaining(["slate", "blue", "red"]));
    expect(PALETTES).not.toContain("white");
  });

  it("no component uses a Tailwind palette color or an arbitrary color", () => {
    const files = componentFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(rawColors)).toEqual([]);
  });

  it.each([
    ["text-slate-400"],
    ["hover:bg-blue-600"],
    ["border-red-500/40"],
    ["dark:focus-visible:ring-mauve-950"],
    ["bg-[#ffffff]"],
    ["text-[rgb(0,0,0)]"],
    ["fill-[oklch(0.5_0.1_200)]"],
    ["bg-[color-mix(in_srgb,red,blue)]"],
    ["text-[lab(50%_40_20)]"],
  ])("catches %s", (cls) => {
    expect(
      [
        ...`className="p-2 ${cls}"`.matchAll(PALETTE_CLASS),
        ...`className="p-2 ${cls}"`.matchAll(ARBITRARY_COLOR),
      ].map(([match]) => match),
    ).toEqual([cls]);
  });

  it.each([
    ["bg-surface-strong"],
    ["text-ink-muted"],
    ["border-state-aligned-enh"],
    ["border-ink/25"],
    ["text-white"],
    ["bg-black"],
    ["border-transparent"],
    ["text-current"],
    ["text-[13px]"],
    ["w-[300px]"],
  ])("allows %s", (cls) => {
    expect(
      [
        ...`className="p-2 ${cls}"`.matchAll(PALETTE_CLASS),
        ...`className="p-2 ${cls}"`.matchAll(ARBITRARY_COLOR),
      ].map(([match]) => match),
    ).toEqual([]);
  });
});
