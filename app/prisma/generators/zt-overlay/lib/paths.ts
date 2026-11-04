// Docs: prisma/generators/zt-overlay/README.md
/**
 * Where the overlay's inputs and outputs live, under app/prisma/:
 *
 *   sources/zt-mapping/       the input tables (CISA's mapping, drops)
 *   reports/zt-overlay/       what each run reports (tuples, CISA findings)
 *   seed-sql/nist-800-53/     the seed this pipeline writes 09, 11 and 13 into
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRISMA = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const SOURCES_DIR = resolve(PRISMA, "sources/zt-mapping");
export const REPORTS_DIR = resolve(PRISMA, "reports/zt-overlay");
export const SEED_DIR = resolve(PRISMA, "seed-sql/nist-800-53");
