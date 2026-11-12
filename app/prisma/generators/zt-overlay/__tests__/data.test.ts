/**
 * The committed inputs and the committed seed agree.
 *
 * Regenerating from sources/zt-mapping/ must reproduce seed-sql/nist-800-53/09, 11
 * and 13 and reports/zt-overlay/tuples.csv byte for byte, so an edit to an input
 * that was not followed by a regeneration, or a hand edit to a generated file,
 * fails here. The file set is listed here rather than read from the run, so a
 * file the generator stops writing fails instead of dropping its case.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCisaCsv } from "../lib/inputs";
import { REPORTS_DIR, SEED_DIR, SOURCES_DIR } from "../lib/paths";
import { runGenerator } from "../lib/run";

/** Every seed file the generator owns. */
const WRITTEN = [
  "09-zt-mappings.sql",
  "11-zt-part-coverage.sql",
  "13-zt-mapping-affinity.sql",
];

describe("committed overlay", () => {
  const result = runGenerator();
  const files: Record<string, string> = result.files;

  it("writes exactly the files it owns", () => {
    expect(Object.keys(files).sort()).toEqual(WRITTEN);
  });

  it.each(WRITTEN)("%s matches a fresh regeneration", (name) => {
    expect(files[name], `${name} was not generated`).toBeDefined();
    expect(files[name]).toBe(readFileSync(join(SEED_DIR, name), "utf8"));
  });

  it("reports/zt-overlay/tuples.csv matches a fresh regeneration", () => {
    expect(result.tuplesCsv).toBe(
      readFileSync(join(REPORTS_DIR, "tuples.csv"), "utf8"),
    );
  });

  it("reads every CISA row once", () => {
    const cisa = parseCisaCsv(
      readFileSync(join(SOURCES_DIR, "cisa-ztmm-mapping.csv"), "utf8"),
    );
    // Every sheet row appears once, whatever the edition's size; that each
    // also lands in the seed is the reconciliation's job, which runGenerator
    // has already passed above.
    expect(cisa.length).toBeGreaterThan(0);
    expect(new Set(cisa.map((r) => r.sourceRow)).size).toBe(cisa.length);
  });
});
