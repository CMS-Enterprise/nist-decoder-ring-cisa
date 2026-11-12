// Docs: prisma/generators/zt-reference-links/README.md
/**
 * Build: the offline step. Reads sources/reference-links/<corpus>/sources.csv, live.csv and
 * overrides.csv, validates each control number against the pinned catalog,
 * resolves each document to the URL the seed carries, checks the gates, and
 * writes:
 *
 *   ../seed-sql/<catalog>/14-zt-reference-links.sql   the seed, with its provenance row
 *   reports/reference-links/<corpus>/registry.csv                     every document: authored, seeded, why
 *   reports/reference-links/<corpus>/redirects.md                     what the publisher would need to change
 *
 * Deterministic: the same four inputs produce byte-identical files.
 *
 *   tsx prisma/generators/zt-reference-links/build.ts [--corpus cisa] [--catalog nist-800-53] [--out-dir <dir>] [--reports-dir <dir>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExpectations,
  ExpectationError,
  formatExpectations,
} from "../catalog/expectations.js";
import { nistIdScheme } from "../catalog/sql-writer.js";
import type { OscalCatalog } from "../catalog/types.js";
import { liveControlNumbers } from "../reference-links/lib/catalog.js";
import { parseLiveResults } from "../reference-links/lib/live-results.js";
import {
  checkedOnOf,
  parseOverrides,
  redirectReport,
  registryCsv,
  resolveReferences,
  seedRows,
} from "../reference-links/lib/resolve.js";
import { ztReferenceExpectations } from "./lib/gates.js";
import {
  parseSources,
  sourceIssues,
  toReferences,
  toResources,
  ZT_REGISTRY_HEADER,
} from "./lib/sources.js";
import { SEED_FILE, writeZtReferenceLinksSql } from "./lib/sql.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = "NIST_SP-800-53_rev5_catalog-min.json";
const CATALOG = resolve(HERE, "../../sources/nist-800-53", CATALOG_FILE);

/** What each corpus is, for the provenance row and the report heading. */
const CORPORA: Record<
  string,
  { home: string; describe: string; title: string }
> = {
  cisa: {
    home: "https://www.cisa.gov/zero-trust-maturity-model",
    describe:
      "the CISA Zero Trust Maturity Model and the guidance CISA publishes around it",
    title: "the Zero Trust references from CISA",
  },
};

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readOrEmpty(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function main(): void {
  const corpus = option("corpus") ?? "cisa";
  const catalogDir = option("catalog") ?? "nist-800-53";
  const outputDir =
    option("out-dir") ?? resolve(HERE, "../../seed-sql", catalogDir);
  const dataDir = resolve(HERE, "../../sources/reference-links", corpus);
  const reportsDir =
    option("reports-dir") ??
    resolve(HERE, "../../reports/reference-links", corpus);
  const about = CORPORA[corpus];
  if (!about) {
    throw new Error(
      `Unknown corpus "${corpus}"; the known ones are ${Object.keys(CORPORA).join(", ")}`,
    );
  }

  console.log(`zt-reference-links build: corpus ${corpus}`);
  console.log(`Output: ${outputDir}\n`);

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8")) as OscalCatalog;
  const scheme = nistIdScheme(catalog.catalog.metadata.version);
  const liveControls = liveControlNumbers(catalog);

  const sourcesFile = join(dataDir, "sources.csv");
  if (!existsSync(sourcesFile))
    throw new Error(`No sources table at ${sourcesFile}`);
  const rows = parseSources(readFileSync(sourcesFile, "utf8"));
  const resources = toResources(rows);
  const references = toReferences(rows);
  const issues = sourceIssues(rows, liveControls);
  const liveRows = parseLiveResults(readOrEmpty(join(dataDir, "live.csv")));
  const overrides = parseOverrides(readOrEmpty(join(dataDir, "overrides.csv")));
  const resolved = resolveReferences(
    resources,
    references,
    liveRows,
    overrides,
  );
  const seeded = seedRows(resolved, references);
  const tally = (kind: string) =>
    resolved.filter((r) => r.resolution === kind).length;
  const manual = resolved.filter((r) =>
    r.reason.startsWith("needs a manual check"),
  ).length;
  const checkedOn = checkedOnOf(resolved);
  const controls = new Set(rows.map((r) => r.controlNumber)).size;

  console.log(
    `  reference links     ${seeded.length} on ${new Set(seeded.map((r) => r.controlNumber)).size} live controls, ` +
      `from ${resources.length} authored documents on ${controls} controls`,
  );
  console.log(
    `  resolution          as authored ${tally("catalog")}, redirect ${tally("redirect")}, override ${tally("override")}, not seeded ${tally("not-seeded")}; ${manual} flagged for a manual check`,
  );
  console.log(`  live check          ${checkedOn}`);

  const gates = ztReferenceExpectations({
    rows,
    resources,
    references,
    issues,
    resolved,
    overrides,
    liveRows,
    seeded,
  });
  console.log(`\n${formatExpectations("zt reference links", gates)}`);
  assertExpectations("zt reference links", gates);

  const stats = {
    documents: resources.length,
    seededDocuments: new Set(seeded.map((r) => r.url)).size,
    relocated: seeded.filter((r) => {
      const res = resolved.find((x) => x.resource.uuid === r.resourceUuid);
      return res !== undefined && res.resolution !== "catalog";
    }).length,
    manual,
  };
  const provenance = {
    id: `dsrc_zt-reference-links_${corpus}`,
    name: `${corpus} zt reference links`,
    type: "zt-reference-links",
    url: about.home,
    checkedOn,
    description: `Zero Trust references authored per control from ${about.describe}: ${stats.documents} documents, ${seeded.length} links on ${controls} controls, ${stats.manual} flagged for a manual check; live check of ${checkedOn}.`,
    createdById: "system_nist_gov",
  };
  const note = `Source: sources/reference-links/${corpus}/sources.csv, ${rows.length} rows on ${controls} controls; live results of ${checkedOn}`;

  mkdirSync(outputDir, { recursive: true });
  writeZtReferenceLinksSql(
    outputDir,
    seeded,
    provenance,
    stats,
    scheme,
    corpus,
    note,
  );
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, "registry.csv"),
    registryCsv(resolved, ZT_REGISTRY_HEADER),
  );
  writeFileSync(
    join(reportsDir, "redirects.md"),
    redirectReport(resolved, {
      title: about.title,
      basis: `the sources table sources/reference-links/${corpus}/sources.csv`,
    }),
  );
  console.log(
    `\n  wrote ${SEED_FILE}, ${join(reportsDir, "registry.csv")}, ${join(reportsDir, "redirects.md")}`,
  );
  console.log(`\nDone.`);
}

try {
  main();
} catch (err: unknown) {
  if (err instanceof ExpectationError) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
  throw err;
}
