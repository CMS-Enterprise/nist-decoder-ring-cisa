// Docs: prisma/generators/zt-overlay/README.md
/**
 * Transform: CISA's control mapping workbook → sources/zt-mapping/cisa-ztmm-mapping.csv.
 *
 * The workbook is read where it sits and never copied into the repository; its
 * path is the one argument. Writes:
 *
 *   sources/zt-mapping/cisa-ztmm-mapping.csv     every mapping row, canonical values beside the published ones
 *   sources/zt-mapping/cisa-ztmm-functions.csv   the sheet's own function-code table
 *   reports/zt-overlay/cisa-findings.csv         what in the source a person should look at
 *
 * Every control must exist in the catalog seed and every function must resolve
 * to a guidance group, or nothing is written. Deterministic: the same workbook
 * produces byte-identical files.
 *
 *   tsx prisma/generators/zt-overlay/transform.ts <path-to-workbook.xlsx>
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { seedControlId } from "../shared/control-identifier/canonical.js";
import { toCsv } from "../reference-links/lib/csv.js";
import {
  CSV_HEADER,
  SHEET_NAME,
  toCsvRow,
  transformSheet,
} from "./lib/cisa.js";
import { compareNumberLists, compareText } from "./lib/order.js";
import { REPORTS_DIR, SEED_DIR, SOURCES_DIR } from "./lib/paths.js";
import { groupKey, loadSeedContext, VERSION_TOKEN } from "./lib/seed.js";
import { readSheet } from "./lib/xlsx.js";

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: tsx prisma/generators/zt-overlay/transform.ts <path-to-workbook.xlsx>",
    );
    process.exit(2);
  }

  const sheet = readSheet(new Uint8Array(readFileSync(path)), SHEET_NAME);
  const { rows, extraColumns, functionCodes, findings } = transformSheet(sheet);
  const seed = loadSeedContext(SEED_DIR);

  const problems: string[] = [];
  for (const row of rows) {
    if (!seed.controlIds.has(seedControlId(row.controlId, VERSION_TOKEN))) {
      problems.push(
        `row ${row.sourceRow}: ${row.controlId} is not in the catalog seed`,
      );
    }
    if (!seed.guidanceGroups.has(groupKey(row.pillar, row.function))) {
      problems.push(
        `row ${row.sourceRow}: ${row.pillar} "${row.function}" is not a guidance group`,
      );
    }
  }
  if (problems.length) {
    console.error(
      `FAILED: ${problems.length} row(s) cannot be seeded:\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }

  mkdirSync(SOURCES_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(
    join(SOURCES_DIR, "cisa-ztmm-mapping.csv"),
    toCsv([...CSV_HEADER, ...extraColumns], rows.map(toCsvRow)),
  );
  writeFileSync(
    join(SOURCES_DIR, "cisa-ztmm-functions.csv"),
    toCsv(
      ["code", "name"],
      functionCodes.map((f) => [f.code, f.name]),
    ),
  );
  writeFileSync(
    join(REPORTS_DIR, "cisa-findings.csv"),
    toCsv(
      ["kind", "control_id", "source_rows", "detail"],
      [...findings]
        .sort(
          (a, b) =>
            compareText(a.kind, b.kind) || compareNumberLists(a.rows, b.rows),
        )
        .map((f) => [f.kind, f.controlId, f.rows.join(";"), f.detail]),
    ),
  );

  const controls = new Set(rows.map((r) => r.controlId)).size;
  const byKind = new Map<string, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  console.log(
    `Read ${rows.length} rows on ${controls} controls from "${SHEET_NAME}".`,
  );
  console.log(
    `  renamed functions: ${rows.filter((r) => r.functionTransform !== "as published").length} rows`,
  );
  console.log(`  function codes: ${functionCodes.length}`);
  console.log(`  findings: ${findings.length}`);
  for (const [kind, n] of [...byKind].sort()) console.log(`    ${kind}: ${n}`);
}

main();
