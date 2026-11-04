/**
 * The seed file: one NistLink row per (control, resource), preceded by the
 * DataSource row that records the retrieval (which corpus, checked when,
 * against which pin) and that every link row points at, so re-running the
 * retrieval updates the date the application shows.
 *
 * Ids, escaping and the control-id scheme come from the NIST generator so a
 * link row keys to the same control row the generator wrote. The comments carry
 * no URL and no apostrophe on purpose: the seed collector in the link checker
 * pairs single quotes across the file, so a stray apostrophe in a comment
 * inverts every literal boundary after it, and a commented-out dead URL would
 * be checked as if it were seeded.
 *
 * Pure apart from the final write. Covered by sql.test.ts.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { controlId, esc, type IdScheme } from "../../catalog/sql-writer.js";
import type { ReferenceLinkRow } from "./resolve.js";

/** A reference link is one control citing one resource, so its id is the pair:
 *  the control's normalized number and the resource's uuid prefix. */
export function referenceLinkId(
  controlNumber: string,
  resourceUuid: string,
  token: string,
): string {
  const normalized = controlNumber
    .toLowerCase()
    .replace(/[()]/g, "_")
    .replace(/\s+/g, "_");
  return `nlink_${normalized}_${resourceUuid.slice(0, 8)}_${token}`;
}

/** The provenance row every link points at. One per corpus; upserted, so a
 *  re-seed after a new retrieval updates the date rather than adding a row. */
export interface Provenance {
  /** Stable id, e.g. "dsrc_reference-links_nist-800-53". */
  id: string;
  /** Unique name, e.g. "nist-800-53 reference links". */
  name: string;
  /** The DataSource type the API selects a pane's provenance by, one per
   *  corpus kind: "reference-links" for the catalog's own references,
   *  "zt-reference-links" for the Zero Trust pane. */
  type: string;
  /** Where the corpus was read from: the catalog at its pin, or the sources table. */
  url: string;
  /** The date of the live check, YYYY-MM-DD. */
  checkedOn: string;
  /** One sentence: pin and counts. */
  description: string;
  /** The seed user the row is attributed to. */
  createdById: string;
}

export interface ReferenceLinkStats {
  /** Back-matter resources carrying a URL. */
  resources: number;
  /** Resources seeded by at least one row. */
  seededResources: number;
  /** Resources held out because their URL is gone with no replacement known. */
  notSeeded: number;
  /** Rows seeded at a URL other than the one the catalog publishes. */
  relocated: number;
  /** Resources seeded as published and flagged for a person to confirm. */
  manual: number;
}

export function provenanceUpsertSql(p: Provenance): string {
  return (
    `INSERT INTO "DataSource" ("id", "name", "type", "url", "authorityLevel", "lastCrawled", "isActive", "description", "createdById", "createdAt", "updatedAt")\n` +
    `VALUES (${esc(p.id)}, ${esc(p.name)}, ${esc(p.type)}, ${esc(p.url)}, 'reference'::"AuthorityLevel", ${esc(p.checkedOn)}::timestamp, true, ${esc(p.description)}, ${esc(p.createdById)}, NOW(), NOW())\n` +
    `ON CONFLICT ("id") DO UPDATE SET "url" = EXCLUDED."url", "lastCrawled" = EXCLUDED."lastCrawled", "description" = EXCLUDED."description", "updatedAt" = NOW();\n`
  );
}

export function referenceLinksSql(
  rows: ReferenceLinkRow[],
  provenance: Provenance,
  stats: ReferenceLinkStats,
  scheme: IdScheme,
  note: string,
): string {
  const controls = new Set(rows.map((r) => r.controlNumber)).size;
  const lines = rows.map(
    (r) =>
      `  (${esc(referenceLinkId(r.controlNumber, r.resourceUuid, scheme.token))}, ` +
      `${esc(controlId(r.controlNumber, scheme.token))}, ${esc(r.title)}, ${esc(r.url)}, ` +
      `${esc(r.description)}, ${esc(r.resolvedUrl)}, ${esc(r.contentType)}, ${r.displayOrder}, ` +
      `${esc(provenance.id)}, NOW(), NOW())`,
  );
  return (
    `-- 10-reference-links.sql\n-- ${note}\n` +
    `-- ${rows.length} reference links on ${controls} live controls, from ${stats.seededResources} of ${stats.resources} back-matter resources; live check of ${provenance.checkedOn}\n\n` +
    `-- Source: the back-matter resources of the catalog, joined to the reference links of each control.\n` +
    `-- Each URL is the most current known location of the resource: ${stats.relocated} rows carry a URL other\n` +
    `-- than the one the catalog publishes, because the published one redirects or is gone and a\n` +
    `-- replacement was verified (sources/reference-links/nist-800-53/overrides.csv). The provenance of every row, the\n` +
    `-- published URL, the live-check outcome and what was needed for the URL to be accurate, is in\n` +
    `-- reports/reference-links/nist-800-53/registry.csv; the redirect report for the publisher is beside it.\n` +
    `-- Not seeded: ${stats.notSeeded} resources whose published URL is gone with no replacement known.\n` +
    `-- Flagged for a manual check: ${stats.manual} resources whose host refuses scripted clients or serves an incomplete certificate chain.\n` +
    `-- The description column carries the citation text from the catalog; resolvedUrl and contentType say what the link leads to.\n` +
    `-- The DataSource row records the retrieval; every link row points at it.\n` +
    provenanceUpsertSql(provenance) +
    "\n" +
    (lines.length > 0
      ? `INSERT INTO "NistLink" ("id", "nistControlId", "title", "url", "description", "resolvedUrl", "contentType", "displayOrder", "dataSourceId", "createdAt", "updatedAt")\nVALUES\n${lines.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`
      : "-- No reference links.\n")
  );
}

export function writeReferenceLinksSql(
  outputDir: string,
  rows: ReferenceLinkRow[],
  provenance: Provenance,
  stats: ReferenceLinkStats,
  scheme: IdScheme,
  note: string,
): void {
  writeFileSync(
    join(outputDir, "10-reference-links.sql"),
    referenceLinksSql(rows, provenance, stats, scheme, note),
  );
}
