// Docs: prisma/generators/zt-reference-links/README.md
/**
 * Retrieve: the network step. Reads every URL in the sources table and every
 * replacement in the override table (so a replacement is verified on every
 * refresh, not only the day it was added), requests each distinct address once
 * through the link checker's probe (a one-byte range GET, redirects followed,
 * outcome classified), and writes sources/reference-links/<corpus>/live.csv with the status, the
 * final URL, the media type, the class and the date. Authored URLs that differ
 * only by a page anchor are one request and one row each. Commit the file: git
 * history is the log of every pull, and build.ts reads it without touching
 * the network.
 *
 *   tsx prisma/generators/zt-reference-links/retrieve.ts [--corpus cisa]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { probeAll, reportLive } from "../../../scripts/check-links/report.js";
import { dedupeByUrl } from "../../../scripts/check-links/results.js";
import {
  todayUtc,
  toLiveResultsCsv,
} from "../reference-links/lib/live-results.js";
import { parseOverrides } from "../reference-links/lib/resolve.js";
import { parseSources, probeGroups } from "./lib/sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const corpus = option("corpus") ?? "cisa";
  const dataDir = resolve(HERE, "../../sources/reference-links", corpus);
  const sourcesFile = join(dataDir, "sources.csv");
  const outFile = join(dataDir, "live.csv");

  if (!existsSync(sourcesFile))
    throw new Error(`No sources table at ${sourcesFile}`);
  const rows = parseSources(readFileSync(sourcesFile, "utf8"));
  if (rows.length === 0) throw new Error(`No rows in ${sourcesFile}`);
  const overridesFile = join(dataDir, "overrides.csv");
  const overrides = existsSync(overridesFile)
    ? parseOverrides(readFileSync(overridesFile, "utf8"))
    : [];
  const groups = probeGroups([
    ...rows.map((r) => r.url),
    ...overrides.map((o) => o.replacementUrl),
  ]);
  const records = [...groups.keys()].map((url) => ({
    id: url,
    source: "sources",
    url,
  }));
  console.log(`zt-reference-links retrieve: corpus ${corpus}`);
  console.log(
    `  ${rows.length} authored rows in the sources table, ${overrides.length} replacement(s) in the override table, ${records.length} distinct address(es)`,
  );

  const { distinct, expand } = dedupeByUrl(records);
  const probed = expand(await probeAll(distinct));
  reportLive(probed);
  // One live row per authored URL, anchors included, from the one request its
  // address received.
  const results = probed.flatMap((result) =>
    (groups.get(result.record.url) ?? [result.record.url]).map((url) => ({
      ...result,
      record: { ...result.record, url },
    })),
  );

  const csv = toLiveResultsCsv(results, todayUtc());
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(outFile, csv);
  console.log(`\n  wrote ${distinct.length} distinct URL(s) to ${outFile}`);
  console.log(
    `  next: review the diff, then tsx prisma/generators/zt-reference-links/build.ts`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
