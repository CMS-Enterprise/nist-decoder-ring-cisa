// Docs: prisma/generators/zt-reference-links/README.md
/**
 * The seed file: each document once as a ReferenceLink row, attached to every
 * control that cites it through a NistControlLink row with the authored order,
 * preceded by the DataSource row that records the retrieval and that every
 * document row points at. These are the two tables the Zero Trust pane reads, so
 * the pane needs no new shape.
 *
 * Ids, escaping and the control-id scheme come from the catalog generator so a
 * junction row keys to the same control row the generator wrote. The comments
 * carry no URL and no apostrophe, for the reason the catalog pipeline gives.
 *
 * Pure apart from the final write. Covered by sql.test.ts.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { controlId, esc, type IdScheme } from "../../catalog/sql-writer.js";
import type { ReferenceLinkRow } from "../../reference-links/lib/resolve.js";
import {
  provenanceUpsertSql,
  type Provenance,
} from "../../reference-links/lib/sql.js";
import { linkDomainOf } from "./sources.js";

export const SEED_FILE = "14-zt-reference-links.sql";

/** A document's row id is a hash of the URL it is seeded at, so the id and the
 *  unique url column agree. */
export function referenceLinkId(seededUrl: string): string {
  return `rlink_${createHash("sha1").update(seededUrl).digest("hex").slice(0, 16)}`;
}

export interface ZtReferenceLinkStats {
  /** Distinct documents in the sources table. */
  documents: number;
  /** Documents seeded by at least one row. */
  seededDocuments: number;
  /** Rows seeded at a URL other than the authored one. */
  relocated: number;
  /** Documents seeded as authored and flagged for a person to confirm. */
  manual: number;
}

export function ztReferenceLinksSql(
  rows: ReferenceLinkRow[],
  provenance: Provenance,
  stats: ZtReferenceLinkStats,
  scheme: IdScheme,
  corpus: string,
  note: string,
): string {
  const controls = new Set(rows.map((r) => r.controlNumber)).size;
  const documents = new Map<string, ReferenceLinkRow>();
  for (const r of rows) if (!documents.has(r.url)) documents.set(r.url, r);
  const documentLines = [...documents.values()]
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map(
      (r) =>
        `  (${esc(referenceLinkId(r.url))}, ${esc(r.url)}, ${esc(r.title)}, ${esc(r.description)}, ` +
        `${esc(linkDomainOf(r.url))}::"LinkDomain", 'GUIDANCE'::"ReferenceLinkType", ${esc(provenance.id)}, NOW(), NOW())`,
    );
  const junctionLines = rows.map(
    (r) =>
      `  (${esc(controlId(r.controlNumber, scheme.token))}, ${esc(referenceLinkId(r.url))}, ${r.displayOrder})`,
  );
  return (
    `-- ${SEED_FILE}\n-- ${note}\n` +
    `-- ${rows.length} reference links on ${controls} live controls, from ${stats.seededDocuments} of ${stats.documents} authored documents; live check of ${provenance.checkedOn}\n\n` +
    `-- Source: the Zero Trust references authored per control in sources/reference-links/${corpus}/sources.csv.\n` +
    `-- Each URL is the most current known location of the document: ${stats.relocated} rows carry a URL other\n` +
    `-- than the authored one, because the authored one redirects or is gone and a replacement was\n` +
    `-- verified (sources/reference-links/${corpus}/overrides.csv). The provenance of every row, the authored URL, the\n` +
    `-- live-check outcome and what was needed for the URL to be accurate, is in\n` +
    `-- reports/reference-links/${corpus}/registry.csv; the redirect report for the publisher is beside it.\n` +
    `-- Flagged for a manual check: ${stats.manual} documents whose host refuses scripted clients or serves an incomplete certificate chain.\n` +
    `-- A document is stored once and attached to each control that cites it, in the authored order.\n` +
    `-- The description column carries the citation; the domain names who publishes the document; every row is guidance.\n` +
    `-- The DataSource row records the retrieval; every document row points at it.\n` +
    provenanceUpsertSql(provenance) +
    "\n" +
    (rows.length > 0
      ? `INSERT INTO "ReferenceLink" ("id", "url", "title", "description", "domain", "linkType", "dataSourceId", "createdAt", "updatedAt")\nVALUES\n${documentLines.join(",\n")}\nON CONFLICT ("url") DO NOTHING;\n\n` +
        `INSERT INTO "NistControlLink" ("nistControlId", "linkId", "displayOrder")\nVALUES\n${junctionLines.join(",\n")}\nON CONFLICT ("nistControlId", "linkId") DO NOTHING;\n`
      : "-- No reference links.\n")
  );
}

export function writeZtReferenceLinksSql(
  outputDir: string,
  rows: ReferenceLinkRow[],
  provenance: Provenance,
  stats: ZtReferenceLinkStats,
  scheme: IdScheme,
  corpus: string,
  note: string,
): void {
  writeFileSync(
    join(outputDir, SEED_FILE),
    ztReferenceLinksSql(rows, provenance, stats, scheme, corpus, note),
  );
}
