// Docs: prisma/generators/zt-reference-links/README.md
/**
 * The sources table: the Zero Trust references authored per control, and how
 * its rows become what the shared resolver reads.
 *
 * A row names a control, a URL, the document's title, its citation and the
 * position among that control's references. A document is stored once, so the
 * same URL on several rows is one resource cited by several controls: the first
 * row's title and citation stand for it, and a later row that disagrees is a
 * gate failure rather than a silent overwrite. The resolver in the catalog's
 * own pipeline keys its work on a resource id and a control number and nothing
 * else, so the rows are handed to it in exactly that shape.
 */

import { createHash } from "node:crypto";
import type {
  ControlReference,
  ReferenceResource,
} from "../../reference-links/lib/catalog.js";
import { parseCsvRecords } from "../../reference-links/lib/csv.js";
import { urlDefect } from "../../reference-links/lib/resolve.js";

export const SOURCES_HEADER = [
  "control_number",
  "url",
  "title",
  "citation",
  "display_order",
] as const;

export interface SourceRow {
  /** The control as the catalog labels it: "AC-02", "AC-02(01)". */
  controlNumber: string;
  url: string;
  title: string;
  citation: string | null;
  /** 1-based position among the control's Zero Trust references. */
  displayOrder: number;
  /** 1-based line in the file, so a message can name the row. */
  line: number;
}

/** The table, one row per line after the header. The header must be exactly
 *  SOURCES_HEADER: a renamed column would otherwise read as empty everywhere. */
export function parseSources(text: string): SourceRow[] {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine !== SOURCES_HEADER.join(",")) {
    throw new Error(
      `sources.csv must start with the header ${SOURCES_HEADER.join(",")}; found "${firstLine}"`,
    );
  }
  return parseCsvRecords(text).map((r, i) => ({
    controlNumber: (r.control_number ?? "").trim(),
    url: (r.url ?? "").trim(),
    title: (r.title ?? "").trim(),
    citation: (r.citation ?? "").trim() || null,
    displayOrder: Number.parseInt(r.display_order ?? "", 10),
    line: i + 2,
  }));
}

/** The URL without its fragment: what a server is asked for. A `#page=N`
 *  anchor opens a page in a browser and is never sent, so two authored URLs
 *  that differ only by anchor are one request. */
export function withoutFragment(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** The distinct addresses to request, each with the authored URLs it stands
 *  for, in first-seen order. The live results are written per authored URL so
 *  the resolver, which looks a document up by its exact URL, finds every one. */
export function probeGroups(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    const key = withoutFragment(url);
    const list = groups.get(key) ?? [];
    if (!list.includes(url)) list.push(url);
    groups.set(key, list);
  }
  return groups;
}

/** A document's identity is its authored URL. */
export function resourceId(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/** One resource per distinct URL, in first-seen order; the first row's title
 *  and citation stand for the document. */
export function toResources(rows: SourceRow[]): ReferenceResource[] {
  const seen = new Map<string, ReferenceResource>();
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.set(row.url, {
      uuid: resourceId(row.url),
      title: row.title,
      citation: row.citation,
      url: row.url,
    });
  }
  return [...seen.values()];
}

/** One citation per row, keyed the way the resolver expects. */
export function toReferences(rows: SourceRow[]): ControlReference[] {
  return rows.map((r) => ({
    controlNumber: r.controlNumber,
    resourceUuid: resourceId(r.url),
    order: r.displayOrder,
  }));
}

export type LinkDomain = "NIST" | "FEDERAL" | "EXTERNAL";

/**
 * Who publishes a reference, by host: the catalog's own publisher, another
 * federal source, or anyone else. The enum reserves EXTERNAL for non-federal
 * references, so an executive-branch memo or a military standard is FEDERAL.
 */
export function linkDomainOf(url: string): LinkDomain {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "EXTERNAL";
  }
  if (host === "nist.gov" || host.endsWith(".nist.gov")) return "NIST";
  if (host.endsWith(".gov") || host.endsWith(".mil")) return "FEDERAL";
  return "EXTERNAL";
}

/** What is wrong with the table before any URL is resolved. Every list is
 *  empty for a well-authored table; each feeds one zero-ceiling gate. */
export interface SourceIssues {
  /** Control numbers the catalog does not carry live. */
  unknownControls: string[];
  /** "control url" pairs authored more than once. */
  duplicatePairs: string[];
  /** "control:order" for a display order that is not a positive integer or repeats within its control. */
  badOrders: string[];
  /** "line N" for a row with no title. */
  emptyTitles: string[];
  /** URLs authored with more than one title or citation. */
  conflictingDocuments: string[];
  /** Authored URLs with a format defect. */
  urlDefects: string[];
}

export function sourceIssues(
  rows: SourceRow[],
  liveControls: ReadonlySet<string>,
): SourceIssues {
  const unique = (xs: string[]) => [...new Set(xs)];

  const pairCounts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.controlNumber} ${r.url}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  const badOrders: string[] = [];
  const ordersByControl = new Map<string, Set<number>>();
  for (const r of rows) {
    const bad =
      !Number.isInteger(r.displayOrder) ||
      r.displayOrder < 1 ||
      ordersByControl.get(r.controlNumber)?.has(r.displayOrder);
    if (bad) badOrders.push(`${r.controlNumber}:${String(r.displayOrder)}`);
    if (!ordersByControl.has(r.controlNumber))
      ordersByControl.set(r.controlNumber, new Set());
    ordersByControl.get(r.controlNumber)!.add(r.displayOrder);
  }

  const documents = new Map<
    string,
    { title: string; citation: string | null }
  >();
  const conflicting: string[] = [];
  for (const r of rows) {
    const first = documents.get(r.url);
    if (!first) {
      documents.set(r.url, { title: r.title, citation: r.citation });
    } else if (first.title !== r.title || first.citation !== r.citation) {
      conflicting.push(r.url);
    }
  }

  return {
    unknownControls: unique(
      rows
        .filter((r) => !liveControls.has(r.controlNumber))
        .map((r) => r.controlNumber),
    ),
    duplicatePairs: [...pairCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key]) => key),
    badOrders: unique(badOrders),
    emptyTitles: rows
      .filter((r) => r.title === "")
      .map((r) => `line ${r.line}`),
    conflictingDocuments: unique(conflicting),
    urlDefects: unique(
      [...documents.keys()].filter((url) => Boolean(urlDefect(url))),
    ),
  };
}

/** The registry's columns for this corpus: the resource is a document
 *  identified by a hash of its authored URL, not a catalog uuid. */
export const ZT_REGISTRY_HEADER = [
  "resource_id",
  "title",
  "citation",
  "source_url",
  "seeded_url",
  "resolved_url",
  "content_type",
  "resolution",
  "reason",
  "live_status",
  "live_class",
  "checked_on",
  "override_verified_on",
  "citing_controls_count",
  "citing_controls",
] as const;
