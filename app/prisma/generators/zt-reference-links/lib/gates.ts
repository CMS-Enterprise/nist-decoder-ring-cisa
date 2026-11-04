// Docs: prisma/generators/zt-reference-links/README.md
/**
 * The gates the build writes nothing without, in the catalog generator's
 * style: floors measured at the current authoring and ratcheted by hand, and
 * zero-ceilings, each with its reason, for the ways a hand-authored table goes
 * wrong. A document whose address is gone is a row to fix or override, never a
 * resource to hold out, so nothing is allowed to be not seeded.
 */

import type { Expectation } from "../../catalog/expectations.js";
import type {
  ControlReference,
  ReferenceResource,
} from "../../reference-links/lib/catalog.js";
import type { LiveResultRow } from "../../reference-links/lib/live-results.js";
import {
  urlDefect,
  type OverrideRow,
  type ReferenceLinkRow,
  type ResolvedReference,
} from "../../reference-links/lib/resolve.js";
import type { SourceIssues, SourceRow } from "./sources.js";

/** Measured at the current authoring. Raise when rows are added; never lower
 *  without saying why in the commit. The control floor is every control CISA's
 *  mapping covers: each carries at least the maturity model's page for each
 *  function CISA gives it. */
export const ZT_FLOORS = { rows: 604, controls: 345 } as const;

const withoutFragment = (url: string): string => url.split("#", 1)[0]!;

export function ztReferenceExpectations(input: {
  rows: SourceRow[];
  resources: ReferenceResource[];
  references: ControlReference[];
  issues: SourceIssues;
  resolved: ResolvedReference[];
  overrides: OverrideRow[];
  liveRows: LiveResultRow[];
  seeded: ReferenceLinkRow[];
  floors?: { rows: number; controls: number };
}): Expectation[] {
  const floors = input.floors ?? ZT_FLOORS;
  const liveUrls = new Set(input.liveRows.map((l) => withoutFragment(l.url)));
  const liveClass = new Map(
    input.liveRows.map((l) => [withoutFragment(l.url), l.linkClass]),
  );
  const authoredUrls = new Set(input.resources.map((r) => r.url));
  const controls = new Set(input.rows.map((r) => r.controlNumber)).size;
  const withoutLive = input.resources.filter(
    (r) => !liveUrls.has(withoutFragment(r.url)),
  );
  const deadReplacements = input.overrides.filter((o) => {
    const cls = liveClass.get(withoutFragment(o.replacementUrl));
    return cls === undefined || cls === "gone" || cls === "unreachable";
  });
  const notSeeded = input.resolved.filter((r) => r.seededUrl === null);
  // Two authored documents landing on one seeded URL would be stored as one
  // document, and the junction's conflict clause would drop every row but the
  // first without a word. A page anchor lost on a redirect is how it happens.
  const documentsByUrl = new Map<string, Set<string>>();
  for (const r of input.seeded) {
    const ids = documentsByUrl.get(r.url) ?? new Set<string>();
    ids.add(r.resourceUuid);
    documentsByUrl.set(r.url, ids);
  }
  const sharedUrls = [...documentsByUrl.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([url]) => url);
  const name = (xs: string[]) =>
    xs.length ? `: ${xs.slice(0, 10).join(", ")}` : "";

  return [
    { name: "authored rows", actual: input.rows.length, floor: floors.rows },
    {
      name: "controls with a reference",
      actual: controls,
      floor: floors.controls,
    },
    {
      name: "rows naming a control not live in the catalog",
      actual: input.issues.unknownControls.length,
      floor: 0,
      ceiling: 0,
      because: `a link joins to a live control row by its number${name(input.issues.unknownControls)}`,
    },
    {
      name: "duplicate (control, url) rows",
      actual: input.issues.duplicatePairs.length,
      floor: 0,
      ceiling: 0,
      because: `one junction row per pair${name(input.issues.duplicatePairs)}`,
    },
    {
      name: "display orders repeated or not positive within a control",
      actual: input.issues.badOrders.length,
      floor: 0,
      ceiling: 0,
      because: `the order is what the pane renders by${name(input.issues.badOrders)}`,
    },
    {
      name: "rows with an empty title",
      actual: input.issues.emptyTitles.length,
      floor: 0,
      ceiling: 0,
      because: `the title is the entry${name(input.issues.emptyTitles)}`,
    },
    {
      name: "URLs authored with more than one title or citation",
      actual: input.issues.conflictingDocuments.length,
      floor: 0,
      ceiling: 0,
      because: `a document is stored once${name(input.issues.conflictingDocuments)}`,
    },
    {
      name: "authored URLs with a format defect",
      actual: input.issues.urlDefects.length,
      floor: 0,
      ceiling: 0,
      because: `a malformed URL cannot be probed or served${name(input.issues.urlDefects)}`,
    },
    {
      name: "authored URLs without a live result",
      actual: withoutLive.length,
      floor: 0,
      ceiling: 0,
      because: `run make zt-reference-links-retrieve${name(withoutLive.map((r) => r.url))}`,
    },
    {
      name: "overrides whose source is not an authored URL",
      actual: input.overrides.filter((o) => !authoredUrls.has(o.sourceUrl))
        .length,
      floor: 0,
      ceiling: 0,
      because: "an override that replaces nothing is stale",
    },
    {
      name: "override replacements gone or unreachable",
      actual: deadReplacements.length,
      floor: 0,
      ceiling: 0,
      because: `a replacement is verified on every retrieval${name(deadReplacements.map((o) => o.replacementUrl))}`,
    },
    {
      name: "documents not seeded",
      actual: notSeeded.length,
      floor: 0,
      ceiling: 0,
      because: `an authored address that is gone is a row to fix or override${name(notSeeded.map((r) => r.resource.url))}`,
    },
    {
      name: "seeded reference links",
      actual: input.seeded.length,
      floor: floors.rows,
    },
    {
      name: "authored documents resolving to one seeded URL",
      actual: sharedUrls.length,
      floor: 0,
      ceiling: 0,
      because: `a document is stored once, so two authored documents on one URL would silently become one${name(sharedUrls)}`,
    },
    {
      name: "seeded URLs with a format defect",
      actual: input.seeded.filter((r) => Boolean(urlDefect(r.url))).length,
      floor: 0,
      ceiling: 0,
      because: "the format gate would refuse the seed",
    },
  ];
}
