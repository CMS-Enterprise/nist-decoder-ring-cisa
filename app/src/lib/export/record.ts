/**
 * What a selection exports as. One record feeds the XLSX writer, the DOCX writer and the
 * Copy button, so a field a reader sees in one appears in all three.
 *
 * Catalog-agnostic: each catalog's adapter fills it from its own query shape, and the
 * writers read nothing else. A dataset left out of `datasets` leaves its field undefined
 * on every control; a dataset included but empty for a control is an empty array. A
 * field left out of `fields`, or one this app does not carry, is likewise undefined.
 */

export const EXPORT_DATASETS = [
  "statement",
  "assessment",
  "zeroTrust",
  "references",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** Per-control details a reader can leave out; each catalog offers the ones it has. */
export const EXPORT_FIELDS = [
  "baselines",
  "frequency",
  "priority",
  "lineage",
  "related",
] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

export interface ExportParameter {
  label: string;
  values: Array<{ baselines: string[]; value: string }>;
}

export interface ExportTuple {
  pillar: string;
  function: string;
  maturity: string;
  guidance: string;
  /** CISA's designation, on a line that maps CISA's tuples; null where CISA gives none. */
  designation?: string | null;
  /** CISA marks the tuple If Applicable. */
  ifApplicable?: boolean;
}

// The modal's labels for CISA's designations.
const DESIGNATION_LABELS: Record<string, string> = {
  KEY: "Key",
  SUPPORTING: "Supporting",
  INFORMATIVE: "Informative",
};

/** A tuple's CISA designation and If Applicable as the modal labels them; empty without CISA's mapping. */
export function cisaLabels(t: ExportTuple): string[] {
  if (t.designation === undefined) return [];
  return [
    (t.designation && DESIGNATION_LABELS[t.designation]) ?? "Unassigned",
    ...(t.ifApplicable ? ["If applicable"] : []),
  ];
}

export interface ExportReference {
  /** Which pane lists it: the catalog's own references, or the Zero Trust mapping's. */
  pane: "catalog" | "zeroTrust";
  label: string;
  url: string;
  citation: string | null;
  /** On an enhancement: its own reference, or one inherited from its base control. */
  scope?: "enhancement" | "base";
}

/** SP 800-53A content as the modal shows it: identifiers and method names as labelled
 *  there. A method's text is null when the publication provides none. */
export interface ExportAssessment {
  objectives: Array<{ identifier: string; text: string }>;
  methods: Array<{ method: string; text: string | null }>;
}

/** One frequency as a pane states it. */
export interface ExportFrequency {
  pane: "catalog" | "zeroTrust";
  /** What it governs: a review or an assessment, or the statement item that asks for it. */
  label: string;
  /** Null where the source defines none. */
  value: string | null;
}

/** A related control; its name is null when this catalog does not select it. */
export interface ExportRelated {
  id: string;
  name: string | null;
}

export interface ExportControl {
  id: string;
  oscalId: string | null;
  name: string;
  family: string;
  /** The base control's id on an enhancement; null on a base control. */
  baseId: string | null;
  baselines?: string[];
  frequency?: ExportFrequency[];
  /** Null when the catalog assigns none. */
  priority?: string | null;
  /** Withdrawn status and where the content went, as lines of text; empty for a live control with none. */
  lineage?: string[];
  /** The catalog's related controls: the ones it selects, then the ones it does not. */
  related?: ExportRelated[];
  statement?: {
    text: string;
    discussion: string | null;
    parameters: ExportParameter[];
  };
  assessment?: ExportAssessment;
  zeroTrust?: ExportTuple[];
  references?: ExportReference[];
}

export interface ExportRecord {
  /** The catalog's own display label. */
  catalog: string;
  /** The catalog version it was read from; a cached file is keyed by it. */
  versionId: string;
  datasets: ExportDataset[];
  fields: ExportField[];
  /** A filter limited each control's Zero Trust rows to the ones matching it. */
  zeroTrustFiltered?: boolean;
  controls: ExportControl[];
}

/** "Catalog Review", "Zero Trust Assessment": a frequency's pane and what it governs, as one label. */
export const frequencyLabel = (f: ExportFrequency): string =>
  `${f.pane === "catalog" ? "Catalog" : "Zero Trust"} ${f.label}`;

/** What every output says for a frequency its source does not define. */
export const NO_FREQUENCY = "not defined";

/** What the DOCX says for a control with no Zero Trust row matching every filter. */
export const NO_MATCHING_ROW =
  "No Zero Trust row matches all the selected filters.";

/** What Copy and the DOCX say for a control the catalog assigns no priority. */
export const NO_PRIORITY = "none assigned";

/** "AC-02(01)" -> "AC". */
export const familyOf = (id: string): string => id.slice(0, 2).toUpperCase();
