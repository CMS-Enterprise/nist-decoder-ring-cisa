// Docs: prisma/generators/reference-links/README.md
/**
 * Build: the offline step. Reads the pinned catalog, sources/reference-links/<corpus>/live.csv
 * and sources/reference-links/<corpus>/overrides.csv, resolves each resource to the URL the seed
 * carries, checks the gates, and writes:
 *
 *   ../seed-sql/<corpus>/10-reference-links.sql   the seed, with its provenance row
 *   reports/reference-links/<corpus>/registry.csv                 every resource: published, seeded, why
 *   reports/reference-links/<corpus>/redirects.md                 what the publisher would need to change
 *
 * Deterministic: the same three inputs produce byte-identical files.
 *
 *   tsx prisma/generators/reference-links/build.ts [--corpus nist-800-53] [--out-dir <dir>] [--reports-dir <dir>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExpectations,
  ExpectationError,
  formatExpectations,
} from "../catalog/expectations.js";
import { PIN } from "../catalog/fetch-inputs.js";
import { nistIdScheme } from "../catalog/sql-writer.js";
import type { OscalCatalog } from "../catalog/types.js";
import { collectControlReferences, parseBackMatter } from "./lib/catalog.js";
import { parseLiveResults } from "./lib/live-results.js";
import {
  checkedOnOf,
  parseOverrides,
  redirectReport,
  referenceExpectations,
  registryCsv,
  resolveReferences,
  seedRows,
} from "./lib/resolve.js";
import { writeReferenceLinksSql } from "./lib/sql.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = "NIST_SP-800-53_rev5_catalog-min.json";
const CATALOG = resolve(HERE, "../../sources/nist-800-53", CATALOG_FILE);
const PIN_URL = `https://github.com/usnistgov/oscal-content/tree/${PIN}/nist.gov/SP800-53/rev5/json`;
const KNOWN_CORPORA: ReadonlySet<string> = new Set(["nist-800-53"]);

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function main(): void {
  const corpus = option("corpus") ?? "nist-800-53";
  // The corpus names the catalog whose back-matter this reads and whose seed
  // folder receives the file. Only the NIST catalog is read here, so any other
  // name would write NIST links into another catalog's seed.
  if (!KNOWN_CORPORA.has(corpus)) {
    throw new Error(
      `Unknown corpus "${corpus}"; this pipeline reads the NIST catalog and knows ${[...KNOWN_CORPORA].join(", ")}`,
    );
  }
  const outputDir =
    option("out-dir") ?? resolve(HERE, "../../seed-sql", corpus);
  const dataDir = resolve(HERE, "../../sources/reference-links", corpus);
  const reportsDir =
    option("reports-dir") ??
    resolve(HERE, "../../reports/reference-links", corpus);

  console.log(`reference-links build: corpus ${corpus}`);
  console.log(`Output: ${outputDir}\n`);

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8")) as OscalCatalog;
  const meta = catalog.catalog.metadata;
  const scheme = nistIdScheme(meta.version);

  const backMatter = parseBackMatter(catalog);
  const refs = collectControlReferences(catalog, backMatter.resources);
  const liveRows = parseLiveResults(readOrEmpty(join(dataDir, "live.csv")));
  const overrides = parseOverrides(readOrEmpty(join(dataDir, "overrides.csv")));
  const resolved = resolveReferences(
    backMatter.resources,
    refs.references,
    liveRows,
    overrides,
  );
  const rows = seedRows(resolved, refs.references);
  const tally = (kind: string) =>
    resolved.filter((r) => r.resolution === kind).length;
  const manual = resolved.filter((r) =>
    r.reason.startsWith("needs a manual check"),
  ).length;
  const checkedOn = checkedOnOf(resolved);

  console.log(
    `  reference links     ${rows.length} on ${new Set(rows.map((r) => r.controlNumber)).size} live controls, ` +
      `from ${backMatter.resources.length} back-matter resources (${refs.onWithdrawn} links on withdrawn controls skipped)`,
  );
  console.log(
    `  resolution          catalog ${tally("catalog")}, redirect ${tally("redirect")}, override ${tally("override")}, not seeded ${tally("not-seeded")}; ${manual} flagged for a manual check`,
  );
  console.log(`  live check          ${checkedOn}`);

  const gates = referenceExpectations({
    resources: backMatter.resources,
    withoutLink: backMatter.withoutLink,
    references: refs.references,
    unresolved: refs.unresolved,
    unlabeled: refs.unlabeled,
    resolved,
    overrides,
    liveRows,
    rows,
  });
  console.log(`\n${formatExpectations("reference links", gates)}`);
  assertExpectations("reference links", gates);

  const stats = {
    resources: backMatter.resources.length,
    seededResources: new Set(rows.map((r) => r.resourceUuid)).size,
    notSeeded: tally("not-seeded"),
    relocated: rows.filter((r) => {
      const res = resolved.find((x) => x.resource.uuid === r.resourceUuid);
      return res !== undefined && res.resolution !== "catalog";
    }).length,
    manual,
  };
  const provenance = {
    id: `dsrc_reference-links_${corpus}`,
    name: `${corpus} reference links`,
    type: "reference-links",
    url: PIN_URL,
    checkedOn,
    description: `Reference links from the back-matter of NIST SP 800-53 Rev 5 (catalog version ${meta.version}) at oscal-content ${PIN.slice(0, 12)}: ${stats.resources} resources, ${stats.seededResources} seeded, ${stats.notSeeded} held out, ${stats.manual} flagged for a manual check; live check of ${checkedOn}.`,
    createdById: "system_nist_gov",
  };
  const note = `Source: ${CATALOG_FILE} @ oscal-content ${PIN.slice(0, 12)}; live results of ${checkedOn}`;

  mkdirSync(outputDir, { recursive: true });
  writeReferenceLinksSql(outputDir, rows, provenance, stats, scheme, note);
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "registry.csv"), registryCsv(resolved));
  writeFileSync(
    join(reportsDir, "redirects.md"),
    redirectReport(resolved, {
      title: `NIST SP 800-53 Rev 5, catalog version ${meta.version}`,
      basis: `the OSCAL catalog at pin ${PIN}`,
    }),
  );
  console.log(
    `\n  wrote 10-reference-links.sql, ${join(reportsDir, "registry.csv")}, ${join(reportsDir, "redirects.md")}`,
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
