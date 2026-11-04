/**
 * The boundary this pipeline exists to hold.
 *
 * Decoder Ring Standard is heading for its own public repository. The other
 * line's seed generator carries an internal mapping spreadsheet's column names,
 * its own baseline glyph vocabulary, an organisation-specific system identity,
 * and transform heuristics named for the source defects they work around. None
 * of that may ship inside a product other federal agencies build on, so this
 * pipeline shares no code with it — enforced here rather than by convention,
 * because a convention holds only until someone is in a hurry.
 *
 * Reading another generator for reference is fine. Importing from it is not:
 * where both genuinely need the same behaviour, that is a signal to reconsider
 * the shape, not to reach across.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = resolve(HERE, "..");

/** Every .ts file in this pipeline, tests included. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** `import ... from "x"`, `export ... from "x"`, and `import("x")`. */
const SPECIFIER_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;

function specifiersIn(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? m[2];
    if (spec) found.push(spec);
  }
  return found;
}

describe("pipeline boundary", () => {
  const files = sourceFiles(PIPELINE_ROOT);

  it("has source files to check", () => {
    // A silently empty sweep would pass every assertion below.
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports nothing from the other generators", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiersIn(file)) {
        if (/ars-seed-generator|zt-seed-generator|zt-overlay/.test(spec)) {
          offenders.push(`${file.slice(PIPELINE_ROOT.length + 1)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports nothing from outside its own directory", () => {
    // Catches the indirect route: a relative path that climbs out of the
    // pipeline reaches the other generators just as effectively as naming them.
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiersIn(file)) {
        if (!spec.startsWith(".")) continue; // node: builtins and packages are fine
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(PIPELINE_ROOT)) {
          offenders.push(`${file.slice(PIPELINE_ROOT.length + 1)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries none of the other line's vocabulary", () => {
    // The specific tokens that must never appear in a product other agencies
    // read: the other line's system identity, its baseline glyphs and their
    // extra level, and the transform kinds named for its source defects.
    const banned =
      /system_cms_gov|Acceptable Risk Safeguards|hva-overcapture|\bHVA\b|DR_Mapping|CMS Discussion/;
    const offenders: string[] = [];
    for (const file of files) {
      // This file states the ban, so it necessarily contains every banned token.
      // Excluding it is not a loophole: it holds no pipeline logic, and the three
      // import assertions above still cover it.
      if (file === fileURLToPath(import.meta.url)) continue;
      const text = readFileSync(file, "utf8");
      for (const [i, line] of text.split("\n").entries()) {
        if (banned.test(line)) {
          offenders.push(`${file.slice(PIPELINE_ROOT.length + 1)}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
