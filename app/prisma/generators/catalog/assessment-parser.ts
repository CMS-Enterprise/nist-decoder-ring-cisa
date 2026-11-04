/**
 * SP 800-53A assessment procedures, read from the CPRT export into this
 * pipeline's internal representation.
 *
 * The export is a flat graph: `control` and `control_enhancement` elements
 * project to `control_statement` elements (nested the way the OSCAL statement
 * tree nests), statements project to `determination` elements, and each control
 * projects to at most one `examine`, `interview` and `test` element. Nothing in
 * it is authoritative about the catalog; every control and statement it names
 * has to resolve against what the catalog pipeline already seeded, or the run
 * fails naming the offender. A procedure attached to a control that does not
 * exist is not a warning, it is the seed asserting something false.
 *
 * Reading stops at what this pipeline emits. Organization-defined parameters
 * (`odp`, `odp_statement`, `odp_type`) are consulted only to render the
 * references inside determination text; `sort` and `related` are the catalog's
 * own data restated and are not read at all.
 */

import type {
  AssessmentMethodKind,
  CprtElement,
  CprtExport,
  OdpResolution,
  ParsedControl,
  ParsedMethod,
  ParsedObjective,
} from "./types.js";

/** The one document this reader accepts. Anything else is a different
 *  publication and would need its own measurements and floors. */
export const CPRT_DOC_IDENTIFIER = "SP_800_53_A_5_2_0";

/**
 * Upstream defects known at the pin, each with the reason it is tolerated.
 * Declared, so a new defect fails the run instead of joining these quietly.
 *
 * These four determinations carry literal asterisks in their identifiers and no control statement projects to them. They are unreachable, so they cannot be attached, and are counted rather than emitted.
 */
export const KNOWN_ORPHAN_DETERMINATIONS: ReadonlySet<string> = new Set([
  "DS-IA-*[05]",
  "DS-IA-*[06]",
  "DS-IA-*(*)[01]",
  "DS-IA-*(*)[02]",
]);

/**
 * Identifiers the export republishes verbatim: every copy is byte-identical in type, title and text, so keeping the first loses nothing.
 *
 * Kept separate from the divergent list below because they are different problems. A republished identical row is noise; an identifier carrying two different texts is a silent content loss, and conflating the two is how the second hides inside the first.
 */
export const KNOWN_IDENTICAL_DUPLICATES: ReadonlySet<string> = new Set([
  "IA-13_ODP[01]",
  "IA-13_ODP[02]",
  "OS-IA-13_odp[01]",
  "OS-IA-13_odp[02]",
]);

/**
 * Identifiers the export publishes more than once with DIFFERENT text. First-wins deduplication drops the rest, so every one of these is a content loss waiting to happen.
 *
 * `DS-IA-*(*)[01]` carries two unrelated determinations under one identifier. Nothing ships wrong today only because it is also unreachable and therefore never emitted, and a coincidence is not a safeguard: `divergentDuplicatesEmitted` asserts that coupling on every run rather than trusting it.
 */
export const KNOWN_DIVERGENT_DUPLICATES: ReadonlySet<string> = new Set([
  "DS-IA-*(*)[01]",
]);

const METHOD_PREFIX: Readonly<Record<string, AssessmentMethodKind>> = {
  E: "EXAMINE",
  I: "INTERVIEW",
  T: "TEST",
};

const METHOD_TYPES: Readonly<Record<AssessmentMethodKind, string>> = {
  EXAMINE: "examine",
  INTERVIEW: "interview",
  TEST: "test",
};

// ---- Index --------------------------------------------------------------------

/** One identifier the export published more than once within a single element type. */
export interface DuplicateElement {
  identifier: string;
  elementType: string;
  copies: number;
  /** True when every copy carries the same title and text, so keeping the first loses nothing. */
  identical: boolean;
}

/** The export, indexed for the reads below. Built once per run. */
export interface CprtIndex {
  version: string;
  byType: Map<string, Map<string, CprtElement>>;
  /** Outgoing `projection` edges, source identifier -> destination identifiers, in export order. */
  projections: Map<string, string[]>;
  /** Identifiers that appeared more than once within one element type, and whether the copies agree. */
  duplicates: DuplicateElement[];
  /**
   * Relationship endpoints naming no element in the export, as `source:<id>` or `dest:<id>`.
   *
   * Collected rather than filtered away. A projection whose target does not exist is a hole in the export, and the reads below would otherwise drop it silently: `projectedOfType` cannot tell "this target is a different element type, which is expected" from "this target is nothing at all, which is not".
   */
  danglingEndpoints: string[];
}

/** Read and index the export, refusing a document that is not the one this
 *  reader was measured against. */
export function indexExport(raw: CprtExport): CprtIndex {
  const body = raw.response?.elements;
  if (!body) {
    throw new Error(
      "CPRT export has no response.elements; this is not a CPRT framework export.",
    );
  }
  const docs = body.documents ?? [];
  if (docs.length !== 1 || docs[0]!.doc_identifier !== CPRT_DOC_IDENTIFIER) {
    throw new Error(
      `Expected exactly one document ${CPRT_DOC_IDENTIFIER}, found ${docs.map((d) => d.doc_identifier).join(", ") || "none"}.`,
    );
  }

  const byType = new Map<string, Map<string, CprtElement>>();
  // Every copy of every repeated identifier, so the gate can ask whether they agree rather than only that they existed.
  const copies = new Map<string, CprtElement[]>();
  const known = new Set<string>();
  for (const e of body.elements) {
    if (e.doc_identifier !== CPRT_DOC_IDENTIFIER) {
      throw new Error(
        `Element ${e.element_identifier} belongs to ${e.doc_identifier}, not ${CPRT_DOC_IDENTIFIER}.`,
      );
    }
    known.add(e.element_identifier);
    const ofType = byType.get(e.element_type) ?? new Map<string, CprtElement>();
    const key = `${e.element_type}\u0000${e.element_identifier}`;
    copies.set(key, [...(copies.get(key) ?? []), e]);
    if (!ofType.has(e.element_identifier)) {
      ofType.set(e.element_identifier, e);
    }
    byType.set(e.element_type, ofType);
  }

  const duplicates: DuplicateElement[] = [];
  for (const [key, group] of copies) {
    if (group.length < 2) continue;
    const [elementType = "", identifier = ""] = key.split("\u0000");
    const first = group[0]!;
    duplicates.push({
      identifier,
      elementType,
      copies: group.length,
      identical: group.every(
        (c) => c.text === first.text && c.title === first.title,
      ),
    });
  }
  duplicates.sort((a, b) => a.identifier.localeCompare(b.identifier));

  const projections = new Map<string, string[]>();
  const dangling = new Set<string>();
  for (const r of body.relationships) {
    if (r.relationship_identifier !== "projection") continue;
    if (!known.has(r.source_element_identifier)) {
      dangling.add(`source:${r.source_element_identifier}`);
    }
    if (!known.has(r.dest_element_identifier)) {
      dangling.add(`dest:${r.dest_element_identifier}`);
    }
    const list = projections.get(r.source_element_identifier) ?? [];
    list.push(r.dest_element_identifier);
    projections.set(r.source_element_identifier, list);
  }

  return {
    version: docs[0]!.version,
    byType,
    duplicates,
    projections,
    danglingEndpoints: [...dangling].sort(),
  };
}

function elementsOf(index: CprtIndex, type: string): Map<string, CprtElement> {
  return index.byType.get(type) ?? new Map<string, CprtElement>();
}

/** Destinations of a source's projections that are of one element type. */
function projectedOfType(
  index: CprtIndex,
  source: string,
  type: string,
): CprtElement[] {
  const ofType = elementsOf(index, type);
  return (index.projections.get(source) ?? [])
    .map((id) => ofType.get(id))
    .filter((e): e is CprtElement => e !== undefined);
}

// ---- Identifier translation ---------------------------------------------------

const CST_RE = /^CST-([A-Z]{2})-(\d+)(?:\((\d+)\))?((?:-[a-z0-9]+)*)$/;

/**
 * A CPRT statement identifier as the OSCAL part id the catalog seeded.
 *
 *   CST-AC-02        -> ac-2_smt        (the control's root statement)
 *   CST-AC-02-a      -> ac-2_smt.a
 *   CST-AC-02(01)-b  -> ac-2.1_smt.b
 *   CST-AC-03(03)-b-01 -> ac-3.3_smt.b.1  (CPRT zero-pads numeric segments; OSCAL does not)
 *
 * Returns null for an identifier in a shape this reader does not know, which the
 * caller treats as unresolved rather than guessing.
 */
export function statementToPartId(cst: string): string | null {
  const m = CST_RE.exec(cst);
  if (!m) return null;
  const [, family, num, enh, rest] = m;
  const base =
    `${family!.toLowerCase()}-${Number(num)}` + (enh ? `.${Number(enh)}` : "");
  const segments = (rest ?? "")
    .split("-")
    .filter((s) => s.length > 0)
    .map((s) => (/^\d+$/.test(s) ? String(Number(s)) : s));
  return `${base}_smt${segments.map((s) => `.${s}`).join("")}`;
}

/** Whether a statement identifier is a control's root statement (no lettered path). */
function isRootStatement(cst: string): boolean {
  const m = CST_RE.exec(cst);
  return m !== null && (m[4] ?? "") === "";
}

// ---- ODP references in determination text -------------------------------------

/** `<AC-02_ODP[01] prerequisites and criteria>`; the index is absent on some. */
const ODP_REF_RE =
  /<([A-Z]{2}-\d{2}(?:\(\d{2}\))?_ODP(?:\[\d{2}\])?)\s*([^>]*)>/g;

/** Depth cap for a selection whose choices themselves reference a parameter
 *  (AC-04(04) does, one level). A guarantee of termination against a
 *  self-referential export, not a bound real data approaches. */
const MAX_ODP_DEPTH = 4;

/**
 * Render one ODP reference in the same bracket convention the catalog pipeline
 * uses for `{{ insert: param }}` placeholders, so a determination and the
 * statement it assesses read alike on the page.
 *
 * The kind comes from the odp's projection to an `odp_type`. For an assignment
 * the label is the reference's own text, which is the odp's title in 1,738 of
 * 1,743 cases at the pin and the publication's chosen wording in the rest. For a
 * selection the reference text is the literal "SELECTED PARAMETER VALUE(S)",
 * which tells a reader nothing; the choices live on the projected
 * `odp_statement` ("remove; disable"), so that is what renders, matching how the
 * catalog's statement for the same control reads.
 */
function renderOdpRef(
  index: CprtIndex,
  odpId: string,
  label: string,
  depth: number,
): string | null {
  const odp = elementsOf(index, "odp").get(odpId);
  if (!odp) return null;
  const kind = projectedOfType(index, odpId, "odp_type")[0]?.element_identifier;

  if (kind === "single_select" || kind === "multi_select") {
    const statement = projectedOfType(index, odpId, "odp_statement")[0];
    const raw = (statement?.text ?? label).trim();
    const choices =
      depth < MAX_ODP_DEPTH ? substituteOdpRefs(index, raw, depth + 1) : raw;
    return kind === "single_select"
      ? `[Selection (one): ${choices}]`
      : `[Selection (one or more): ${choices}]`;
  }

  const text = label.trim() || odp.title.trim();
  return /^organization-defined\b/i.test(text)
    ? `[Assignment: ${text}]`
    : `[Assignment: organization-defined ${text}]`;
}

/** Substitute nested references inside a selection's choices, unlogged; only
 *  the top-level reference that contained them is logged. */
function substituteOdpRefs(
  index: CprtIndex,
  text: string,
  depth: number,
): string {
  return text.replace(ODP_REF_RE, (whole, odpId: string, label: string) => {
    return renderOdpRef(index, odpId, label, depth) ?? whole;
  });
}

/** Substitute every ODP reference in a determination, logging each. An
 *  unresolved reference is left in place and logged with `rendered: null`. */
export function renderOdpReferences(
  index: CprtIndex,
  cprtIdentifier: string,
  text: string,
  log: OdpResolution[],
): string {
  if (!text.includes("<")) return text;
  return text.replace(ODP_REF_RE, (whole, odpId: string, label: string) => {
    const rendered = renderOdpRef(index, odpId, label, 0);
    log.push({ cprtIdentifier, odpId, rendered });
    return rendered ?? whole;
  });
}

// ---- Reading against the seeded catalog ---------------------------------------

export interface AssessmentContent {
  objectives: ParsedObjective[];
  methods: ParsedMethod[];
  odpResolutions: OdpResolution[];
  /**
   * What the gates read.
   *
   * Counted against the CATALOG, not against the export. A measurement derived from what the export happens to name can only prove that everything mentioned was handled; it cannot prove that everything the catalog needs was delivered, and those are different claims. A control the export never mentions is the case that matters, and it is invisible to any count whose denominator came from the export.
   */
  measured: {
    /** Live controls the catalog defines. The denominator for everything below. */
    catalogLive: number;
    /** Live catalog controls the export never names. The reverse-direction check. */
    controlsMissingFromExport: string[];
    controlsInExport: number;
    controlsWithdrawn: number;
    /** Live catalog controls the export also names, i.e. the ones with content. */
    controlsLive: number;
    statementsLive: number;
    statementsResolved: number;
    determinationsReachable: number;
    determinationsOrphaned: string[];
    controlsWithoutObjectives: string[];
    /** Per kind, so the shape of NIST's unevenness is stated rather than summarised. */
    controlsWithoutMethod: Record<AssessmentMethodKind, string[]>;
    /** Controls carrying no method of any kind. Distinct from lacking one kind. */
    controlsWithoutAnyMethod: string[];
    duplicatesIdentical: string[];
    duplicatesDivergent: string[];
    /** Divergent duplicates that reached the output, where first-wins silently dropped content. */
    divergentDuplicatesEmitted: string[];
    danglingEndpoints: string[];
  };
}

/**
 * Everything the seed emits for assessment procedures, resolved against the
 * catalog the pipeline just parsed.
 *
 * `live` and `withdrawn` are the catalog pipeline's own split. Procedures for
 * withdrawn controls are a one-line "Withdrawn" statement and a "[WITHDRAWN:
 * Incorporated into ...]" determination; they are counted and not emitted, the
 * same rule the catalog applies to the controls themselves.
 */
export function readAssessmentContent(
  index: CprtIndex,
  live: readonly ParsedControl[],
  withdrawn: readonly ParsedControl[],
): AssessmentContent {
  const liveByNumber = new Map(live.map((c) => [c.controlNumber, c]));
  const withdrawnNumbers = new Set(withdrawn.map((c) => c.controlNumber));
  const partIds = new Set<string>();
  const collect = (parts: ParsedControl["statementParts"]): void => {
    for (const p of parts) {
      partIds.add(p.oscalPartId);
      collect(p.children);
    }
  };
  for (const c of live) collect(c.statementParts);

  // Both directions, deliberately.
  //
  // Export -> catalog is a hard error: a procedure cannot attach to a control that does not exist, and there is nothing sensible to emit.
  //
  // Catalog -> export is a measurement the caller gates, because it is the quieter failure. A control the export stopped naming simply produces no rows, and every count derived from the export still balances while the seed ships incomplete.
  const exportControls = [
    ...elementsOf(index, "control").keys(),
    ...elementsOf(index, "control_enhancement").keys(),
  ];
  const exportControlSet = new Set(exportControls);
  const unknown = exportControls.filter(
    (n) => !liveByNumber.has(n) && !withdrawnNumbers.has(n),
  );
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} control(s) in the export are not in the catalog: ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? ", ..." : ""}. ` +
        `Procedures cannot attach to controls that do not exist.`,
    );
  }

  // Driven by the catalog's own live set, in catalog order, so a control absent from the export is iterated and counted rather than never considered.
  const liveControls = live.map((c) => c.controlNumber);
  const controlsMissingFromExport = liveControls.filter(
    (n) => !exportControlSet.has(n),
  );

  // Statements, walked from each live control, nested statements included.
  // Depth-first, a statement's own items before its next sibling, because the
  // determinations are numbered in the order this map is filled and the
  // published assessment lists them in reading order: AC-02d.01 sits between
  // AC-02c. and AC-02e., not after AC-02l. A breadth-first walk put every
  // nested item after the last lettered one.
  const statementOwner = new Map<string, string>(); // CST id -> control number
  const statementPart = new Map<string, string | null>(); // CST id -> part id or null for root
  const unresolvedStatements: string[] = [];
  for (const number of liveControls) {
    const stack = projectedOfType(index, number, "control_statement")
      .map((e) => e.element_identifier)
      .reverse();
    while (stack.length > 0) {
      const cst = stack.pop()!;
      if (statementOwner.has(cst)) continue;
      statementOwner.set(cst, number);
      const partId = statementToPartId(cst);
      if (partId === null || !partIds.has(partId)) {
        unresolvedStatements.push(cst);
      } else {
        statementPart.set(cst, isRootStatement(cst) ? null : partId);
      }
      stack.push(
        ...projectedOfType(index, cst, "control_statement")
          .map((e) => e.element_identifier)
          .reverse(),
      );
    }
  }
  if (unresolvedStatements.length > 0) {
    throw new Error(
      `${unresolvedStatements.length} control statement(s) in the export match no seeded part: ${unresolvedStatements.slice(0, 10).join(", ")}${unresolvedStatements.length > 10 ? ", ..." : ""}. ` +
        `A determination attached to a statement the catalog does not carry would point at nothing.`,
    );
  }

  // Determinations, in reading order within each control: statement by statement as walked above, export order within a statement.
  const odpResolutions: OdpResolution[] = [];
  const objectives: ParsedObjective[] = [];
  const reached = new Set<string>();
  const perControl = new Map<string, number>();
  for (const [cst, number] of statementOwner) {
    for (const det of projectedOfType(index, cst, "determination")) {
      if (reached.has(det.element_identifier)) continue;
      reached.add(det.element_identifier);
      const sortOrder = perControl.get(number) ?? 0;
      perControl.set(number, sortOrder + 1);
      objectives.push({
        cprtIdentifier: det.element_identifier,
        controlNumber: number,
        oscalPartId: statementPart.get(cst) ?? null,
        text: renderOdpReferences(
          index,
          det.element_identifier,
          det.text.trim(),
          odpResolutions,
        ),
        sortOrder,
      });
    }
  }
  // Determinations of withdrawn controls are reachable through their own statements; count them as reached so the orphan check names only real orphans.
  for (const number of withdrawnNumbers) {
    for (const cst of projectedOfType(index, number, "control_statement")) {
      for (const det of projectedOfType(
        index,
        cst.element_identifier,
        "determination",
      )) {
        reached.add(det.element_identifier);
      }
    }
  }
  const orphaned = [...elementsOf(index, "determination").keys()].filter(
    (id) => !reached.has(id),
  );

  // Methods: one element each of examine / interview / test per control.
  //
  // Absences are recorded per kind by control number rather than as a single total.
  // NIST's data is uneven in a specific shape — 108 controls carry no test, two carry
  // no interview, one carries no examine, none carry nothing — and a summary count
  // would describe that as "controls with no assessment content", which is false.
  const methods: ParsedMethod[] = [];
  const missing: Record<AssessmentMethodKind, string[]> = {
    EXAMINE: [],
    INTERVIEW: [],
    TEST: [],
  };
  const withAnyMethod = new Set<string>();
  for (const number of liveControls) {
    for (const kind of Object.keys(METHOD_TYPES) as AssessmentMethodKind[]) {
      const found = projectedOfType(index, number, METHOD_TYPES[kind]);
      if (found.length > 1) {
        throw new Error(
          `${number} projects to ${found.length} ${METHOD_TYPES[kind]} elements; the model allows one.`,
        );
      }
      const el = found[0];
      if (!el) {
        missing[kind].push(number);
        continue;
      }
      withAnyMethod.add(number);
      const prefix = el.element_identifier.split("-")[0] ?? "";
      if (METHOD_PREFIX[prefix] !== kind) {
        throw new Error(
          `${el.element_identifier} is projected as ${METHOD_TYPES[kind]} but its identifier says otherwise.`,
        );
      }
      methods.push({
        cprtIdentifier: el.element_identifier,
        controlNumber: number,
        method: kind,
        text: el.text.trim(),
      });
    }
  }

  // Emit in catalog order, not export order: the export lists PS-05 first and
  // the seed file is a reviewable artifact that should diff in the order a
  // reader expects. `live` arrives in catalog order from the parser.
  const order = new Map(live.map((c, i) => [c.controlNumber, i]));
  const rank = (n: string): number => order.get(n) ?? Number.MAX_SAFE_INTEGER;
  objectives.sort(
    (a, b) =>
      rank(a.controlNumber) - rank(b.controlNumber) ||
      a.sortOrder - b.sortOrder,
  );
  const kindRank: Record<AssessmentMethodKind, number> = {
    EXAMINE: 0,
    INTERVIEW: 1,
    TEST: 2,
  };
  methods.sort(
    (a, b) =>
      rank(a.controlNumber) - rank(b.controlNumber) ||
      kindRank[a.method] - kindRank[b.method],
  );

  const withObjectives = new Set(objectives.map((o) => o.controlNumber));
  // A divergent duplicate is only harmless while nothing it names is emitted. Assert
  // that rather than assume it: these are the identifiers where first-wins actually
  // dropped content that shipped.
  const emittedIdentifiers = new Set<string>([
    ...objectives.map((o) => o.cprtIdentifier),
    ...methods.map((m) => m.cprtIdentifier),
  ]);
  const duplicatesDivergent = index.duplicates
    .filter((d) => !d.identical)
    .map((d) => d.identifier);

  return {
    objectives,
    methods,
    odpResolutions,
    measured: {
      catalogLive: live.length,
      controlsMissingFromExport,
      controlsInExport: exportControls.length,
      controlsWithdrawn: exportControls.filter((n) => withdrawnNumbers.has(n))
        .length,
      controlsLive: liveControls.filter((n) => exportControlSet.has(n)).length,
      statementsLive: statementOwner.size,
      statementsResolved: statementPart.size,
      determinationsReachable: reached.size,
      determinationsOrphaned: orphaned.sort(),
      controlsWithoutObjectives: liveControls
        .filter((n) => !withObjectives.has(n))
        .sort(),
      controlsWithoutMethod: missing,
      controlsWithoutAnyMethod: liveControls
        .filter((n) => !withAnyMethod.has(n))
        .sort(),
      duplicatesIdentical: index.duplicates
        .filter((d) => d.identical)
        .map((d) => d.identifier),
      duplicatesDivergent,
      divergentDuplicatesEmitted: duplicatesDivergent.filter((id) =>
        emittedIdentifiers.has(id),
      ),
      danglingEndpoints: index.danglingEndpoints,
    },
  };
}
