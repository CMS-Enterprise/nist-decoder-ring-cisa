// Docs: prisma/generators/zt-overlay/README.md
/**
 * Generate: the Zero Trust overlay seed for the NIST SP 800-53 catalog.
 *
 * Reads cisa-ztmm-mapping.csv and intentional-drops.csv from sources/zt-mapping/,
 * checks them against the catalog seed, and writes 09-zt-mappings.sql,
 * 11-zt-part-coverage.sql and 13-zt-mapping-affinity.sql beside this script for
 * review, plus reports/zt-overlay/tuples.csv. With --write it writes the three
 * seed files into seed-sql/nist-800-53/ instead.
 *
 * Nothing is written unless every gate passes: the reconciliation (no input row
 * unaccounted for) and the declared expectations. Deterministic: the same inputs
 * produce byte-identical files.
 *
 *   tsx prisma/generators/zt-overlay/generate.ts [--write]
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatExpectations } from "../catalog/expectations.js";
import { REPORTS_DIR, SEED_DIR } from "./lib/paths.js";
import { runGenerator } from "./lib/run.js";

const HERE = dirname(fileURLToPath(import.meta.url));

try {
  const write = process.argv.includes("--write");
  const result = runGenerator();
  const outDir = write ? SEED_DIR : HERE;
  for (const [name, text] of Object.entries(result.files))
    writeFileSync(join(outDir, name), text);
  writeFileSync(join(REPORTS_DIR, "tuples.csv"), result.tuplesCsv);

  console.log(formatExpectations("Zero Trust overlay", result.expectations));
  console.log("");
  for (const line of result.summary) console.log(line);
  console.log(
    `\nWrote 09, 11 and 13 to ${outDir}${write ? "" : " for review; --write puts them in seed-sql/nist-800-53/"}.`,
  );
} catch (e) {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exit(1);
}
