/**
 * OSCAL wire types and this pipeline's internal representation.
 *
 * The wire half describes what the published NIST catalog actually contains at
 * OSCAL 1.2.2 — only the parts this pipeline reads, and no more, so an unread
 * field never looks supported. The internal half is what the writers consume.
 *
 * Deliberately independent of any other generator's types. OSCAL catalogs'
 * shapes rhyme, but sharing the declarations would mean sharing every future
 * change to either, which is the coupling this pipeline exists to avoid.
 */

// ---- OSCAL wire shapes --------------------------------------------------------

export interface OscalProp {
  name: string;
  value: string;
  class?: string;
  ns?: string;
}

export interface OscalLink {
  href: string;
  rel?: string;
  text?: string;
}

/** A parameter's constrained selection, e.g. "one or more of: a; b; c". */
export interface OscalSelect {
  "how-many"?: "one" | "one-or-more";
  choice?: string[];
}

export interface OscalParam {
  id: string;
  label?: string;
  props?: OscalProp[];
  select?: OscalSelect;
  guidelines?: { prose?: string }[];
  values?: string[];
}

export interface OscalPart {
  id?: string;
  name: string;
  prose?: string;
  props?: OscalProp[];
  parts?: OscalPart[];
  links?: OscalLink[];
}

export interface OscalControl {
  id: string;
  title: string;
  class?: string;
  props?: OscalProp[];
  links?: OscalLink[];
  params?: OscalParam[];
  parts?: OscalPart[];
  controls?: OscalControl[];
}

export interface OscalGroup {
  id: string;
  title: string;
  class?: string;
  props?: OscalProp[];
  params?: OscalParam[];
  controls?: OscalControl[];
  groups?: OscalGroup[];
}

export interface OscalMetadata {
  title: string;
  version: string;
  "oscal-version": string;
  "last-modified": string;
  published?: string;
  revisions?: {
    version?: string;
    published?: string;
    "last-modified"?: string;
  }[];
}

/** A back-matter resource: what a control's `rel="reference"` link points at. */
export interface OscalResource {
  uuid: string;
  title: string;
  citation?: { text: string };
  rlinks?: { href: string; "media-type"?: string }[];
}

export interface OscalCatalog {
  catalog: {
    uuid: string;
    metadata: OscalMetadata;
    groups?: OscalGroup[];
    controls?: OscalControl[];
    "back-matter"?: { resources?: OscalResource[] };
  };
}

/** A profile's include list. NIST's four baselines use `with-ids` exclusively,
 *  but the other selectors are valid OSCAL and must be detected, not ignored. */
export interface OscalSelectControlById {
  "with-ids"?: string[];
  "with-child-controls"?: string;
  matching?: { pattern?: string }[];
}

export interface OscalImport {
  href: string;
  "include-all"?: Record<string, unknown>;
  "include-controls"?: OscalSelectControlById[];
  "exclude-controls"?: OscalSelectControlById[];
}

export interface OscalProfile {
  profile: {
    uuid: string;
    metadata: OscalMetadata;
    imports: OscalImport[];
    merge?: Record<string, unknown>;
    modify?: Record<string, unknown>;
  };
}

// ---- Internal representation --------------------------------------------------

/** Why a control is no longer current, and where its content went. Parsed with
 *  the rest of the catalog so the counts reconcile and the report is complete,
 *  and written as rows to 15-withdrawn-controls.sql. */
export interface Withdrawal {
  /** The relation the catalog states. Null when it withdraws with no successor. */
  relation: "incorporated-into" | "moved-to" | null;
  /** Successor ids, verbatim from the link hrefs with the leading `#` stripped.
   *  Usually control ids; one in Rev 5.2.0 is a statement part id. */
  targets: string[];
}

/** How a lineage row relates its control, matching the schema's LineageKind. */
export type LineageKind =
  "INCORPORATED_INTO" | "MOVED_TO" | "ADDED" | "DROPPED";

/** One relation the catalog records about a control. */
export interface LineageRow {
  /** The control the row is about, e.g. "AC-02(10)". */
  controlNumber: string;
  kind: LineageKind;
  /** The successor for INCORPORATED_INTO and MOVED_TO: a control number, or a family
   *  code where the catalog names a whole family. Null for ADDED and DROPPED. */
  relatedControlNumber: string | null;
  /** Where the catalog names one item of the successor's statement rather than the whole
   *  control, that item's OSCAL part id, e.g. "ac-2_smt.k". Null otherwise. */
  relatedPartOscalId: string | null;
  /** The release that records it, e.g. "5.2.0". */
  release: string;
  /** The release compared against, for ADDED and DROPPED. */
  sinceRelease: string | null;
}

export interface ParsedPart {
  /** The OSCAL part id, e.g. "ac-2_smt.a". Unique across the catalog. */
  oscalPartId: string;
  /** OSCAL part vocabulary: "statement" for the root, "item" for lettered content. */
  name: string;
  /** The display label, e.g. "a." — absent on the statement root. */
  label: string | null;
  prose: string | null;
  sortOrder: number;
  children: ParsedPart[];
}

export interface ParsedControl {
  /** Display control number from the zero-padded label, e.g. "AC-02(01)". */
  controlNumber: string;
  controlName: string;
  /** The OSCAL identifier, e.g. "ac-2.1". */
  oscalId: string;
  /** Lowercase sort key from the catalog's own sort-id prop. */
  sortId: string;
  /** The catalog's guidance prose for this control. */
  guidance: string | null;
  /** Parent control's OSCAL id when this is an enhancement, else null. */
  parentOscalId: string | null;
  /** Family (group) id, e.g. "ac". */
  familyId: string;
  /** Baseline names from the SP 800-53B profiles, in published order. */
  baselineLabels: string[];
  /** Related control numbers from `rel="related"` links, upper-cased. */
  relatedControls: string[];
  statementParts: ParsedPart[];
  /** Set when the catalog marks the control withdrawn; undefined when live. */
  withdrawal?: Withdrawal;
}

export interface ParsedFamily {
  id: string;
  name: string;
}

// ---- CPRT wire shapes (SP 800-53A assessment procedures) ----------------------

/** The CPRT common schema: four flat arrays. Every element carries a type, an
 *  identifier that is a business key within its document, and text; the graph
 *  between them lives entirely in `relationships`. */
export interface CprtDocument {
  doc_identifier: string;
  name: string;
  version: string;
  website: string;
}

export interface CprtElement {
  doc_identifier: string;
  element_type: string;
  element_identifier: string;
  title: string;
  text: string;
}

export interface CprtRelationship {
  source_doc_identifier: string;
  source_element_identifier: string;
  dest_doc_identifier: string;
  dest_element_identifier: string;
  provenance_doc_identifier: string;
  relationship_identifier: string;
}

export interface CprtExport {
  response: {
    requestType?: string;
    elements: {
      documents: CprtDocument[];
      elements: CprtElement[];
      relationships: CprtRelationship[];
      relationship_types: {
        relationship_identifier: string;
        description: string;
      }[];
    };
  };
}

// ---- Internal representation: assessment procedures ---------------------------

/** One determination statement from SP 800-53A: the assessor's yes/no question
 *  for a control statement. Attaches to the control, and to the lettered part
 *  its source statement corresponds to when there is one. */
export interface ParsedObjective {
  /** The CPRT identifier, e.g. "DS-AC-02a.[01]". Kept for traceability. */
  cprtIdentifier: string;
  /** Display control number of the owning control, e.g. "AC-02". */
  controlNumber: string;
  /** OSCAL part id the source statement maps to, or null when the statement is
   *  the control's root (single-block controls and most enhancements). */
  oscalPartId: string | null;
  /** Rendered text: ODP references become bracketed Assignment/Selection markers. */
  text: string;
  /** Position within the control, in the publication's order. */
  sortOrder: number;
}

export type AssessmentMethodKind = "EXAMINE" | "INTERVIEW" | "TEST";

/** One assessment method entry: the "[SELECT FROM: ...]" list of objects an
 *  assessor examines, people they interview, or mechanisms they test. */
export interface ParsedMethod {
  cprtIdentifier: string;
  controlNumber: string;
  method: AssessmentMethodKind;
  text: string;
}

/** Where an ODP reference in a determination was, and what it became. */
export interface OdpResolution {
  cprtIdentifier: string;
  odpId: string;
  rendered: string | null;
}
