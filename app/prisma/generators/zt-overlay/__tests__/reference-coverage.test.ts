/**
 * Every control CISA's mapping covers carries at least one Zero Trust reference,
 * and no reference sits on a control the mapping leaves out.
 *
 * The overlay's tuple report is the mapping as seeded; the sources table is the
 * references as authored. Coverage is per control: a control CISA gives several
 * functions needs one reference, not one per function.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseCsvRecords } from "../../reference-links/lib/csv.js";

const PRISMA = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string) =>
  parseCsvRecords(readFileSync(join(PRISMA, path), "utf8"));

describe("Zero Trust reference coverage", () => {
  const mapped = new Set(
    read("reports/zt-overlay/tuples.csv")
      .filter((t) => t.outcome !== "dropped")
      .map((t) => t.control_id),
  );
  const referenced = new Set(
    read("sources/reference-links/cisa/sources.csv").map(
      (r) => r.control_number,
    ),
  );

  it("reads both tables", () => {
    expect(mapped.size).toBeGreaterThan(300);
    expect(referenced.size).toBeGreaterThan(0);
  });

  it("gives every control CISA maps at least one reference", () => {
    expect([...mapped].filter((c) => !referenced.has(c)).sort()).toEqual([]);
  });

  it("cites no control the mapping leaves out", () => {
    expect([...referenced].filter((c) => !mapped.has(c)).sort()).toEqual([]);
  });

  // The hand-maintained files attach by the control id the catalog seeds
  // (ctrl_ac-03_07__r520), so read every such literal and map it back.
  const seedDir = join(PRISMA, "seed-sql/nist-800-53");
  const handFiles = readdirSync(seedDir).filter((f) =>
    /^\d+-zt-references-[a-z]+\.sql$/.test(f),
  );
  const controlsIn = (file: string) =>
    [
      ...readFileSync(join(seedDir, file), "utf8").matchAll(
        /'ctrl_([a-z]{2})-(\d{2})(?:_(\d{2})_)?_r520'/g,
      ),
    ].map(
      ([, fam, num, enh]) =>
        `${fam!.toUpperCase()}-${num}${enh ? `(${enh})` : ""}`,
    );
  const handControls = new Set(handFiles.flatMap(controlsIn));

  it("reads the hand-maintained reference files, each attaching at least one control", () => {
    expect(handFiles.length).toBeGreaterThan(0);
    for (const file of handFiles)
      expect(controlsIn(file), file).not.toEqual([]);
  });

  it("attaches hand-maintained references only to controls the mapping covers", () => {
    expect([...handControls].filter((c) => !mapped.has(c)).sort()).toEqual([]);
  });
});
