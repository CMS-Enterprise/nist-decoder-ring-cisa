/**
 * The generator orders everything the same way on every machine.
 *
 * `localeCompare` takes its order from the process's locale, so the same inputs
 * could write different files on a machine with another `LANG`. The orderings in
 * lib/order.ts do not, and no source here may sort by the locale instead.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compareNumberLists, compareText } from "../lib/order";

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory())
      return name === "__tests__" || name === "node_modules"
        ? []
        : sources(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

describe("overlay orderings", () => {
  it("orders strings by code unit, not by what a locale would do", () => {
    // en-US puts "aa" first; et_EE puts "Zone" before "Traffic"; da_DK puts "aa" last.
    expect(["Zone", "aa", "Traffic"].sort(compareText)).toEqual([
      "Traffic",
      "Zone",
      "aa",
    ]);
    expect(compareText("AC-02", "AC-02")).toBe(0);
  });

  it("orders row lists by number, element by element", () => {
    expect([[12, 45], [3], [12, 5], [12]].sort(compareNumberLists)).toEqual([
      [3],
      [12],
      [12, 5],
      [12, 45],
    ]);
  });

  it("leaves no sort in the generator to the machine's locale", () => {
    const offenders = sources(PIPELINE_ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          line.includes(".localeCompare(")
            ? [`${relative(PIPELINE_ROOT, file)}:${i + 1}`]
            : [],
        ),
    );
    expect(sources(PIPELINE_ROOT).length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
