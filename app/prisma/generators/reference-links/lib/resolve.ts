/**
 * Which URL the seed carries for each resource, and why.
 *
 * The catalog is pinned, so its URLs age: at the current pin one resource in
 * twenty is dead or has moved, OMB A-130 among them, the most cited resource
 * of all. The rule, in order: an override wins; a URL that redirects is seeded
 * at its final URL, except a DOI, whose whole point is to be the stable name; a
 * URL a script cannot verify (a blocked client, a certificate chain) is seeded
 * as published and listed for a manual check; a URL that is gone with no
 * replacement is not seeded, so every seeded URL passes the live check, and it
 * stays in the redirect report until a replacement is found.
 *
 * Pure. Covered by resolve.test.ts.
 */

import type { Expectation } from "../../catalog/expectations.js";
import type { ControlReference, ReferenceResource } from "./catalog.js";
import { parseCsvRecords, toCsv } from "./csv.js";
import type { LiveResultRow } from "./live-results.js";

export interface OverrideRow {
  sourceUrl: string;
  replacementUrl: string;
  reason: string;
  verifiedOn: string;
}

export function parseOverrides(text: string): OverrideRow[] {
  return parseCsvRecords(text).map((r) => ({
    sourceUrl: r.source_url ?? "",
    replacementUrl: r.replacement_url ?? "",
    reason: r.reason ?? "",
    verifiedOn: r.verified_on ?? "",
  }));
}

export type Resolution = "catalog" | "redirect" | "override" | "not-seeded";

export interface ResolvedReference {
  resource: ReferenceResource;
  /** The URL the seed carries, or null when the reference is not seeded. */
  seededUrl: string | null;
  /** Where the seeded URL ends up after redirects, when known. */
  resolvedUrl: string | null;
  /** Media type of the destination, when the live check saw one. */
  contentType: string | null;
  resolution: Resolution;
  /** What was needed for the URL to be accurate, in words. */
  reason: string;
  live: LiveResultRow | null;
  override: OverrideRow | null;
  /** Control numbers citing the resource, in catalog order, live controls only. */
  citingControls: string[];
}

const DOI_HOSTS = new Set(["doi.org", "dx.doi.org", "www.doi.org"]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripFragment(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** The address a server is asked for, in the one spelling the URL parser
 *  gives it: host lower-cased, a default port dropped, an empty path written
 *  as "/", no fragment. Two spellings of one address are not a redirect. */
function canonicalAddress(url: string): string {
  const bare = stripFragment(url);
  try {
    return new URL(bare).href;
  } catch {
    return bare;
  }
}

/** A fragment names a place inside a document and is never sent to the
 *  server, so when the document moves the place moves with it: the authored
 *  fragment is carried onto the redirect's target when the target has none. */
function withFragmentOf(authored: string, target: string): string {
  const i = authored.indexOf("#");
  if (i === -1 || target.includes("#")) return target;
  return target + authored.slice(i);
}

/** The static shape a seeded URL must have: one http(s) scheme, no whitespace,
 *  no quote (the seed collector reads single-quoted literals), and it parses. */
export function urlDefect(url: string): string | null {
  if (url === "") return "empty";
  if (/\s/.test(url)) return "whitespace";
  if (url.includes("'")) return "single quote";
  if (/^https?:\/\/.*https?:\/\//i.test(url)) return "double scheme";
  if (!/^https?:\/\//i.test(url)) return "not http(s)";
  try {
    if (new URL(url).hostname === "") return "no host";
  } catch {
    return "malformed";
  }
  return null;
}

export function resolveReferences(
  resources: ReferenceResource[],
  references: ControlReference[],
  liveRows: LiveResultRow[],
  overrides: OverrideRow[],
): ResolvedReference[] {
  const live = new Map(liveRows.map((r) => [r.url, r]));
  const override = new Map(overrides.map((o) => [o.sourceUrl, o]));
  const citing = new Map<string, string[]>();
  for (const ref of references) {
    const list = citing.get(ref.resourceUuid) ?? [];
    list.push(ref.controlNumber);
    citing.set(ref.resourceUuid, list);
  }

  return resources.map((resource) => {
    const url = resource.url;
    const o = override.get(url) ?? null;
    const l = live.get(url) ?? null;
    // A media type is only meaningful from a page that answered; a 404 page
    // has one too, and it says nothing about the document that used to be there.
    const base = {
      resource,
      live: l,
      override: o,
      contentType: l?.linkClass === "reachable" ? l.contentType : null,
      citingControls: citing.get(resource.uuid) ?? [],
    };

    if (o) {
      // The replacement is probed by the retrieval like any catalog URL, so its
      // destination and media type are recorded and it is re-verified each refresh.
      const r = live.get(o.replacementUrl) ?? null;
      return {
        ...base,
        seededUrl: o.replacementUrl,
        resolvedUrl: r?.finalUrl ?? o.replacementUrl,
        contentType: r?.linkClass === "reachable" ? r.contentType : null,
        resolution: "override",
        reason: o.reason,
      };
    }
    if (!l) {
      return {
        ...base,
        seededUrl: null,
        resolvedUrl: null,
        resolution: "not-seeded",
        reason: "no live result for this URL; run the retrieval",
      };
    }
    switch (l.linkClass) {
      case "reachable": {
        const final = l.finalUrl;
        const host = hostOf(url);
        const moved =
          final !== null && canonicalAddress(final) !== canonicalAddress(url);
        if (moved && host !== null && !DOI_HOSTS.has(host)) {
          return {
            ...base,
            seededUrl: withFragmentOf(url, final),
            resolvedUrl: final,
            resolution: "redirect",
            reason: `catalog URL redirects (HTTP ${l.status ?? "?"}) to its current location`,
          };
        }
        return {
          ...base,
          seededUrl: url,
          resolvedUrl: final ?? url,
          resolution: "catalog",
          reason: moved
            ? `verified live on ${l.checkedOn}; a DOI is kept as the stable name even though it resolves elsewhere`
            : `verified live on ${l.checkedOn}`,
        };
      }
      case "script-blocked":
        // The page that answered was a sign-in or block page, not the document,
        // so it is no more the destination than a 404 page would be.
        return {
          ...base,
          seededUrl: url,
          resolvedUrl: null,
          resolution: "catalog",
          reason: `needs a manual check: the host refuses scripted clients (${l.error ?? `HTTP ${l.status ?? "?"}`})`,
        };
      case "tls-chain":
        return {
          ...base,
          seededUrl: url,
          resolvedUrl: null,
          resolution: "catalog",
          reason:
            `needs a manual check: the host serves an incomplete certificate chain (${l.error ?? ""})`.replace(
              " ()",
              "",
            ),
        };
      case "gone":
        return {
          ...base,
          seededUrl: null,
          resolvedUrl: null,
          resolution: "not-seeded",
          reason: `catalog URL is gone (HTTP ${l.status ?? "?"}) and no replacement is known`,
        };
      default:
        return {
          ...base,
          seededUrl: null,
          resolvedUrl: null,
          resolution: "not-seeded",
          reason: `catalog URL was unreachable on ${l.checkedOn} (${l.error ?? `HTTP ${l.status ?? "?"}`})`,
        };
    }
  });
}

// ---- what the writer emits ----------------------------------------------------

export interface ReferenceLinkRow {
  controlNumber: string;
  resourceUuid: string;
  title: string;
  url: string;
  /** The citation text, kept as the link's description. */
  description: string | null;
  /** Where the URL ends up after redirects, when known. */
  resolvedUrl: string | null;
  /** Media type of the destination, when known. */
  contentType: string | null;
  displayOrder: number;
}

/** One row per (control, resource) for every seeded resource, in citation order. */
export function seedRows(
  resolved: ResolvedReference[],
  references: ControlReference[],
): ReferenceLinkRow[] {
  const byUuid = new Map(resolved.map((r) => [r.resource.uuid, r]));
  const rows: ReferenceLinkRow[] = [];
  for (const ref of references) {
    const r = byUuid.get(ref.resourceUuid);
    const url = r?.seededUrl;
    if (r === undefined || url === null || url === undefined) continue;
    rows.push({
      controlNumber: ref.controlNumber,
      resourceUuid: ref.resourceUuid,
      title: r.resource.title,
      url,
      description: r.resource.citation,
      resolvedUrl: r.resolvedUrl,
      contentType: r.contentType,
      displayOrder: ref.order,
    });
  }
  return rows;
}

// ---- gates ----------------------------------------------------------------------

export function referenceExpectations(input: {
  resources: ReferenceResource[];
  withoutLink: string[];
  references: ControlReference[];
  unresolved: { controlNumber: string; href: string }[];
  unlabeled: string[];
  resolved: ResolvedReference[];
  overrides: OverrideRow[];
  liveRows: LiveResultRow[];
  rows: ReferenceLinkRow[];
}): Expectation[] {
  const catalogUrls = new Set(input.resources.map((r) => r.url));
  const liveByUrl = new Map(input.liveRows.map((r) => [r.url, r]));
  const deadReplacements = input.overrides.filter((o) => {
    const r = liveByUrl.get(o.replacementUrl);
    return (
      r !== undefined &&
      (r.linkClass === "gone" || r.linkClass === "unreachable")
    );
  });
  const missingLive = input.resolved.filter(
    (r) => r.live === null && r.override === null,
  );
  const staleOverrides = input.overrides.filter(
    (o) => !catalogUrls.has(o.sourceUrl),
  );
  const unprobedReplacements = input.overrides.filter(
    (o) => !liveByUrl.has(o.replacementUrl),
  );
  const defects = input.rows
    .map((row) => ({ row, defect: urlDefect(row.url) }))
    .filter((d) => d.defect !== null);
  const notSeeded = input.resolved.filter((r) => r.seededUrl === null);
  const name = (list: { resource: ReferenceResource }[]) =>
    list
      .slice(0, 10)
      .map((r) => `${r.resource.title} <${r.resource.url}>`)
      .join("; ");

  return [
    {
      name: "back-matter resources with a link",
      actual: input.resources.length,
      floor: 195,
    },
    {
      name: "back-matter resources without a link",
      actual: input.withoutLink.length,
      floor: 0,
      ceiling: 0,
      because: `every resource at the pin carries exactly one rlink; a resource without one cannot be seeded${input.withoutLink.length ? `: ${input.withoutLink.slice(0, 10).join(", ")}` : ""}`,
    },
    {
      name: "reference links on live controls",
      actual: input.references.length,
      floor: 780,
    },
    {
      name: "reference links to an unknown resource",
      actual: input.unresolved.length,
      floor: 0,
      ceiling: 0,
      because: `a control's reference href must name a back-matter resource${
        input.unresolved.length
          ? `: ${input.unresolved
              .slice(0, 10)
              .map((u) => `${u.controlNumber} ${u.href}`)
              .join(", ")}`
          : ""
      }`,
    },
    {
      name: "citing controls without a label",
      actual: input.unlabeled.length,
      floor: 0,
      ceiling: 0,
      because: `a control with references must carry the label its seed row is keyed by${input.unlabeled.length ? `: ${input.unlabeled.slice(0, 10).join(", ")}` : ""}`,
    },
    {
      name: "catalog URLs without a live result",
      actual: missingLive.length,
      floor: 0,
      ceiling: 0,
      because: `every catalog URL needs a row in the live-results file; run the retrieval and commit the file${missingLive.length ? `: ${name(missingLive)}` : ""}`,
    },
    {
      name: "overrides whose source is not a catalog URL",
      actual: staleOverrides.length,
      floor: 0,
      ceiling: 0,
      because: `an override that names no catalog URL is stale and would never apply${
        staleOverrides.length
          ? `: ${staleOverrides
              .slice(0, 10)
              .map((o) => o.sourceUrl)
              .join(", ")}`
          : ""
      }`,
    },
    {
      name: "override replacements without a live result",
      actual: unprobedReplacements.length,
      floor: 0,
      ceiling: 0,
      because: `a replacement is seeded only after the retrieval has checked it; run the retrieval${
        unprobedReplacements.length
          ? `: ${unprobedReplacements
              .slice(0, 10)
              .map((o) => o.replacementUrl)
              .join(", ")}`
          : ""
      }`,
    },
    {
      name: "override replacements that are gone or unreachable",
      actual: deadReplacements.length,
      floor: 0,
      ceiling: 0,
      because: `a replacement is re-verified on every retrieval; one that has died must be replaced again, not served${
        deadReplacements.length
          ? `: ${deadReplacements
              .slice(0, 10)
              .map((o) => o.replacementUrl)
              .join(", ")}`
          : ""
      }`,
    },
    { name: "seeded reference links", actual: input.rows.length, floor: 770 },
    {
      name: "seeded URLs with a format defect",
      actual: defects.length,
      floor: 0,
      ceiling: 0,
      because: `the seed collector reads single-quoted literals and the static gate rejects whitespace and double schemes${
        defects.length
          ? `: ${defects
              .slice(0, 10)
              .map((d) => `${d.defect} in ${d.row.url}`)
              .join("; ")}`
          : ""
      }`,
    },
    {
      name: "resources not seeded",
      actual: notSeeded.length,
      floor: 0,
      ceiling: 10,
      because: `a resource whose catalog URL is gone with no replacement known is held out so every seeded URL passes the live check; find a replacement and add it to the override table${notSeeded.length ? `: ${name(notSeeded)}` : ""}`,
    },
  ];
}

// ---- reports ------------------------------------------------------------------

export const REGISTRY_HEADER = [
  "resource_uuid",
  "title",
  "citation",
  "catalog_url",
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

/** The registry: every resource, what the seed carries for it, and why. A
 *  corpus whose resources are not catalog back-matter passes its own header;
 *  the columns are positional and the first and fourth name the resource's
 *  identifier and its published URL in that corpus's own words. */
export function registryCsv(
  resolved: ResolvedReference[],
  header: readonly string[] = REGISTRY_HEADER,
): string {
  const rows = [...resolved]
    .sort((a, b) =>
      a.resource.title < b.resource.title
        ? -1
        : a.resource.title > b.resource.title
          ? 1
          : a.resource.uuid < b.resource.uuid
            ? -1
            : 1,
    )
    .map((r) => [
      r.resource.uuid,
      r.resource.title,
      r.resource.citation,
      r.resource.url,
      r.seededUrl,
      r.resolvedUrl,
      r.contentType,
      r.resolution,
      r.reason,
      r.live?.status ?? null,
      r.live?.linkClass ?? null,
      r.live?.checkedOn ?? null,
      r.override?.verifiedOn ?? null,
      r.citingControls.length,
      r.citingControls.join(" "),
    ]);
  return toCsv(header, rows);
}

function cite(r: ResolvedReference): string {
  const n = r.citingControls.length;
  return n === 0
    ? "cited by no live control"
    : n === 1
      ? `cited by ${r.citingControls[0]}`
      : `cited by ${n} controls`;
}

/** The date of the live check the resolution rests on, or "unknown". */
export function checkedOnOf(resolved: ResolvedReference[]): string {
  return resolved.map((r) => r.live?.checkedOn).find((d) => d) ?? "unknown";
}

/**
 * The redirect report: what the publisher would need to change for its URLs
 * to be current, written to be submitted upstream as it is. `title` names the
 * corpus in the heading; `basis` names what the URLs were read from (a catalog
 * at its pin, an authored sources table).
 */
export function redirectReport(
  resolved: ResolvedReference[],
  meta: { title: string; basis: string },
): string {
  const checkedOn = checkedOnOf(resolved);
  const overrides = resolved.filter((r) => r.resolution === "override");
  const redirects = resolved.filter((r) => r.resolution === "redirect");
  const gone = resolved.filter((r) => r.seededUrl === null);
  const manual = resolved.filter(
    (r) =>
      r.resolution === "catalog" && r.reason.startsWith("needs a manual check"),
  );
  const lines: string[] = [];
  lines.push(
    `# Reference URLs in ${meta.title} that no longer resolve at the published location`,
  );
  lines.push("");
  lines.push(
    `Measured against ${meta.basis}, with every published URL requested on ${checkedOn} following redirects. ${resolved.length} resources carry a URL; ${overrides.length} are gone at the published URL and have a verified replacement, ${redirects.length} redirect to a new location, ${gone.length} are gone with no replacement known, and ${manual.length} could not be verified by a script.`,
  );
  lines.push("");
  lines.push("## Published URL is gone; a replacement is verified");
  lines.push("");
  for (const r of overrides) {
    lines.push(
      `- **${r.resource.title}** (${cite(r)}). Published: ${r.resource.url}. Replacement: ${r.override!.replacementUrl}. ${r.override!.reason}. Verified ${r.override!.verifiedOn}.`,
    );
  }
  if (overrides.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Published URL redirects to a new location");
  lines.push("");
  for (const r of redirects) {
    lines.push(
      `- **${r.resource.title}** (${cite(r)}). Published: ${r.resource.url}. Current: ${r.seededUrl}.`,
    );
  }
  if (redirects.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Published URL is gone; no replacement known");
  lines.push("");
  for (const r of gone) {
    lines.push(
      `- **${r.resource.title}** (${cite(r)}). Published: ${r.resource.url}. ${r.reason}.`,
    );
  }
  if (gone.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Could not be verified by a script");
  lines.push("");
  lines.push(
    "These answered a scripted request with a refusal, a challenge or a certificate-chain error. They are seeded as published and need a person in a browser to confirm.",
  );
  lines.push("");
  for (const r of manual) {
    lines.push(
      `- **${r.resource.title}** (${cite(r)}). ${r.resource.url}. ${r.reason}.`,
    );
  }
  if (manual.length === 0) lines.push("- none");
  lines.push("");
  return lines.join("\n");
}
