import { FACETS } from "~/app/_components/decoder-ring/facetLabels";
import { controlHref } from "~/app/_components/decoder-ring/filterParams";
import { FACET_KEYS } from "~/app/_components/decoder-ring/filterPredicate";
import { normalizeControlId, splitControlId } from "~/lib/control-id";
import { LINE_FIELDS } from "./from-detail";
import { DATASET_LABELS, ENHANCEMENT_LABELS, FIELD_LABELS } from "./labels";
import type { ExportRecord } from "./record";
import { serializeExportSelection, type ExportSelection } from "./selection";
import { xml } from "./xml";

/**
 * What a file says about itself, beside the record: when it was built, by which version
 * of the app, from which selection, and where the app is. Kept out of the record, which
 * keys the cache and the ETag, so a rebuild of the same selection keeps its tag.
 */
export interface ExportMeta {
  exportedAt: Date;
  /** Null outside a Next build. */
  appVersion: string | null;
  /** The deployment's public address, without a trailing slash; null when it sets none. */
  appUrl: string | null;
  selection: ExportSelection;
}

/** "2026-11-09 14:05 UTC". */
export const exportedAtLabel = (at: Date): string =>
  `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;

// The name's filter part stops here; the full set is in the file.
const MAX_FILTER_NAME = 40;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Every spelling of a selection shares one cached file, so the file names it one way:
// picks as the catalog spells them, facet values in the filter bar's order, search in lower case.
const picksOf = (selection: ExportSelection) =>
  [...new Set(selection.pick.map((p) => normalizeControlId(p) ?? p))].sort();

function facetValues(
  key: (typeof FACET_KEYS)[number],
  selection: ExportSelection,
): string[] {
  const order = Object.keys(FACETS[key].labels);
  const rank = (v: string) => {
    const i = order.indexOf(v);
    return i < 0 ? order.length : i;
  };
  return [...new Set(selection[key])].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

const searchOf = (selection: ExportSelection) =>
  selection.q.trim().toLowerCase();

/** The selection, shortened for a file name: "optimal", "identity-data-account", "3-picked". */
export function selectionSlug(selection: ExportSelection): string {
  const picks = picksOf(selection);
  const parts = picks.length
    ? [`${picks.length}-picked`]
    : [
        ...FACET_KEYS.flatMap((key) => facetValues(key, selection).map(slug)),
        ...(searchOf(selection)
          ? [slug(searchOf(selection)).slice(0, 20)]
          : []),
      ];
  if (selection.enhancements === "without") parts.push("no-enhancements");
  if (selection.enhancements === "only") parts.push("enhancements-only");
  const kept: string[] = [];
  for (const part of parts.filter(Boolean)) {
    if ([...kept, part].join("-").length > MAX_FILTER_NAME) break;
    kept.push(part);
  }
  const left = parts.filter(Boolean).length - kept.length;
  return [...kept, ...(left ? [`and-${left}-more`] : [])].join("-");
}

/** "example-catalog-1.0-2026-11-09-optimal.xlsx": the catalog, the day and the selection. */
export function exportFileName(
  catalog: string,
  format: string,
  selection: ExportSelection,
  at: Date,
): string {
  const name = catalog.replace(/[^A-Za-z0-9.]+/g, "-").toLowerCase();
  const filters = selectionSlug(selection);
  return `${name}-${at.toISOString().slice(0, 10)}${filters ? `-${filters}` : ""}.${format}`;
}

/** The selection as lines a reader can check: each filter, the search, or the picks. */
export function selectionLines(selection: ExportSelection): string[] {
  const picks = picksOf(selection);
  if (picks.length) return [`Picked: ${picks.join(", ")}`];
  const lines = FACET_KEYS.flatMap((key) => {
    const values = facetValues(key, selection);
    if (!values.length) return [];
    const { name, labels } = FACETS[key];
    return [
      `${name}: ${values.map((v) => (labels as Record<string, string>)[v] ?? v).join(", ")}`,
    ];
  });
  const search = searchOf(selection);
  if (search) lines.push(`Search: "${search}"`);
  return lines.length ? lines : ["None: every control in the catalog"];
}

/** The export page with this selection, so a reader can rebuild or change the file. */
export const exportPageLink = (
  appUrl: string,
  selection: ExportSelection,
): string => `${appUrl}${serializeExportSelection("/export", selection)}`;

/** A control's page in the app; an enhancement opens on its tab. */
export function controlLink(appUrl: string, id: string): string {
  const { base, enhancement } = splitControlId(id);
  return `${appUrl}${controlHref(base, enhancement, "")}`;
}

/** What a built file says when the deployment gives no address to link to. */
export const NO_APP_URL =
  "This deployment sets no public address, so the file has no links to the app.";

/** One line of a file's About sheet or title page; `link` is a web address to open. */
export interface AboutRow {
  label: string;
  value: string;
  link?: string;
}

/** The About sheet's and the title page's rows, in order. */
export function aboutRows(record: ExportRecord, meta: ExportMeta): AboutRow[] {
  const { selection } = meta;
  const fields = record.fields.filter((f) => LINE_FIELDS.includes(f));
  const reopen = meta.appUrl ? exportPageLink(meta.appUrl, selection) : null;
  return [
    { label: "Exported", value: exportedAtLabel(meta.exportedAt) },
    { label: "App version", value: meta.appVersion ?? "Not recorded" },
    { label: "Catalog", value: record.catalog },
    { label: "Catalog version", value: record.catalogVersion },
    { label: "Filters and picks", value: selectionLines(selection).join("\n") },
    {
      label: "Enhancements",
      value: ENHANCEMENT_LABELS[selection.enhancements],
    },
    {
      label: "Data included",
      value: record.datasets.map((d) => DATASET_LABELS[d]).join(", ") || "None",
    },
    {
      label: "Fields included",
      value: fields.map((f) => FIELD_LABELS[f]).join(", ") || "None",
    },
    { label: "Controls", value: String(record.controls.length) },
    reopen
      ? { label: "Open this export in the app", value: reopen, link: reopen }
      : { label: "Open this export in the app", value: NO_APP_URL },
  ];
}

/** A package's document properties: its title, the catalog and version, and when it was built. */
export function corePropertiesXml(
  record: ExportRecord,
  meta: ExportMeta,
): string {
  const at = `${meta.exportedAt.toISOString().slice(0, 19)}Z`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(record.catalog)}</dc:title><dc:subject>${xml(`${record.catalog}, version ${record.catalogVersion}`)}</dc:subject><dc:language>en-US</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${at}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${at}</dcterms:modified></cp:coreProperties>`;
}
