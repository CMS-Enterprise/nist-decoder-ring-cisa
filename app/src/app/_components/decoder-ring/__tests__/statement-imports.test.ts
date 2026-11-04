/**
 * The shared renderer must not import the badge module.
 *
 * `statement.tsx` says so in a comment, and a comment is not a constraint. The whole
 * value of the slot contract is that a product which supplies nothing cannot render
 * that product's vocabulary; a single import from the renderer to the badge module
 * would make that false while every other test still passed.
 *
 * Read as text rather than by importing, because importing proves the module loads,
 * not what it depends on.
 *
 * On this branch the last case inverts: there is no badge module to point anywhere, and
 * that absence is itself the guarantee, so it is asserted.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG_VOCABULARY } from "~/config/catalog-vocabulary";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the statement renderer's dependencies", () => {
  const source = readFileSync(join(HERE, "..", "statement.tsx"), "utf8");

  it("does not import the badge module", () => {
    expect(source).not.toMatch(/from\s+["'].*baseline-badges["']/);
  });

  it("names no catalog in code a user could see", () => {
    // Comments explain the boundary and necessarily discuss it; rendered text must not.
    const code = source
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(
          t.startsWith("//") ||
          t.startsWith("*") ||
          t.startsWith("/*") ||
          t.startsWith("{/*")
        );
      })
      .join("\n");
    expect(code).not.toMatch(CATALOG_VOCABULARY);
  });

  it("carries no badge module at all on this branch", () => {
    // The other line has a `baseline-badges.tsx` holding its one-letter abbreviations and
    // its supplemental-guidance marker, and fills a slot with it. This branch fills nothing,
    // so the module has no reason to exist here — and its absence is what makes "Standard
    // cannot render another catalog's baseline vocabulary" a fact about the tree rather
    // than a promise about configuration.
    //
    // Asserted rather than assumed: the vocabulary sweep would catch only the terms such a
    // module names, and the module arriving at all is the finding, whatever it says.
    expect(existsSync(join(HERE, "..", "baseline-badges.tsx"))).toBe(false);
  });
});
