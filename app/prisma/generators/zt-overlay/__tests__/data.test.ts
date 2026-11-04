/**
 * The committed inputs and the committed seed agree.
 *
 * Regenerating from sources/zt-mapping/ must reproduce seed-sql/nist-800-53/09, 11
 * and 13 and reports/zt-overlay/tuples.csv byte for byte, so an edit to an input
 * that was not followed by a regeneration, or a hand edit to a generated file,
 * fails here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCisaCsv } from "../lib/inputs";
import { REPORTS_DIR, SEED_DIR, SOURCES_DIR } from "../lib/paths";
import { runGenerator } from "../lib/run";

describe("committed overlay", () => {
  const result = runGenerator();

  it.each(Object.keys(result.files))(
    "%s matches a fresh regeneration",
    (name) => {
      expect(result.files[name as keyof typeof result.files]).toBe(
        readFileSync(join(SEED_DIR, name), "utf8"),
      );
    },
  );

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
