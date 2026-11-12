/**
 * Decoder Router - control and Zero Trust mapping queries
 *
 * Provides a type-safe API for querying the catalog's controls and their Zero Trust mappings.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import type { db } from "~/server/db";
import type { Prisma } from "../../../../generated/prisma";
import {
  isIdentifierQuery,
  isQueryActive,
  matchesQuery,
  type FilterQuery,
  normalizeControlId,
  passesFacets,
} from "~/app/_components/decoder-ring/filterPredicate";
import {
  LINE_DATASETS,
  LINE_FIELDS,
  toExportControl,
} from "~/lib/export/from-detail";
import {
  EXPORT_DATASETS,
  EXPORT_FIELDS,
  familyOf,
  type ExportRecord,
} from "~/lib/export/record";
import { exportSelectionSchema } from "~/lib/export/selection-schema";
import { describeReference } from "~/server/api/reference-descriptor";
import { formatPartLabel } from "~/lib/part-label";
import { frequencyFromParts } from "~/server/api/frequency";

// ---------------------------------------------------------------------------
// Interfaces for Prisma query results with nested includes + _count
// ---------------------------------------------------------------------------

export interface ParameterValueRow {
  baselines: string[]; // Baseline[] enum values, e.g. ["LOW","MODERATE","HIGH"]
  value: string;
}

export interface ParameterRow {
  id: string;
  label: string;
  position: number;
  values: ParameterValueRow[];
}

export interface PartRow {
  id: string;
  oscalPartId: string;
  label: string | null;
  name: string;
  prose: string | null;
  sortOrder: number;
  parameters: ParameterRow[];
  _count: { ztCoverages: number };
  children?: PartRow[];
}

export interface ZTMMGuidanceRow {
  pillar: string;
  function: string;
  functionGroup: string;
  base: string;
  traditional: string | null;
  initial: string | null;
  advanced: string | null;
  optimal: string | null;
}

// Guidance is resolved by group key (pillar, functionGroup) at read time — there is
// no scalar FK on ZeroTrustMapping. A multi-part function (e.g. "Identity Stores",
// split into member rows "Identity Stores-Developers/-APIs/-Users") has several rows
// sharing one functionGroup, so the map value is an ARRAY of member rows that the
// resolver concatenates. functionGroup is NOT NULL (= function for singletons), so a
// dropped value fails loud rather than silently degrading.
type GuidanceMap = Map<string, ZTMMGuidanceRow[]>;

// Partial: unknown maturities (e.g. the enum's TBD member) map to undefined,
// so the `col ?` guard at the call site is load-bearing, not a no-op.
const MATURITY_COLUMN: Partial<
  Record<string, "traditional" | "initial" | "advanced" | "optimal">
> = {
  TRADITIONAL: "traditional",
  INITIAL: "initial",
  ADVANCED: "advanced",
  OPTIMAL: "optimal",
};

// Only the fields resolveGuidance reads — keeps the prefetch lean and decoupled
// from audit columns added to ZTMMGuidance later.
const GUIDANCE_SELECT = {
  pillar: true,
  function: true,
  functionGroup: true,
  base: true,
  traditional: true,
  initial: true,
  advanced: true,
  optimal: true,
} as const;

function guidanceKey(pillar: string, group: string): string {
  return `${pillar}::${group}`;
}

/**
 * Build the resolution map: group ZTMMGuidance rows by (pillar, functionGroup).
 * A singleton function has one row; a multi-part function has several member rows
 * sharing the group.
 */
function buildGuidanceMap(rows: ZTMMGuidanceRow[]): GuidanceMap {
  const map: GuidanceMap = new Map();
  for (const row of rows) {
    const key = guidanceKey(row.pillar, row.functionGroup);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * Prefetch all ZTMMGuidance rows once and build the (pillar, functionGroup)
 * resolution map. The table is small (one row per pillar/function), so a single
 * unfiltered fetch per request avoids N+1 lookups while resolving guidance.
 */
/**
 * The catalog this deployment serves.
 *
 * Every procedure resolved this itself, five copies of the same findFirst and the same
 * error string. One path matters beyond tidiness: a deployment holds exactly one catalog,
 * so "which catalog am I" is a property of the deployment rather than of a query, and five
 * answers to it is five places for a second product to disagree with itself.
 *
 * Throws rather than returning null. A deployment with no active catalog is misconfigured,
 * not empty, and every caller here dereferences the result immediately — a null would
 * surface as a property access on undefined somewhere further down instead of saying what
 * is actually wrong.
 */
async function resolveActiveCatalog(prisma: typeof db) {
  const catalog = await prisma.nistVersion.findFirst({
    where: { isActive: true },
  });

  if (!catalog) {
    throw new Error("No active catalog version found");
  }

  return catalog;
}

async function prefetchGuidance(prisma: typeof db): Promise<GuidanceMap> {
  const rows = await prisma.zTMMGuidance.findMany({ select: GUIDANCE_SELECT });
  return buildGuidanceMap(rows);
}

/** Compose one row: shared `base` + the maturity-specific fragment. */
function composeRow(row: ZTMMGuidanceRow, maturity: string): string {
  const col = MATURITY_COLUMN[maturity];
  const fragment = col ? row[col] : null;
  return [row.base, fragment].filter(Boolean).join("\n");
}

/**
 * Resolve a mapping's display guidance. The mapping's `function` is the group key;
 * all member rows sharing (pillar, functionGroup) are composed (base + maturity
 * fragment) and concatenated in function-name order (plain, blank line between).
 * Falls back to the caller-supplied `fallback` string when no group matches; call sites
 * pass ZT_GUIDANCE_PENDING (modal/card) or "" (combined view). Multi-pillar mappings
 * resolve the first pillar.
 */
function resolveGuidance(
  pillars: string[],
  func: string,
  maturity: string,
  fallback: string,
  guidanceMap: GuidanceMap,
): string {
  const pillar = pillars[0];
  if (!pillar) return fallback;
  // `func` is the mapping's function, which must equal a guidance row's functionGroup
  // (the map is keyed by functionGroup, not function). A mapping function with no
  // matching group falls back — the coverage-gap signal that check-seed-sql reports.
  const rows = guidanceMap.get(guidanceKey(pillar, func));
  if (!rows || rows.length === 0) return fallback;
  const composed = [...rows]
    .sort((a, b) => a.function.localeCompare(b.function))
    .map((row) => composeRow(row, maturity))
    .filter(Boolean)
    .join("\n\n");
  return composed || fallback;
}

// Shown for a (pillar, function, maturity) tuple with no matching ZTMMGuidance row.
// discussion now has its own modal section, so it is NOT reused as the ZT guidance
// fallback (that would duplicate it); implementationGuidance is a retired placeholder.
export const ZT_GUIDANCE_PENDING =
  "Zero Trust guidance for this function is pending.";

export interface ZTMappingRow {
  pillars: string[];
  function: string;
  maturityLevel: string;
  // Per-tuple breakout (Option B). The representative above (pillars/function/maturityLevel)
  // is one of these; affinities carry the full multi-(pillar, function, maturity) truth.
  affinities: Array<{
    pillar: string;
    function: string;
    maturity: string;
    designation: string | null;
    ifApplicable: boolean;
  }>;
}

// One NistControlLink junction row joined to its ReferenceLink (control-level reference doc).
export interface ReferenceLinkRow {
  displayOrder: number;
  link: {
    title: string;
    url: string;
    domain: string;
    /** The citation, when the pipeline that seeded the link recorded one. */
    description: string | null;
  };
}

/** One SP 800-53A determination statement, as seeded in 08. `partId` is the
 *  ControlPart the determination assesses, or null when it assesses the
 *  control's root statement. */
export interface AssessmentObjectiveRow {
  id: string;
  cprtIdentifier: string;
  text: string;
  sortOrder: number;
  partId: string | null;
}

/** One SP 800-53A assessment method entry: what to examine, whom to interview,
 *  or what to test. At most one row per kind per control. */
export interface AssessmentMethodRow {
  method: "EXAMINE" | "INTERVIEW" | "TEST";
  text: string;
}

/** The three kinds SP 800-53A defines, in the publication's order. */
const ASSESSMENT_METHOD_KINDS = ["EXAMINE", "INTERVIEW", "TEST"] as const;

export interface ControlRow {
  controlNumber: string;
  controlName: string;
  // The OSCAL identifier the bridge payload carries. Present on the row already — every query here uses `include` rather than `select` — so surfacing it is a mapping change, not a backfill.
  oscalId: string | null;
  discussion: string | null;
  reviewFrequency: string | null;
  assessmentFrequency: string | null;
  // Which baselines the control itself belongs to, as the catalog spells them.
  // Seeded per control; the UI labels them, so the raw tokens travel unchanged.
  baselineLabels: string[];
  parts: PartRow[];
  ztMapping: ZTMappingRow | null;
  // NistLink: the catalog's own reference links for the control, seeded by the
  // reference-link pipeline at each resource's current location, with the citation
  // as description and what the link leads to (resolved URL, media type).
  links: Array<{
    title: string;
    url: string;
    description: string | null;
    resolvedUrl: string | null;
    contentType: string | null;
    displayOrder: number;
  }>;
  // ReferenceLink reference docs via the NistControlLink junction; control-level, domain-tagged.
  referenceLinks: ReferenceLinkRow[];
  // SP 800-53A assessment procedures. Empty arrays for a catalog that carries none.
  assessmentObjectives: AssessmentObjectiveRow[];
  assessmentMethods: AssessmentMethodRow[];
  // Whether the catalog still carries the control. Absent on a row read without it,
  // which is a live control: only the withdrawn ones say so.
  status?: "LIVE" | "WITHDRAWN";
  // What the catalog records about the control (its successors, or the release that added
  // it), and the withdrawn controls whose content it took. Read by getControlById only.
  lineage?: LineageDbRow[];
  lineageFrom?: LineageDbRow[];
}

interface LineageDbRow {
  controlNumber: string;
  kind: "INCORPORATED_INTO" | "MOVED_TO" | "ADDED" | "DROPPED";
  relatedControlNumber: string | null;
  relatedPartOscalId: string | null;
  release: string;
  sinceRelease: string | null;
  // On a control's own rows: the successor's Zero Trust pillars, when it is mapped.
  relatedControl?: { ztMapping: { pillars: string[] } | null } | null;
}

const LINEAGE_SELECT = {
  controlNumber: true,
  kind: true,
  relatedControlNumber: true,
  relatedPartOscalId: true,
  release: true,
  sinceRelease: true,
} as const;

/** The include getControlById's two queries share for lineage: the control's own rows,
 *  and the withdrawn controls whose successor it is. Only a succession row sets the
 *  related control's key, so `lineageFrom` needs no filter on kind. */
const LINEAGE_INCLUDE = {
  lineage: {
    orderBy: { relatedControlNumber: "asc" },
    select: {
      ...LINEAGE_SELECT,
      // A withdrawn control carries no Zero Trust mapping; its successors may, and the
      // pane points there instead of ending.
      relatedControl: { select: { ztMapping: { select: { pillars: true } } } },
    },
  },
  lineageFrom: {
    orderBy: { controlNumber: "asc" },
    select: LINEAGE_SELECT,
  },
} as const;

const SUCCESSION_KINDS = new Set(["INCORPORATED_INTO", "MOVED_TO"]);

/** A family code, such as SR: a successor the catalog names as a whole family. */
const FAMILY_CODE = /^[A-Z]{2}$/;

function mapLineage(ctrl: ControlRow) {
  const own = ctrl.lineage ?? [];
  const added = own.find((l) => l.kind === "ADDED");
  return {
    successors: own
      .filter((l) => SUCCESSION_KINDS.has(l.kind) && l.relatedControlNumber)
      .map((l) => ({
        controlNumber: l.relatedControlNumber!,
        kind:
          l.kind === "MOVED_TO"
            ? ("moved-to" as const)
            : ("incorporated-into" as const),
        family: FAMILY_CODE.test(l.relatedControlNumber!),
        // The item of the successor's statement the catalog names, e.g. "ac-2_smt.k".
        part: l.relatedPartOscalId,
        // The successor's Zero Trust pillars; null when it carries no mapping.
        ztPillars: l.relatedControl?.ztMapping?.pillars ?? null,
      })),
    incorporates: (ctrl.lineageFrom ?? []).map((l) => ({
      controlNumber: l.controlNumber,
      kind:
        l.kind === "MOVED_TO"
          ? ("moved-to" as const)
          : ("incorporated-into" as const),
      part: l.relatedPartOscalId,
    })),
    addedIn: added
      ? { release: added.release, sinceRelease: added.sinceRelease }
      : null,
  };
}

/** The include both control queries share for assessment content. Objectives in
 *  publication order; methods in enum order, which is examine, interview, test. */
const ASSESSMENT_INCLUDE = {
  assessmentObjectives: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      cprtIdentifier: true,
      text: true,
      sortOrder: true,
      partId: true,
    },
  },
  assessmentMethods: {
    orderBy: { method: "asc" },
    select: { method: true, text: true },
  },
} as const;

/**
 * Max observed OSCAL nesting is 4 levels (statement → item → sub-item → sub-sub-item).
 * Uses `_count` for ztCoverages (SQL COUNT) instead of fetching rows.
 * Typed as `any` — Prisma's recursive include doesn't have a static type for
 * arbitrary nesting depth; the runtime shape matches PartRow above.
 */
// Values order by id: the deterministic seed id ends in a single-digit `_<idx>_` (0-3, one
// per baseline — four baselines is the max), so lexicographic id sort == value order.
const PARAMETERS_INCLUDE = {
  orderBy: { position: "asc" },
  include: { values: { orderBy: { id: "asc" } } },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PARTS_INCLUDE: any = {
  where: { parentPartId: null },
  orderBy: { sortOrder: "asc" },
  include: {
    parameters: PARAMETERS_INCLUDE,
    _count: { select: { ztCoverages: true } },
    children: {
      orderBy: { sortOrder: "asc" },
      include: {
        parameters: PARAMETERS_INCLUDE,
        _count: { select: { ztCoverages: true } },
        children: {
          orderBy: { sortOrder: "asc" },
          include: {
            parameters: PARAMETERS_INCLUDE,
            _count: { select: { ztCoverages: true } },
            children: {
              orderBy: { sortOrder: "asc" },
              include: {
                parameters: PARAMETERS_INCLUDE,
                _count: { select: { ztCoverages: true } },
              },
            },
          },
        },
      },
    },
  },
};

// Everything a control's record reads: getControlById's two queries and the export share it.
const DETAIL_INCLUDE = {
  ztMapping: {
    include: {
      affinities: {
        orderBy: [{ pillar: "asc" }, { function: "asc" }, { maturity: "asc" }],
      },
    },
  },
  links: { orderBy: { displayOrder: "asc" } },
  referenceLinks: {
    include: { link: true },
    orderBy: { displayOrder: "asc" },
  },
  ...ASSESSMENT_INCLUDE,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Prisma recursive include limitation
  parts: PARTS_INCLUDE,
} satisfies Prisma.NistControlInclude;

// ---------------------------------------------------------------------------
// Mapping helpers — module scope, allocated once per import
// ---------------------------------------------------------------------------

function mapParameter(p: ParameterRow) {
  return {
    id: p.id,
    label: p.label,
    position: p.position,
    // Baseline-grouped values (one per distinct value); an undefined baseline has no entry.
    values: p.values.map((v) => ({ baselines: v.baselines, value: v.value })),
  };
}

function mapPart(part: PartRow): {
  id: string;
  oscalPartId: string;
  label: string | null;
  name: string;
  prose: string | null;
  sortOrder: number;
  ztCovered: boolean;
  parameters: ReturnType<typeof mapParameter>[];
  children: ReturnType<typeof mapPart>[];
} {
  return {
    id: part.id,
    oscalPartId: part.oscalPartId,
    label: part.label,
    name: part.name,
    prose: part.prose,
    sortOrder: part.sortOrder,
    ztCovered: (part._count?.ztCoverages ?? 0) > 0,
    parameters: part.parameters.map(mapParameter),
    children: (part.children ?? []).map(mapPart),
  };
}

/**
 * Reconstruct a flat text statement from the structured part tree.
 * Recursively walks all nesting levels (OSCAL allows up to 4).
 * - Root prose on its own line (if present)
 * - Children indented by depth: "  ".repeat(depth) + "label. prose"
 */
function composeFromParts(parts: ReturnType<typeof mapPart>[]): string {
  if (parts.length === 0) return "";

  const statementPart = parts.find((p) => p.name === "statement");
  if (!statementPart) return "";

  if (statementPart.children.length === 0) {
    return statementPart.prose ?? "";
  }

  const lines: string[] = [];

  if (statementPart.prose) {
    lines.push(statementPart.prose);
  }

  function collectLines(
    children: ReturnType<typeof mapPart>[],
    depth: number,
  ): void {
    for (const child of children) {
      const indent = "  ".repeat(depth);
      const label = child.label ? formatPartLabel(child.label) : "";
      lines.push(`${indent}${label} ${child.prose ?? ""}`);
      if (child.children.length > 0) collectLines(child.children, depth + 1);
    }
  }

  collectLines(statementPart.children, 0);
  return lines.join("\n");
}

/** The retrieval that bounds one reference-link corpus's verification date, by
 *  the DataSource type its seed files write, or null when that corpus has never
 *  been seeded. A corpus can come from more than one seed file, each recording
 *  its own check, so this is the oldest check: a pane never claims its links
 *  were verified later than its least recently checked file. A file never
 *  checked (no date) sorts first, so the pane says the links are unverified. */
async function provenanceOf(
  prisma: typeof db,
  type: string,
): Promise<{
  name: string;
  checkedOn: Date | null;
  description: string | null;
} | null> {
  const row = await prisma.dataSource.findFirst({
    where: { type, isActive: true },
    orderBy: [
      { lastCrawled: { sort: "asc", nulls: "first" } },
      { name: "asc" },
    ],
    select: { name: true, lastCrawled: true, description: true },
  });
  return row
    ? {
        name: row.name,
        checkedOn: row.lastCrawled,
        description: row.description,
      }
    : null;
}

function mapLinks(ctrl: Pick<ControlRow, "referenceLinks" | "links">) {
  return {
    // Zero Trust reference links (ReferenceLink via the NistControlLink junction),
    // domain-tagged, rendered in the right (ZT) pane grouped by domain. Each entry
    // says what it leads to from its URL alone (the link table stores no media
    // type or resolved address) and carries the citation the pipeline recorded.
    ztLinks: ctrl.referenceLinks.map((j) => ({
      label: j.link.title,
      url: j.link.url,
      domain: j.link.domain,
      descriptor: describeReference({
        url: j.link.url,
        resolvedUrl: null,
        contentType: null,
      }),
      citation: j.link.description,
    })),
    // The catalog's reference links (NistLink) — the left pane. Each entry says
    // what it leads to (kind · site · via resolver) and carries the citation.
    nistLinks: ctrl.links.map((l) => ({
      label: l.title,
      url: l.url,
      descriptor: describeReference(l),
      citation: l.description,
    })),
  };
}

function mapControl(ctrl: ControlRow, guidanceMap: GuidanceMap) {
  const hasZT = !!ctrl.ztMapping;
  const mappedParts = ctrl.parts.map(mapPart);
  const methodText = new Map(
    ctrl.assessmentMethods.map((m) => [m.method, m.text] as const),
  );
  const hasAssessment =
    ctrl.assessmentObjectives.length > 0 || ctrl.assessmentMethods.length > 0;
  // Capture as a const so the non-null narrowing survives into the affinities .map closure.
  const zt = ctrl.ztMapping;
  return {
    id: ctrl.controlNumber,
    oscalId: ctrl.oscalId ?? null,
    name: ctrl.controlName,
    discussion: ctrl.discussion ?? null,
    description: composeFromParts(mappedParts),
    reviewFrequency: ctrl.reviewFrequency ?? null,
    assessmentFrequency: ctrl.assessmentFrequency ?? null,
    // The frequencies the control asks for, read from its statement: each is organization-defined in this catalog.
    frequency: frequencyFromParts(mappedParts),
    // Deliberately not named after the column it comes from. Each catalog stores this
    // under its own name, so a neutral field here keeps the difference inside this file
    // instead of spreading it through every component that renders a badge.
    baselines: ctrl.baselineLabels ?? [],
    status: hasZT ? ("zero-trust-aligned" as const) : ("compliance" as const),
    // Not `status`, which already says whether the control is Zero Trust aligned.
    catalogStatus:
      ctrl.status === "WITHDRAWN" ? ("withdrawn" as const) : ("live" as const),
    lineage: mapLineage(ctrl),
    parts: mappedParts,
    ...mapLinks(ctrl),
    // SP 800-53A assessment procedures: the determination statements an assessor answers, each pointing at the lettered part it assesses (or at the control's root statement when partId is null), and the examine / interview / test lists.
    //
    // `methods` carries all three kinds with a null text for one the publication does not provide, rather than omitting the row. That is the whole point of the shape: a client has to tell "NIST publishes no test for this control", which is true of 108 of them, from "this catalog has no assessment content", which is true of a catalog with no assessment publication. A sparse list conflates the two, and an always-three list would assert the first about a catalog that simply was not ingested. So the list is empty when the control has nothing at all, and complete — nulls included — the moment it has anything.
    assessment: {
      objectives: ctrl.assessmentObjectives.map((o) => ({
        id: o.id,
        identifier: o.cprtIdentifier,
        text: o.text,
        partId: o.partId,
      })),
      methods: hasAssessment
        ? ASSESSMENT_METHOD_KINDS.map((kind) => ({
            method: kind,
            text: methodText.get(kind) ?? null,
          }))
        : [],
    },
    ztMapping: zt
      ? {
          pillar: zt.pillars.join(", "),
          function: zt.function,
          maturity: zt.maturityLevel,
          // Guidance: ZTMM (pillar, functionGroup) resolution; when no group matches, a
          // neutral pending placeholder. discussion has its own modal section, so it is
          // not reused here (would duplicate); implementationGuidance is retired.
          guidance: resolveGuidance(
            zt.pillars,
            zt.function,
            zt.maturityLevel,
            ZT_GUIDANCE_PENDING,
            guidanceMap,
          ),
          // Option B: each real (pillar, function, maturity) tuple with its OWN resolved
          // guidance. The representative above is one of these (override controls aside);
          // the modal groups them by pillar. Single-tuple controls have exactly one entry.
          affinities: zt.affinities.map((a) => ({
            pillar: a.pillar,
            function: a.function,
            maturity: a.maturity,
            // CISA's designation for the tuple and its If Applicable flag, as seeded.
            designation: a.designation,
            ifApplicable: a.ifApplicable,
            guidance: resolveGuidance(
              [a.pillar],
              a.function,
              a.maturity,
              ZT_GUIDANCE_PENDING,
              guidanceMap,
            ),
          })),
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Bridge data contract — the filter-ready control dataset the layer cake renders.
// ---------------------------------------------------------------------------

type BridgeStatus =
  | "zero-trust-aligned"
  | "zt-aligned-with-enhancements"
  | "zt-via-enhancements"
  | "compliance";

interface FilterableControl {
  id: string; // controlNumber, e.g. "AC-02"
  // The OSCAL identifier, e.g. "ac-2". Stable across catalog revisions in a way the display number is not, which is why selection is carried by it rather than by `id`.
  oscalId: string | null;
  name: string;
  status: BridgeStatus;
  family: string; // family code, e.g. "AC"
  // Filter dimensions sourced from the per-tuple ZTMappingAffinity rows (the full
  // set, not the representative mapping) so multi-pillar/maturity controls don't
  // mis-bucket. Values are the enum strings the URL filter compares against.
  pillars: string[];
  maturities: string[];
  /** The catalog baselines that include the control, as the catalog spells them. */
  baselines: string[];
  /** Every baseline that includes at least one of its enhancements. */
  enhancementBaselines: string[];
  functions: string[];
  /** CISA's designations across the control's tuples (KEY, SUPPORTING, INFORMATIVE). */
  designations: string[];
  ztMapping?: {
    pillar: string;
    function: string;
    maturity: string;
    guidance: string;
  };
}

interface BridgeFamily {
  id: string;
  name: string;
  controls: FilterableControl[];
}

const unique = <T>(xs: T[]): T[] => Array.from(new Set(xs));

/** A Zero Trust row passes the pillar, maturity and designation facets when it is in every active one. */
const tuplePasses = (
  t: { pillar: string; maturity: string; designation?: string | null },
  query: Pick<FilterQuery, "pillar" | "maturity" | "designation">,
) =>
  // A mapping with no affinity rows exports one row naming its pillars joined.
  (!query.pillar.length ||
    t.pillar.split(", ").some((p) => query.pillar.includes(p))) &&
  (!query.maturity.length || query.maturity.includes(t.maturity)) &&
  (!query.designation.length ||
    (!!t.designation && query.designation.includes(t.designation)));

/**
 * Every live base control with its filter dimensions, in family then catalog order. The
 * layer cake groups these; the export filters them with the same predicate the diagram
 * uses. pillars/maturities/functions come from the per-tuple ZTMappingAffinity rows (not
 * the representative mapping) so multi-pillar/maturity controls carry their full set and
 * don't mis-bucket.
 */
async function loadBridgeControls(
  prisma: typeof db,
  versionId: string,
  // Null when only the filter dimensions are wanted, as the export's are.
  guidanceMap: GuidanceMap | null,
): Promise<Array<FilterableControl & { familyName: string }>> {
  // Fetch only BASE controls for layer cake (no enhancements)
  const controls = await prisma.nistControl.findMany({
    where: {
      nistVersionId: versionId,
      parentControlId: null, // Only top-level controls
      status: "LIVE", // The cake shows the live catalog; withdrawn controls are reached from the modal
    },
    include: {
      controlFamily: true,
      ztMapping: { include: { affinities: true } },
      // Every enhancement, for two things: whether any is ZT-mapped, and which
      // baselines its enhancements are in, so the baseline filter can match a base
      // control through them.
      children: {
        where: { status: "LIVE" },
        select: { baselineLabels: true, ztMapping: { select: { id: true } } },
      },
    },
    orderBy: [{ controlFamilyId: "asc" }, { sortId: "asc" }],
  });

  return controls.map((control) => {
    const zt = control.ztMapping;
    const hasZTMapping = !!zt;
    const enhancements = control.children ?? [];
    const hasZTEnhancements = enhancements.some((e) => Boolean(e.ztMapping));
    // Four mutually-exclusive buckets so the chip color tells the whole story:
    // base-only (blue), base + ZT enhancement(s) (violet), enhancement-only (teal),
    // none (grey). The children include already flags a ZT enhancement even when the
    // base is mapped, so the "both" case no longer collapses into base-only.
    const status: BridgeStatus = hasZTMapping
      ? hasZTEnhancements
        ? "zt-aligned-with-enhancements"
        : "zero-trust-aligned"
      : hasZTEnhancements
        ? "zt-via-enhancements"
        : "compliance";

    // Filter dimensions from the per-tuple affinity rows (fall back to the
    // representative mapping when a ZT control has no affinity breakout).
    const affinities = zt?.affinities ?? [];
    const pillars: string[] = unique(
      affinities.length ? affinities.map((a) => a.pillar) : (zt?.pillars ?? []),
    );
    const maturities: string[] = unique(
      affinities.length
        ? affinities.map((a) => a.maturity)
        : zt
          ? [zt.maturityLevel]
          : [],
    );
    const functions: string[] = unique(
      affinities.length
        ? affinities.map((a) => a.function)
        : zt
          ? [zt.function]
          : [],
    );
    // A tuple CISA has not designated contributes nothing here, so no designation
    // filter matches it.
    const designations: string[] = unique(
      affinities.flatMap((a) => (a.designation ? [a.designation] : [])),
    );

    return {
      id: control.controlNumber,
      oscalId: control.oscalId,
      name: control.controlName,
      status,
      family: control.controlFamilyId,
      familyName: control.controlFamily.name,
      pillars,
      maturities,
      functions,
      designations,
      baselines: control.baselineLabels ?? [],
      enhancementBaselines: unique(
        enhancements.flatMap((e) => e.baselineLabels ?? []),
      ),
      ztMapping:
        zt && guidanceMap
          ? {
              pillar: zt.pillars.join(", "),
              function: zt.function,
              maturity: zt.maturityLevel,
              guidance: resolveGuidance(
                zt.pillars,
                zt.function,
                zt.maturityLevel,
                ZT_GUIDANCE_PENDING,
                guidanceMap,
              ),
            }
          : undefined,
    };
  });
}

/**
 * The live base controls whose text matches `q` across both panes the modal renders — the
 * control section (number / name / statement prose / discussion / reference policy) and
 * the ZT section (the mapping function + the resolved ZTMM guidance text). Postgres ILIKE
 * (contains, case-insensitive), in catalog order.
 */
async function searchCatalog(prisma: typeof db, versionId: string, q: string) {
  const contains = { contains: q, mode: "insensitive" as const };

  // ZT-section text: find ZTMM guidance rows whose text matches, then match the
  // controls whose mapping resolves to them (pillar + functionGroup = the mapping
  // function — the inverse of read-time guidance resolution).
  const guidanceHits = await prisma.zTMMGuidance.findMany({
    where: {
      OR: [
        { base: contains },
        { traditional: contains },
        { initial: contains },
        { advanced: contains },
        { optimal: contains },
      ],
    },
    select: { pillar: true, functionGroup: true },
  });
  const guidanceClauses = guidanceHits.map((g) => ({
    ztMapping: { pillars: { has: g.pillar }, function: g.functionGroup },
  }));

  const controls = await prisma.nistControl.findMany({
    where: {
      nistVersionId: versionId,
      parentControlId: null,
      status: "LIVE",
      OR: [
        { controlNumber: contains },
        { controlName: contains },
        { discussion: contains },
        { referencePolicy: contains },
        { parts: { some: { prose: contains } } },
        { ztMapping: { function: contains } },
        ...guidanceClauses,
      ],
    },
    select: { controlNumber: true, controlName: true },
    orderBy: { sortId: "asc" },
  });
  return controls;
}

export const decoderRouter = createTRPCRouter({
  /**
   * Bridge data: every base control with its filter dimensions, grouped by family.
   * Filtering and the mountain layout are client concerns — the URL filter state
   * narrows this set and arrangeMountain() orders the families — so this returns the
   * full, filter-ready dataset. pillars/maturities/functions come from the per-tuple
   * ZTMappingAffinity rows (not the representative mapping) so multi-pillar/maturity
   * controls carry their full set and don't mis-bucket.
   */
  getBridgeData: publicProcedure.query(async ({ ctx }) => {
    // Get the active catalog version
    const activeVersion = await resolveActiveCatalog(ctx.db);

    // Guidance is resolved by group key (pillar, functionGroup); prefetch once.
    const guidanceMap = await prefetchGuidance(ctx.db);

    const familyMap = new Map<string, BridgeFamily>();
    for (const control of await loadBridgeControls(
      ctx.db,
      activeVersion.id,
      guidanceMap,
    )) {
      const { familyName, ...filterable } = control;
      if (!familyMap.has(control.family)) {
        familyMap.set(control.family, {
          id: control.family,
          name: familyName,
          controls: [],
        });
      }
      familyMap.get(control.family)!.controls.push(filterable);
    }

    // Stable, deterministic order (by family code). The mountain arrangement is a
    // client concern (arrangeMountain), computed once from the full set so filtering
    // never reshuffles positions.
    const families = Array.from(familyMap.values())
      .filter((family) => family.controls.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      // The catalog states its own label; this was the last server-side place a product
      // name was composed from a template.
      version: activeVersion.displayLabel,
      families,
    };
  }),

  /**
   * Typeahead search across BOTH panes the modal renders — the control section
   * (number / name / statement prose / discussion / reference policy) AND the ZT
   * mapping section (the ztMapping function + the resolved ZTMM guidance text). Powers
   * the search box's direct-navigation dropdown. Base controls only (the layer cake is
   * base-only; an enhancement is reached through its base modal); version-scoped;
   * Postgres ILIKE (contains, case-insensitive).
   */
  searchControls: publicProcedure
    .input(
      z.object({
        q: z.string().trim().min(2),
        // Off by default: search reads the current controls. On, it also matches the
        // controls the catalog has withdrawn, base or enhancement, by number and name,
        // which is all the catalog keeps of them.
        includeWithdrawn: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const activeVersion = await resolveActiveCatalog(ctx.db);

      const q = input.q;
      const contains = { contains: q, mode: "insensitive" as const };
      const controls = await searchCatalog(ctx.db, activeVersion.id, q);

      const withdrawnControls = input.includeWithdrawn
        ? await ctx.db.nistControl.findMany({
            where: {
              nistVersionId: activeVersion.id,
              status: "WITHDRAWN",
              OR: [{ controlNumber: contains }, { controlName: contains }],
            },
            select: { controlNumber: true, controlName: true },
            orderBy: { sortId: "asc" },
          })
        : [];

      const lower = q.toLowerCase();
      const hit = (
        control: { controlNumber: string; controlName: string },
        withdrawn: boolean,
      ) => ({
        controlNumber: control.controlNumber,
        controlName: control.controlName,
        matchedIn: control.controlNumber.toLowerCase().includes(lower)
          ? ("id" as const)
          : control.controlName.toLowerCase().includes(lower)
            ? ("name" as const)
            : ("text" as const),
        withdrawn,
      });
      const results = [
        ...controls.map((c) => hit(c, false)),
        ...withdrawnControls.map((c) => hit(c, true)),
      ];
      // Surface an exact control-number match first; otherwise keep sortId order.
      results.sort((a, b) => {
        const aExact = a.controlNumber.toLowerCase() === lower ? 0 : 1;
        const bExact = b.controlNumber.toLowerCase() === lower ? 0 : 1;
        return aExact - bExact;
      });
      // Two audiences, one match. `hits` is the dropdown, capped because nobody reads a
      // 200-row dropdown. `matchingIds` is the layer cake, uncapped because a diagram
      // that narrowed to the first 25 would be lying about what matched. The cap moved
      // off the query and onto the slice so the exact-number match surfaces even when
      // sortId order would have pushed it past the cutoff.
      // A withdrawn control is not on the cake, so it never narrows it.
      return {
        hits: results.slice(0, 25),
        matchingIds: results
          .filter((r) => !r.withdrawn)
          .map((r) => r.controlNumber),
      };
    }),

  /** Every control and enhancement, withdrawn ones marked, for the export page's picker. */
  listControls: publicProcedure.query(async ({ ctx }) => {
    const activeVersion = await resolveActiveCatalog(ctx.db);
    const rows = await ctx.db.nistControl.findMany({
      where: { nistVersionId: activeVersion.id },
      select: {
        controlNumber: true,
        controlName: true,
        status: true,
      },
      orderBy: [{ controlFamilyId: "asc" }, { sortId: "asc" }],
    });
    return rows.map((r) => ({
      id: r.controlNumber,
      name: r.controlName,
      withdrawn: r.status === "WITHDRAWN",
    }));
  }),

  /** How many controls a selection exports, read the way the export reads it. */
  countExport: publicProcedure
    .input(exportSelectionSchema)
    .query(async ({ ctx, input }) => {
      const activeVersion = await resolveActiveCatalog(ctx.db);
      const rows = await selectExportRows(
        ctx.db,
        activeVersion.id,
        input,
        null,
      );
      return { count: rows.length };
    }),

  /**
   * Get a single control by ID with full details
   */
  getControlById: publicProcedure
    .input(
      z.object({
        controlId: z.string(), // e.g., "AC-2"
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get active version
      const activeVersion = await resolveActiveCatalog(ctx.db);

      const control = (await ctx.db.nistControl.findFirst({
        where: {
          controlNumber: input.controlId,
          nistVersionId: activeVersion.id,
        },
        include: { ...DETAIL_INCLUDE, ...LINEAGE_INCLUDE },
      })) as unknown as (ControlRow & { id: string }) | null;

      // NOT_FOUND, not a plain Error: the control page turns this code, and only
      // this code, into a 404, so a database fault still surfaces as a 500.
      if (!control) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Control ${input.controlId} not found`,
        });
      }

      // Guidance is resolved by group key (pillar, functionGroup); prefetch once.
      const guidanceMap = await prefetchGuidance(ctx.db);

      const enhancements = (await ctx.db.nistControl.findMany({
        where: {
          parentControlId: control.id,
          nistVersionId: activeVersion.id,
        },
        include: { ...DETAIL_INCLUDE, ...LINEAGE_INCLUDE },
        // Withdrawn enhancements included: the modal shows them as marked tabs that
        // lead to their successors.
        orderBy: { sortId: "asc" },
      })) as unknown as ControlRow[];

      // Provenance of the reference links: each seed file that feeds a pane records
      // its link check as a DataSource row typed for that pane. A pane fed by several
      // files reports the oldest of their checks (see provenanceOf), so it can say
      // when its links were last verified without a build-time constant.
      const referenceProvenance = await provenanceOf(ctx.db, "reference-links");
      const ztReferenceProvenance = await provenanceOf(
        ctx.db,
        "zt-reference-links",
      );

      // Whether this catalog's data records lineage at all. One that records none sends
      // `lineage: null`, so the modal says the successors are not recorded rather than that
      // the catalog names none: absent at source is not the same as never ingested.
      const lineageRecorded =
        (await ctx.db.controlLineage.findFirst({
          where: { nistVersionId: activeVersion.id },
          select: { id: true },
        })) !== null;
      const detail = (row: ControlRow) => {
        const mapped = mapControl(row, guidanceMap);
        return { ...mapped, lineage: lineageRecorded ? mapped.lineage : null };
      };

      return {
        ...detail(control),
        enhancements: enhancements.map(detail),
        referenceProvenance,
        ztReferenceProvenance,
      };
    }),

  /**
   * Combined view: base controls with their discussion and ZT maturity information.
   * Surfaces NistControl.discussion (the catalog's guidance prose)
   * alongside the resolved ZTMM guidance (base + maturity fragment by (pillar, functionGroup)).
   */
  getCombinedView: publicProcedure
    .input(
      z
        .object({
          pillar: z
            .enum([
              "IDENTITY",
              "DEVICES",
              "NETWORKS",
              "APPLICATIONS",
              "DATA",
              "CROSS_CUTTING",
              "TBD",
            ])
            .optional(),
          maturityLevel: z
            .enum(["TRADITIONAL", "INITIAL", "ADVANCED", "OPTIMAL", "TBD"])
            .optional(),
          family: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const activeVersion = await resolveActiveCatalog(ctx.db);

      // Guidance is resolved by group key (pillar, functionGroup); prefetch once.
      const guidanceMap = await prefetchGuidance(ctx.db);

      const controls = await ctx.db.nistControl.findMany({
        where: {
          nistVersionId: activeVersion.id,
          parentControlId: null,
          status: "LIVE",
          ...(input?.family ? { controlFamilyId: input.family } : {}),
          ...(input?.pillar || input?.maturityLevel
            ? {
                ztMapping: {
                  ...(input.pillar ? { pillars: { has: input.pillar } } : {}),
                  // Maturity resolves via the affinity relation so a multi-maturity control
                  // matches ALL its maturities (the single representative maturityLevel would
                  // miss the others).
                  ...(input.maturityLevel
                    ? {
                        affinities: { some: { maturity: input.maturityLevel } },
                      }
                    : {}),
                },
              }
            : {}),
        },
        include: {
          controlFamily: true,
          // Affinities are needed so a maturity filter can surface the MATCHING tuple's
          // maturity + guidance (not the representative's, which may differ from the filter).
          ztMapping: { include: { affinities: true } },
        },
        orderBy: [{ controlFamilyId: "asc" }, { sortId: "asc" }],
      });

      const maturityFilter = input?.maturityLevel;

      return controls.map((ctrl) => {
        const zt = ctrl.ztMapping;
        if (!zt) {
          return {
            controlNumber: ctrl.controlNumber,
            controlName: ctrl.controlName,
            family: ctrl.controlFamily.id,
            familyName: ctrl.controlFamily.name,
            guidance: ctrl.discussion ?? null,
            ztMapping: null,
          };
        }

        // When filtering by maturity, display the tuple that actually matched the filter
        // (the row passed the `affinities: { some: { maturity } }` where-clause, so such a
        // tuple exists). Resolve that tuple's pillar/function/maturity so the shown maturity
        // and guidance agree with the filter — falling back to the representative otherwise.
        const matched = maturityFilter
          ? zt.affinities.find((a) => a.maturity === maturityFilter)
          : undefined;
        const pillars = matched ? [matched.pillar] : zt.pillars;
        const func = matched ? matched.function : zt.function;
        const maturity = matched ? matched.maturity : zt.maturityLevel;

        return {
          controlNumber: ctrl.controlNumber,
          controlName: ctrl.controlName,
          family: ctrl.controlFamily.id,
          familyName: ctrl.controlFamily.name,
          guidance: ctrl.discussion ?? null,
          ztMapping: {
            pillar: pillars.join(", "),
            function: func,
            maturityLevel: maturity,
            // null fallback (no placeholder) preserves the prior combined-view contract
            ztmmGuidance:
              resolveGuidance(pillars, func, maturity, "", guidanceMap) || null,
          },
        };
      });
    }),

  /**
   * Get the current active catalog version
   */
  getActiveVersion: publicProcedure.query(async ({ ctx }) => {
    const activeVersion = await resolveActiveCatalog(ctx.db);

    return {
      id: activeVersion.id,
      version: activeVersion.version,
      releaseDate: activeVersion.releaseDate,
      description: activeVersion.description,
      // Identity, added rather than substituted: no component reads these yet, and the
      // four fields above keep the values and names they already had.
      catalogKey: activeVersion.catalogKey,
      displayLabel: activeVersion.displayLabel,
      upstreamRevision: activeVersion.upstreamRevision,
      tailoringNote: activeVersion.tailoringNote,
    };
  }),
});

type ExportSelectionInput = z.infer<typeof exportSelectionSchema>;

/** A row of the export's selection. Only what the caller included is really there. */
type ExportRow = ControlRow & {
  parentControl:
    | (Pick<ControlRow, "referenceLinks" | "links"> & {
        controlNumber: string;
        parts?: PartRow[];
      })
    | null;
};

/**
 * The controls a selection exports, in export order: the picks, or the live base controls
 * the diagram's predicate passes, with their live enhancements as `enhancements` says. A
 * withdrawn control is exported when it is picked. The record and the export page's count
 * both read it, so the count is the file's.
 */
async function selectExportRows(
  prisma: typeof db,
  versionId: string,
  input: ExportSelectionInput,
  /** What the caller reads from each row; null to count, which loads only what the filter reads. */
  include:
    | (Prisma.NistControlInclude & {
        parentControl?: { select: Prisma.NistControlSelect };
      })
    | null,
): Promise<ExportRow[]> {
  // Starting points: the picks, or every base control the diagram's predicate passes.
  const bases = new Set<string>();
  const pickedEnhancements = new Set<string>();
  const picked = input.pick.length > 0;
  if (picked) {
    const wanted = new Set(input.pick.map(normalizeControlId));
    const found = new Set<string>();
    const all = await prisma.nistControl.findMany({
      where: { nistVersionId: versionId },
      select: { controlNumber: true, parentControlId: true },
    });
    for (const c of all) {
      const id = normalizeControlId(c.controlNumber);
      if (!wanted.has(id)) continue;
      found.add(id);
      (c.parentControlId ? pickedEnhancements : bases).add(c.controlNumber);
    }
    // A pick that matches nothing is refused, so a mistyped link cannot pass for a file.
    const unknown = input.pick.filter((p) => !found.has(normalizeControlId(p)));
    if (unknown.length > 0) {
      const named = unknown.slice(0, 10).map((p) => p.trim() || '""');
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No control matches ${named.join(", ")}${unknown.length > 10 ? ` and ${unknown.length - 10} more` : ""}.`,
      });
    }
  } else if (!isQueryActive(input)) {
    // Nothing narrows the view, so every live base control is in it.
    const all = await prisma.nistControl.findMany({
      where: {
        nistVersionId: versionId,
        parentControlId: null,
        status: "LIVE",
      },
      select: { controlNumber: true },
    });
    for (const c of all) bases.add(c.controlNumber);
  } else {
    // The diagram's rule: prose search only for free text of two characters or more.
    const q = input.q.trim();
    const serverMatches =
      q.length >= 2 && !isIdentifierQuery(q)
        ? new Set(
            (await searchCatalog(prisma, versionId, q)).map(
              (c) => c.controlNumber,
            ),
          )
        : undefined;
    for (const c of await loadBridgeControls(prisma, versionId, null)) {
      if (matchesQuery(c, input, serverMatches)) bases.add(c.id);
    }
  }

  // Only an enhancement a base brings in is filtered, by the facets it carries itself.
  const facets = { ...input, status: [], q: "" };
  const filtersEnhancements = !picked && isQueryActive(facets);

  const baseNumbers = [...bases];
  const args: Prisma.NistControlFindManyArgs = {
    where: {
      nistVersionId: versionId,
      OR: [
        ...(input.enhancements !== "only"
          ? [{ controlNumber: { in: baseNumbers } }]
          : []),
        // A base's enhancements as the diagram counts them: the live ones.
        ...(input.enhancements !== "without"
          ? [
              {
                status: "LIVE" as const,
                parentControl: { controlNumber: { in: baseNumbers } },
              },
            ]
          : []),
        { controlNumber: { in: [...pickedEnhancements] } },
      ],
    },
    ...(include
      ? {
          include: {
            ...include,
            ...(filtersEnhancements
              ? { ztMapping: DETAIL_INCLUDE.ztMapping }
              : {}),
            parentControl: {
              select: {
                controlNumber: true,
                ...(include.parentControl?.select ?? {}),
              },
            },
          },
        }
      : {
          select: {
            controlNumber: true,
            controlName: true,
            baselineLabels: true,
            ...(filtersEnhancements
              ? { ztMapping: DETAIL_INCLUDE.ztMapping }
              : {}),
            parentControl: { select: { controlNumber: true } },
          },
        }),
    // sortId leads with the family and puts a base before its enhancements.
    orderBy: [{ controlFamilyId: "asc" }, { sortId: "asc" }],
  };
  const rows = (await prisma.nistControl.findMany(
    args,
  )) as unknown as Array<ExportRow>;

  // A facet the enhancement carries itself (baseline, pillar, maturity, designation)
  // applies to it as well as to its base; status and search describe the base, as in
  // the diagram. Picks are exact: the facets are not applied to them or what they bring.
  return rows.filter((row) => {
    if (!filtersEnhancements || !row.parentControl) return true;
    const affinities = row.ztMapping?.affinities ?? [];
    return passesFacets(
      {
        id: row.controlNumber,
        name: row.controlName,
        status: "",
        family: familyOf(row.controlNumber),
        pillars: unique(
          affinities.length
            ? affinities.map((a) => a.pillar)
            : (row.ztMapping?.pillars ?? []),
        ),
        maturities: unique(
          affinities.length
            ? affinities.map((a) => a.maturity)
            : row.ztMapping
              ? [row.ztMapping.maturityLevel]
              : [],
        ),
        designations: unique(
          affinities.flatMap((a) => (a.designation ? [a.designation] : [])),
        ),
        baselines: row.baselineLabels,
      },
      facets,
    );
  });
}

/**
 * The export, kept out of appRouter so the tRPC HTTP handler does not serve it. A
 * whole-catalog record is expensive, and the file route's cache and build cap are what
 * bound that; a public procedure beside them would be a way around both. The route calls
 * it through createExportCaller (~/server/api/root), so it still runs publicProcedure's
 * middleware.
 */
export const exportRouter = createTRPCRouter({
  // Namespaced, so logs and boundary messages read "export.getExportRecord".
  export: createTRPCRouter({
    /**
     * The export record for a selection (~/lib/export/selection): the file route writes
     * it, and it runs as a procedure so it passes the same middleware as every read. A
     * selection by facets covers the live catalog, as the diagram does; a withdrawn control
     * is exported when it is picked.
     */
    getExportRecord: publicProcedure
      .input(exportSelectionSchema)
      .query(async ({ ctx, input }): Promise<ExportRecord> => {
        const activeVersion = await resolveActiveCatalog(ctx.db);

        // A dataset this deployment does not carry is dropped, never exported empty.
        const datasets = EXPORT_DATASETS.filter(
          (d) => input.data.includes(d) && LINE_DATASETS.includes(d),
        );
        const fields = EXPORT_FIELDS.filter(
          (f) => input.fields.includes(f) && LINE_FIELDS.includes(f),
        );
        const guidanceMap = await prefetchGuidance(ctx.db);

        const kept = await selectExportRows(ctx.db, activeVersion.id, input, {
          ...DETAIL_INCLUDE,
          ...(fields.includes("lineage") ? LINEAGE_INCLUDE : {}),
          // An enhancement inherits its base's references and frequencies, as the modal lists them.
          parentControl: {
            select: {
              links: DETAIL_INCLUDE.links,
              referenceLinks: DETAIL_INCLUDE.referenceLinks,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Prisma recursive include limitation
              parts: fields.includes("frequency") ? PARTS_INCLUDE : false,
            },
          },
        });

        // A filtered export keeps only the Zero Trust rows the pillar, maturity and designation facets select.
        const tupleFilter =
          input.pick.length === 0 &&
          (input.pillar.length > 0 ||
            input.maturity.length > 0 ||
            input.designation.length > 0);

        return {
          catalog: activeVersion.displayLabel,
          versionId: activeVersion.id,
          datasets,
          fields,
          ...(tupleFilter ? { zeroTrustFiltered: true } : {}),
          controls: kept.map((row) => {
            const control = toExportControl(
              mapControl(row, guidanceMap),
              row.parentControl
                ? {
                    id: row.parentControl.controlNumber,
                    ...mapLinks(row.parentControl),
                    frequency: row.parentControl.parts
                      ? frequencyFromParts(row.parentControl.parts.map(mapPart))
                      : null,
                  }
                : null,
              datasets,
              fields,
            );
            // A control matching the facets only on different rows exports none; the DOCX says so.
            return tupleFilter && control.zeroTrust
              ? {
                  ...control,
                  zeroTrust: control.zeroTrust.filter((t) =>
                    tuplePasses(t, input),
                  ),
                }
              : control;
          }),
        };
      }),
  }),
});
