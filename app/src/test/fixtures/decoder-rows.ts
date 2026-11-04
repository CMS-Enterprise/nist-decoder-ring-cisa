/**
 * Prisma-row fixture builders for the decoder router tests.
 *
 * These build the shapes the router *consumes* — the rows Prisma hands back —
 * not the shapes it returns to the client. Both halves of the suite previously
 * defined these inline, and the copies had drifted: one builder accepted any
 * key and silently ignored all but five, so seventeen call sites were passing
 * fields that had been dropped from the model without a single test noticing.
 *
 * Every builder here is typed against the router's own row interfaces
 * (`ControlRow`, `PartRow`, and so on from `decoder.ts`). That is the whole
 * point: rename or drop a field the router reads and this file fails to
 * compile, along with every call site that supplied it. Add a field with a
 * default and nothing here needs to change.
 *
 * The router casts Prisma results into those interfaces through an `any`-typed
 * include tree, so they — not a `Prisma.XGetPayload` — are the truth about what
 * the mapping code reads.
 *
 * Deliberate behaviours preserved from the originals, because tests rely on them:
 *   - `makePart` coalesces `prose ?? default`, so `prose: null` cannot be
 *     expressed through it. Tests that need a null prose build the row inline.
 *   - `makeParameter` and `makeGuidance` use `"key" in overrides` for nullable
 *     columns, so an explicit `null` is honoured rather than coalesced.
 *   - `makeZtMapping` always returns an `affinities` array; the router calls
 *     `.map()` on it.
 */

import type {
  ReferenceLinkRow,
  ControlRow,
  ParameterRow,
  PartRow,
  ZTMappingRow,
  ZTMMGuidanceRow,
} from "~/server/api/routers/decoder";
import { CATALOG_MARKERS } from "~/config/catalog-vocabulary";

/**
 * The single active NistVersion row. Dates are fixed rather than `new Date()` so
 * two runs of the suite produce byte-identical fixtures.
 */
export const ACTIVE_VERSION = {
  id: "ver-1",
  version: "5.1",
  catalogKey: "nist-800-53-r5",
  displayLabel: "NIST SP 800-53 Rev 5",
  upstreamRevision: "NIST SP 800-53 Rev 5",
  tailoringNote: "Catalog-specific parameter values and a privacy baseline.",
  releaseDate: new Date("2024-01-15T00:00:00.000Z"),
  isActive: true,
  description: "NIST SP 800-53 Rev 5",
  createdAt: new Date("2024-01-15T00:00:00.000Z"),
  updatedAt: new Date("2024-01-15T00:00:00.000Z"),
};

/**
 * What the router's control queries hand back: the `getControlById` row
 * (`ControlRow`) plus the fields `getBridgeData` additionally reads. The `id` is
 * the Prisma cuid, which `getControlById` uses to fetch enhancements by parent.
 */
export type ControlFixture = ControlRow & {
  id: string;
  sortId: string;
  controlFamilyId: string;
  controlFamily: { id: string; name: string; sortOrder: number };
  parentControlId: string | null;
  nistVersionId: string;
  /** The `children` select from `getBridgeData`: each enhancement's baselines and whether it is ZT-mapped. */
  children: Array<{
    baselineLabels: string[];
    ztMapping: { id: string } | null;
  }>;
};

export type ZtMappingFixture = ZTMappingRow & { id: string };

/** Overrides are row fields, so a renamed column fails here at compile time. */
export type ControlOverrides = Partial<
  Pick<
    ControlFixture,
    | "controlNumber"
    | "controlName"
    | "controlFamilyId"
    | "sortId"
    | "parentControlId"
    | "ztMapping"
    | "children"
    | "parts"
    | "links"
    | "referenceLinks"
    | "reviewFrequency"
    | "assessmentFrequency"
    | "priority"
    | "discussion"
    | "oscalId"
    | "assessmentObjectives"
    | "assessmentMethods"
    | "baselineLabels"
  >
> & {
  /** Convenience: sets `controlFamily.name` without spelling out the object. */
  familyName?: string;
};

export function makeControl(overrides: ControlOverrides = {}): ControlFixture {
  const controlNumber = overrides.controlNumber ?? "AC-01";
  const familyId = overrides.controlFamilyId ?? "AC";
  return {
    id: `ctrl-${controlNumber}`,
    controlNumber,
    controlName: overrides.controlName ?? `${controlNumber} Control`,
    oscalId:
      overrides.oscalId ?? controlNumber.toLowerCase().replace(/-0?/, "-"),
    discussion: overrides.discussion ?? null,
    baselineLabels: overrides.baselineLabels ?? [],
    sortId: overrides.sortId ?? controlNumber.toLowerCase(),
    controlFamilyId: familyId,
    controlFamily: {
      id: familyId,
      name: overrides.familyName ?? `${familyId} Family`,
      sortOrder: 1,
    },
    parentControlId: overrides.parentControlId ?? null,
    nistVersionId: ACTIVE_VERSION.id,
    ztMapping: overrides.ztMapping ?? null,
    children: overrides.children ?? [],
    parts: overrides.parts ?? [],
    links: overrides.links ?? [],
    referenceLinks: overrides.referenceLinks ?? [],
    reviewFrequency: overrides.reviewFrequency ?? null,
    assessmentFrequency: overrides.assessmentFrequency ?? null,
    priority: overrides.priority ?? null,
    assessmentObjectives: overrides.assessmentObjectives ?? [],
    assessmentMethods: overrides.assessmentMethods ?? [],
  };
}

/**
 * A ZeroTrustMapping row with its per-tuple affinities. `affinities` defaults to
 * `[]`, which keeps single-representative tests working; multi-tuple tests pass
 * it explicitly. Reference links live on the control (`referenceLinks`), not here.
 */
type AffinityRow = ZtMappingFixture["affinities"][number];

/** A tuple as a test writes it: CISA's designation and If Applicable flag default to none. */
export type AffinityOverride = Omit<
  AffinityRow,
  "designation" | "ifApplicable"
> &
  Partial<Pick<AffinityRow, "designation" | "ifApplicable">>;

export function makeZtMapping(
  overrides: Partial<Omit<ZtMappingFixture, "affinities">> & {
    affinities?: AffinityOverride[];
  } = {},
): ZtMappingFixture {
  return {
    id: overrides.id ?? "zt-1",
    pillars: overrides.pillars ?? ["IDENTITY"],
    function: overrides.function ?? "Authentication",
    maturityLevel: overrides.maturityLevel ?? "ADVANCED",
    affinities: (overrides.affinities ?? []).map((a) => ({
      designation: null,
      ifApplicable: false,
      ...a,
    })),
  };
}

/**
 * A ControlPart row as `PARTS_INCLUDE` returns it, with the `_count` relation.
 * Coalesces with `??`, so a caller cannot produce `prose: null` or `label: null`
 * through this builder — tests that need those build the row inline.
 */
export function makePart(overrides: Partial<PartRow> = {}): PartRow {
  return {
    id: overrides.id ?? "part-1",
    oscalPartId: overrides.oscalPartId ?? "ac-2_smt",
    label: overrides.label ?? null,
    name: overrides.name ?? "statement",
    prose: overrides.prose ?? "Establish access control policy.",
    sortOrder: overrides.sortOrder ?? 0,
    parameters: overrides.parameters ?? [],
    children: overrides.children ?? [],
    _count: overrides._count ?? { ztCoverages: 0 },
  };
}

/**
 * Per-baseline inputs to `makeParameter`. Callers pass low/moderate/high/privacy for
 * readability; the builder groups them into the normalized `values` rows the
 * router reads — consecutive baselines sharing a value collapse into one row, and
 * a `null` baseline contributes none.
 */
export type ParameterOverrides = Partial<
  Pick<ParameterRow, "id" | "label" | "position"> & {
    low: string | null;
    moderate: string | null;
    high: string | null;
    privacy: string | null;
  }
>;

export function makeParameter(
  overrides: ParameterOverrides = {},
): ParameterRow {
  const low = "low" in overrides ? overrides.low! : "annually";
  const moderate =
    "moderate" in overrides ? overrides.moderate! : "semi-annually";
  const high = "high" in overrides ? overrides.high! : "quarterly";
  const privacy = "privacy" in overrides ? overrides.privacy! : "monthly";

  const ordered: Array<[string, string | null]> = [
    ["LOW", low],
    ["MODERATE", moderate],
    ["HIGH", high],
    ["PRIVACY", privacy],
  ];
  const values: ParameterRow["values"] = [];
  for (const [baseline, value] of ordered) {
    if (value === null) continue;
    const prev = values[values.length - 1];
    if (prev?.value === value) prev.baselines.push(baseline);
    else values.push({ baselines: [baseline], value });
  }

  return {
    id: overrides.id ?? "param-1",
    label: overrides.label ?? "time period",
    position: overrides.position ?? 0,
    values,
  };
}

/**
 * A columnar ZTMMGuidance row. Singletons have `functionGroup === function`;
 * multi-part groups pass `functionGroup` explicitly. Maturity columns use
 * `"key" in overrides` so an explicit `null` is honoured.
 */
export function makeGuidance(
  overrides: Partial<ZTMMGuidanceRow> = {},
): ZTMMGuidanceRow {
  const fn = overrides.function ?? "Identity Management";
  return {
    pillar: overrides.pillar ?? "IDENTITY",
    function: fn,
    functionGroup: overrides.functionGroup ?? fn,
    base: overrides.base ?? "Base prose for identity management.",
    traditional: "traditional" in overrides ? overrides.traditional! : null,
    initial: "initial" in overrides ? overrides.initial! : null,
    advanced: "advanced" in overrides ? overrides.advanced! : null,
    optimal: "optimal" in overrides ? overrides.optimal! : null,
  };
}

/** One NistControlLink junction row joined to its ReferenceLink. */
export function makeReferenceLink(
  overrides: Partial<ReferenceLinkRow> = {},
): ReferenceLinkRow {
  return {
    displayOrder: overrides.displayOrder ?? 1,
    link: overrides.link ?? {
      title: "Reference",
      url: "https://docs.example.gov/example",
      domain: "NIST",
      description: null,
    },
  };
}

/**
 * Poison: rows that carry catalog vocabulary, for proving the server-side
 * boundary refuses them. Built from the shared term list at test time, never
 * spelled out: a literal here would trip the source gate, and it would also be
 * a second list that keeps proving the old term after the list changes.
 *
 * Three vectors, because against the real seed two of them are vacuously clean
 * (this line seeds no link on the other product's hosts and no baseline outside
 * the enum), and a test without the poison would pass while proving nothing.
 */
const POISON_HOST = CATALOG_MARKERS.find((m) => m.includes("."))!;
const POISON_WORD = CATALOG_MARKERS.find((m) => /^[A-Za-z]+$/.test(m))!;

/** A NistLink row whose URL sits on one of the other product's hosts. */
export function poisonedLink(): ControlRow["links"][number] {
  return {
    title: "Policy",
    url: `https://${POISON_HOST}/policy`,
    description: null,
    resolvedUrl: null,
    contentType: null,
    displayOrder: 1,
  };
}

/** A ReferenceLink junction row (the ZT pane's links) on the same host. */
export function poisonedReferenceLink(): ReferenceLinkRow {
  return makeReferenceLink({
    link: {
      title: "Guide",
      url: `https://${POISON_HOST}/guide`,
      domain: "EXTERNAL",
      description: null,
    },
  });
}

/** Discussion prose that names the other product. */
export function poisonedDiscussion(): string {
  return `Implement this per ${POISON_WORD} practice.`;
}

/** A baseline token the other product uses and this line's enum does not. */
export function poisonedBaseline(): string {
  return POISON_WORD;
}
