// Docs: prisma/generators/reference-links/README.md
/**
 * Retrieve: the network step. Reads every back-matter URL from the pinned
 * catalog and every replacement in the override table (so a replacement is
 * verified on every refresh, not only the day it was added), requests each
 * distinct one once through the link checker's probe
 * (a one-byte range GET, redirects followed, outcome classified), and writes
 * sources/reference-links/<corpus>/live.csv with the status, the final URL, the media type, the
 * class and the date. Commit the file: git history is the log of every pull,
 * and build.ts reads it without touching the network.
 *
 *   tsx prisma/generators/reference-links/retrieve.ts [--corpus nist-800-53]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { probeAll, reportLive } from "../../../scripts/check-links/report.js";
import { dedupeByUrl } from "../../../scripts/check-links/results.js";
import type { OscalCatalog } from "../catalog/types.js";
import { extractCatalogUrls } from "./lib/catalog.js";
import { todayUtc, toLiveResultsCsv } from "./lib/live-results.js";
import { parseOverrides } from "./lib/resolve.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = resolve(
  HERE,
  "../../sources/nist-800-53/NIST_SP-800-53_rev5_catalog-min.json",
);

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const corpus = option("corpus") ?? "nist-800-53";
  const outDir = resolve(HERE, "../../sources/reference-links", corpus);
  const outFile = join(outDir, "live.csv");

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8")) as OscalCatalog;
  const records = extractCatalogUrls(catalog);
  if (records.length === 0)
    throw new Error(`No back-matter links in ${CATALOG}`);
  const overridesFile = join(outDir, "overrides.csv");
  const overrides = existsSync(overridesFile)
    ? parseOverrides(readFileSync(overridesFile, "utf8"))
    : [];
  for (const o of overrides) {
    records.push({
      id: o.sourceUrl,
      source: "override",
      url: o.replacementUrl,
    });
  }
  console.log(`reference-links retrieve: corpus ${corpus}`);
  console.log(
    `  ${records.length - overrides.length} resource links in the catalog back-matter, ${overrides.length} replacement(s) in the override table`,
  );

  const { distinct, expand } = dedupeByUrl(records);
  const results = expand(await probeAll(distinct));
  reportLive(results);

  const csv = toLiveResultsCsv(results, todayUtc());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, csv);
  console.log(`\n  wrote ${distinct.length} distinct URL(s) to ${outFile}`);
  console.log(
    `  next: review the diff, then tsx prisma/generators/reference-links/build.ts`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
