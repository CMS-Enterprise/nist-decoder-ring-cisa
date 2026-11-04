import {
  lineageLines,
  type ControlLineage,
} from "~/app/_components/decoder-ring/lineage-text";
import { withBaseLinks } from "~/app/_components/decoder-ring/link-identity";
import type { FrequencyInfo } from "~/server/api/frequency";
import {
  familyOf,
  type ExportControl,
  type ExportDataset,
  type ExportField,
  type ExportFrequency,
  type ExportParameter,
  type ExportReference,
  type ExportTuple,
} from "./record";

/**
 * The adapter: a control as getControlById returns it, into the export record.
 * The server's export and the modal's Copy both call it, so the two cannot drift. The
 * field names here are this catalog's own; the record's do not depend on the catalog.
 */

/** What the schema carries: every dataset, SP 800-53A included. */
export const LINE_DATASETS: readonly ExportDataset[] = [
  "statement",
  "assessment",
  "zeroTrust",
  "references",
];

/** The per-control details the catalog has. NIST assigns no priority. */
export const LINE_FIELDS: readonly ExportField[] = [
  "baselines",
  "frequency",
  "lineage",
];

// The catalog's discussion writes its links as markdown, `[AC-11](#ac-11)` for a cross-reference.
// A file has nowhere to follow an anchor, so each becomes its label, as the modal shows it;
// an outward link keeps its address unless the label already is it.
const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function plainDiscussion(text: string): string {
  return text.replace(MARKDOWN_LINK_RE, (_, label: string, target: string) =>
    target.startsWith("#") || target.endsWith(label)
      ? label
      : `${label} (${target})`,
  );
}

// The modal's names for SP 800-53A's three methods.
const METHOD_LABEL: Record<string, string> = {
  EXAMINE: "Examine",
  INTERVIEW: "Interview",
  TEST: "Test",
};

type LinkSource = { label: string; url: string; citation?: string | null };

interface PartSource {
  parameters: Array<{
    label: string;
    values: Array<{ baselines: string[]; value: string }>;
  }>;
  children: PartSource[];
}

export interface DetailSource {
  id: string;
  oscalId?: string | null;
  name: string;
  description: string;
  discussion: string | null;
  baselines: string[];
  /** Absent on the layer cake's pre-load. */
  frequency?: FrequencyInfo | null;
  catalogStatus?: "live" | "withdrawn";
  lineage?: ControlLineage | null;
  parts: PartSource[];
  ztMapping?: {
    pillar: string;
    function: string;
    maturity: string;
    guidance: string;
    affinities?: ExportTuple[];
  };
  assessment?: {
    objectives: Array<{ identifier: string; text: string }>;
    methods: Array<{ method: string; text: string | null }>;
  };
  ztLinks: LinkSource[];
  nistLinks: LinkSource[];
}

/** An enhancement's base control: its id and the references the enhancement inherits. */
export type BaseSource = Pick<
  DetailSource,
  "id" | "ztLinks" | "nistLinks" | "frequency"
>;

function collectParameters(parts: PartSource[]): ExportParameter[] {
  return parts.flatMap((part) => [
    ...part.parameters.map((p) => ({
      label: p.label,
      values: p.values.map((v) => ({ baselines: v.baselines, value: v.value })),
    })),
    ...collectParameters(part.children),
  ]);
}

// The layer cake's pre-load carries only the representative tuple; the full detail carries every one.
function tuplesOf(zt: DetailSource["ztMapping"]): ExportTuple[] {
  if (!zt) return [];
  if (zt.affinities?.length) {
    return zt.affinities.map((a) => ({
      pillar: a.pillar,
      function: a.function,
      maturity: a.maturity,
      guidance: a.guidance,
      designation: a.designation ?? null,
      ifApplicable: a.ifApplicable ?? false,
    }));
  }
  return [
    {
      pillar: zt.pillar,
      function: zt.function,
      maturity: zt.maturity,
      guidance: zt.guidance,
    },
  ];
}

// The frequencies the statement leaves to the organization, as the modal's Frequency row
// lists them: an enhancement with none of its own shows its base's, named by the base.
function frequenciesOf(
  detail: DetailSource,
  base: BaseSource | null,
): ExportFrequency[] {
  const own = detail.frequency?.nist ?? [];
  const inherited =
    own.length === 0 && base ? (base.frequency?.nist ?? []) : [];
  // Named in words, as "AC-02(c)" alone would read as an enhancement's id.
  const where = (part: string | null) => (part ? `item ${part}` : "statement");
  return (own.length > 0 ? own : inherited).map((f) => ({
    pane: "catalog",
    label: own.length > 0 ? where(f.part) : `${base!.id} ${where(f.part)}`,
    // Bracketed, as the statement sets its parameters, where the modal sets it in italics.
    value:
      [f.before, f.parameter && `[${f.parameter}]`].filter(Boolean).join(" ") +
      (f.after ? (/^[,.;:]/.test(f.after) ? "" : " ") + f.after : ""),
  }));
}

// One pane's references as the modal lists them, so every output inherits the same way.
function paneReferences(
  pane: ExportReference["pane"],
  own: LinkSource[],
  base: LinkSource[] | null,
): ExportReference[] {
  return withBaseLinks(own, base).map((l) => ({
    pane,
    label: l.label,
    url: l.url,
    citation: l.citation ?? null,
    ...(l.scope ? { scope: l.scope } : {}),
  }));
}

export function toExportControl(
  detail: DetailSource,
  base: BaseSource | null,
  datasets: readonly ExportDataset[],
  fields: readonly ExportField[],
): ExportControl {
  const has = (d: ExportDataset) => datasets.includes(d);
  const shows = (f: ExportField) => fields.includes(f);
  return {
    id: detail.id,
    oscalId: detail.oscalId ?? null,
    name: detail.name,
    family: familyOf(detail.id),
    baseId: base?.id ?? null,
    baselines: shows("baselines") ? detail.baselines : undefined,
    frequency: shows("frequency") ? frequenciesOf(detail, base) : undefined,
    lineage: shows("lineage")
      ? lineageLines(detail.catalogStatus, detail.lineage)
      : undefined,
    statement: has("statement")
      ? {
          text: detail.description,
          discussion: detail.discussion && plainDiscussion(detail.discussion),
          parameters: collectParameters(detail.parts),
        }
      : undefined,
    // The pre-load carries no assessment; an empty one says the publication has none.
    assessment: has("assessment")
      ? {
          objectives: (detail.assessment?.objectives ?? []).map((o) => ({
            identifier: o.identifier.replace(/^DS-/, ""),
            text: o.text,
          })),
          methods: (detail.assessment?.methods ?? []).map((m) => ({
            method: METHOD_LABEL[m.method] ?? m.method,
            text: m.text,
          })),
        }
      : undefined,
    zeroTrust: has("zeroTrust") ? tuplesOf(detail.ztMapping) : undefined,
    references: has("references")
      ? [
          ...paneReferences("zeroTrust", detail.ztLinks, base?.ztLinks ?? null),
          ...paneReferences(
            "catalog",
            detail.nistLinks,
            base?.nistLinks ?? null,
          ),
        ]
      : undefined,
  };
}
