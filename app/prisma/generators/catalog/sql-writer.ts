/**
 * SQL emission.
 *
 * Plain INSERT statements rather than a query builder, because the output is a
 * reviewable artifact: a reader diffs these files when the pin moves, and a
 * builder's output is not something you read.
 *
 * Ids are content-addressed, never positional, so re-running produces identical
 * files and a control keeps its id when its neighbours change. The `_r520` token
 * scopes every id to this catalog revision.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LineageRow,
  ParsedControl,
  ParsedFamily,
  ParsedMethod,
  ParsedObjective,
  ParsedPart,
} from "./types.js";

/** The token every generated id ends with, scoping ids to a catalog revision. */
export interface IdScheme {
  /** The catalog row's own id, e.g. "nist_r520". */
  versionRowId: string;
  /** Suffix on control and part ids, e.g. "r520". */
  token: string;
}

export function nistIdScheme(catalogVersion: string): IdScheme {
  const v = catalogVersion.replace(/\./g, "");
  return { versionRowId: `nist_r${v}`, token: `r${v}` };
}

/** The system user rows are attributed to. */
const SYSTEM_USER_ID = "system_nist_gov";
const SYSTEM_USER_EMAIL = "system@nist.gov";

/**
 * Quote and escape a value, or emit NULL.
 *
 * Doubling the single quote is the whole escape, and that is only sufficient
 * because PostgreSQL runs with `standard_conforming_strings = on` (the default
 * since 9.1), where a backslash is an ordinary character. If that were ever off,
 * `\'` would become an escape and the doubling would stop protecting anything.
 *
 * Non-breaking spaces are normalized because OSCAL prose contains them and they
 * are invisible in a diff, which makes them a recurring source of "identical"
 * files that are not.
 */
export function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/ /g, " ").replace(/'/g, "''")}'`;
}

/** A Postgres text[] literal. The empty case is special: `ARRAY[]::text[]` is a
 *  syntax error, so an empty array must be written as `'{}'`. */
function textArray(values: string[]): string {
  if (values.length === 0) return "'{}'";
  return `ARRAY[${values.map((v) => esc(v)).join(",")}]::text[]`;
}

export function controlId(controlNumber: string, token: string): string {
  const normalized = controlNumber
    .toLowerCase()
    .replace(/[()]/g, "_")
    .replace(/\s+/g, "_");
  return `ctrl_${normalized}_${token}`;
}

export function partId(oscalPartId: string, token: string): string {
  return `part_${oscalPartId}_${token}`;
}

/**
 * A CPRT identifier as a row id, e.g. "DS-AC-02a.[01]" -> "obj_ac-02a.01_r520",
 * "E-AC-02" -> "method_ac-02_examine_r520".
 *
 * Content-addressed from the publication's own identifier so a row keeps its id
 * when its neighbours change. The DS-/E-/I-/T- prefix is dropped because the
 * table already says what the row is; brackets and parentheses become
 * underscores because they are noise in a key. Distinct CPRT identifiers stay
 * distinct after this mapping at the pin, and the integrity gate checks that
 * rather than assuming it.
 */
export function objectiveId(cprtIdentifier: string, token: string): string {
  const body = cprtIdentifier
    .replace(/^DS-/, "")
    .toLowerCase()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/[()]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/_\./g, "_")
    .replace(/\.$/, "");
  return `obj_${body}_${token}`;
}

export function methodId(
  controlNumber: string,
  method: ParsedMethod["method"],
  token: string,
): string {
  const normalized = controlNumber.toLowerCase().replace(/[()]/g, "_");
  return `method_${normalized}_${method.toLowerCase()}_${token}`;
}

function header(file: string, note: string): string {
  return `-- ${file}\n-- ${note}\n\n`;
}

// ---- 00: cleanup ---------------------------------------------------------------

/** Truncate children before parents. CASCADE would handle the order, but naming
 *  it makes the dependency visible to a reader of the file. */
export function writeCleanupSql(outputDir: string, note: string): void {
  const tables = [
    "ControlLineage",
    "NistControlExternalEntity",
    "ExternalEntity",
    "NistControlLink",
    "ReferenceLink",
    "NistLink",
    "ZeroTrustMapping",
    "ZTMMGuidance",
    "AssessmentObjective",
    "AssessmentMethod",
    "ControlParameter",
    "ControlPart",
    "NistControl",
    "ControlFamily",
    "NistVersion",
  ];
  const sql =
    header("00-cleanup.sql", note) +
    "-- CASCADE emits a NOTICE per dependent table; quiet them so a real warning stands out.\nSET client_min_messages = warning;\n" +
    tables.map((t) => `TRUNCATE TABLE "${t}" CASCADE;`).join("\n") +
    "\n";
  writeFileSync(join(outputDir, "00-cleanup.sql"), sql);
}

// ---- 01: system user -----------------------------------------------------------

export function writeSystemUserSql(outputDir: string, note: string): void {
  const sql =
    header("01-system-user.sql", note) +
    `INSERT INTO "User" ("id", "email", "name", "emailVerified")\n` +
    `VALUES (${esc(SYSTEM_USER_ID)}, ${esc(SYSTEM_USER_EMAIL)}, 'System', NOW())\n` +
    `ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name";\n`;
  writeFileSync(join(outputDir, "01-system-user.sql"), sql);
}

// ---- 02: catalog version -------------------------------------------------------

export interface CatalogRow {
  version: string;
  catalogKey: string;
  displayLabel: string;
  upstreamRevision: string;
  /** Null is the meaning, not a gap: a stock catalog applies no tailoring. */
  tailoringNote: string | null;
  releaseDate: string;
  description: string;
}

export function writeCatalogVersionSql(
  outputDir: string,
  row: CatalogRow,
  scheme: IdScheme,
  note: string,
): void {
  const sql =
    header("02-catalog-version.sql", note) +
    `INSERT INTO "NistVersion" ("id", "version", "catalogKey", "displayLabel", "upstreamRevision", "tailoringNote", "releaseDate", "isActive", "description", "createdAt", "updatedAt")\n` +
    `VALUES (\n` +
    `  ${esc(scheme.versionRowId)},\n` +
    `  ${esc(row.version)},\n` +
    `  ${esc(row.catalogKey)},\n` +
    `  ${esc(row.displayLabel)},\n` +
    `  ${esc(row.upstreamRevision)},\n` +
    `  ${esc(row.tailoringNote)},\n` +
    `  ${esc(row.releaseDate)},\n` +
    `  true,\n` +
    `  ${esc(row.description)},\n` +
    `  NOW(),\n` +
    `  NOW()\n` +
    `);\n`;
  writeFileSync(join(outputDir, "02-catalog-version.sql"), sql);
}

// ---- 03: families --------------------------------------------------------------

export function writeControlFamiliesSql(
  outputDir: string,
  families: ParsedFamily[],
  note: string,
): void {
  const rows = families
    .map((f, i) => `  (${esc(f.id)}, ${esc(f.name)}, ${i + 1})`)
    .join(",\n");
  const sql =
    header("03-control-families.sql", note) +
    `INSERT INTO "ControlFamily" ("id", "name", "sortOrder")\nVALUES\n${rows}\nON CONFLICT ("id") DO NOTHING;\n`;
  writeFileSync(join(outputDir, "03-control-families.sql"), sql);
}

// ---- 04: controls --------------------------------------------------------------

export function writeControlsSql(
  outputDir: string,
  controls: ParsedControl[],
  scheme: IdScheme,
  note: string,
): void {
  const rows = controls.map((c) => {
    const id = controlId(c.controlNumber, scheme.token);
    return (
      `  (${esc(id)}, ${esc(c.controlNumber)}, ${esc(c.controlName)}, ${esc(c.guidance)}, ` +
      `${esc(c.oscalId)}, ${esc(c.sortId)}, NULL, NULL, ${textArray(c.baselineLabels)}, ` +
      `NULL, ${textArray(c.relatedControls)}, NULL, ${esc(c.familyId)}, ${esc(scheme.versionRowId)}, ` +
      `${esc(SYSTEM_USER_ID)}, ${esc(SYSTEM_USER_ID)}, NOW(), NOW())`
    );
  });
  const sql =
    header("04-controls.sql", `${note}\n-- ${controls.length} controls`) +
    `-- reviewFrequency, assessmentFrequency, priority and referencePolicy are NULL:\n` +
    `-- the stock catalog states none of them. A tailoring authority fills them.\n` +
    `INSERT INTO "NistControl" ("id", "controlNumber", "controlName", "discussion", "oscalId", "sortId", "reviewFrequency", "assessmentFrequency", "baselineLabels", "priority", "relatedControls", "referencePolicy", "controlFamilyId", "nistVersionId", "createdById", "updatedById", "createdAt", "updatedAt")\n` +
    `VALUES\n${rows.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`;
  writeFileSync(join(outputDir, "04-controls.sql"), sql);
}

// ---- 05: parent refs -----------------------------------------------------------

/** A second pass, because a self-referencing foreign key cannot be satisfied by
 *  ordering rows inside one INSERT. */
export function writeParentRefsSql(
  outputDir: string,
  controls: ParsedControl[],
  scheme: IdScheme,
  note: string,
): void {
  const byOscalId = new Map(controls.map((c) => [c.oscalId, c.controlNumber]));
  const updates: string[] = [];

  for (const c of controls) {
    if (c.parentOscalId === null) continue;
    const parentNumber = byOscalId.get(c.parentOscalId);
    if (!parentNumber) {
      // measureIntegrity gates this to zero before any write, so reaching here
      // means the gate was bypassed rather than that a row should be skipped.
      throw new Error(
        `${c.controlNumber} has parent ${c.parentOscalId}, which is not being written.`,
      );
    }
    updates.push(
      `  UPDATE "NistControl" SET "parentControlId" = ${esc(controlId(parentNumber, scheme.token))} WHERE "id" = ${esc(controlId(c.controlNumber, scheme.token))};`,
    );
  }

  const sql =
    header("05-parent-refs.sql", `${note}\n-- ${updates.length} enhancements`) +
    (updates.length > 0
      ? updates.join("\n") + "\n"
      : "-- No enhancements in this catalog.\n");
  writeFileSync(join(outputDir, "05-parent-refs.sql"), sql);
}

// ---- 06: control parts ---------------------------------------------------------

export function writeControlPartsSql(
  outputDir: string,
  controls: ParsedControl[],
  scheme: IdScheme,
  note: string,
): void {
  const rows: string[] = [];

  // Depth-first, parents before children, so every parentPartId resolves within
  // the single INSERT.
  const walk = (
    parts: ParsedPart[],
    ownerControlId: string,
    parentPartId: string | null,
  ): void => {
    for (const p of parts) {
      const id = partId(p.oscalPartId, scheme.token);
      rows.push(
        `  (${esc(id)}, ${esc(p.oscalPartId)}, ${esc(p.label)}, ${esc(p.name)}, ` +
          `${esc(p.prose)}, ${p.sortOrder}, ${esc(parentPartId)}, ${esc(ownerControlId)})`,
      );
      walk(p.children, ownerControlId, id);
    }
  };

  for (const c of controls) {
    walk(c.statementParts, controlId(c.controlNumber, scheme.token), null);
  }

  const sql =
    header("06-control-parts.sql", `${note}\n-- ${rows.length} parts`) +
    (rows.length > 0
      ? `INSERT INTO "ControlPart" ("id", "oscalPartId", "label", "name", "prose", "sortOrder", "parentPartId", "nistControlId")\nVALUES\n${rows.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`
      : "-- No statement parts in this catalog.\n");
  writeFileSync(join(outputDir, "06-control-parts.sql"), sql);
}

// ---- 08: assessment procedures -------------------------------------------------

/** What the publication does not carry, per method kind, so the seed file states its own gaps. */
export interface MethodGaps {
  liveControls: number;
  missing: Record<ParsedMethod["method"], string[]>;
  withoutAny: string[];
}

/**
 * The header's account of what is absent and why.
 *
 * A reader looking at a control with no TEST row needs to tell "NIST publishes no test for this control" from "assessment content was never ingested", and a missing row says neither. So the file states the shape of the absence: how many controls the run covered, which kinds are missing where, and that nothing is missing everywhere. Small gaps are named outright; the large one is counted.
 */
function methodGapLines(gaps: MethodGaps): string {
  const line = (kind: ParsedMethod["method"]): string => {
    const missing = gaps.missing[kind];
    if (missing.length === 0) {
      return `--   ${kind.toLowerCase()}: all ${gaps.liveControls} controls`;
    }
    const named = missing.length <= 6 ? ` (${missing.join(", ")})` : "";
    return `--   ${kind.toLowerCase()}: ${gaps.liveControls - missing.length} controls; ${missing.length} carry none${named}`;
  };
  return [
    `-- Method coverage across the ${gaps.liveControls} live controls this run wrote. A kind absent from a control is absent in SP 800-53A itself rather than un-ingested, and the last line is what proves that distinction rather than asserting it.`,
    line("EXAMINE"),
    line("INTERVIEW"),
    line("TEST"),
    `--   controls carrying no method of any kind: ${gaps.withoutAny.length}${gaps.withoutAny.length ? ` (${gaps.withoutAny.slice(0, 6).join(", ")})` : ""}`,
  ].join("\n");
}

/**
 * SP 800-53A determination statements and assessment methods, as two tables.
 *
 * Rows rather than columns because the dimension is neither small nor closed: a control carries up to 38 determinations and a statement up to 13, and the method kinds are unevenly populated. An objective attaches to the control always, and to the lettered part its source statement corresponds to when there is one; the null there means "the control's root statement", not "unknown".
 *
 * Sequenced after 06 because both foreign keys point at rows 04 and 06 write.
 */
export function writeAssessmentProceduresSql(
  outputDir: string,
  objectives: ParsedObjective[],
  methods: ParsedMethod[],
  gaps: MethodGaps,
  scheme: IdScheme,
  note: string,
): void {
  const objectiveRows = objectives.map((o) => {
    const part = o.oscalPartId
      ? esc(partId(o.oscalPartId, scheme.token))
      : "NULL";
    return (
      `  (${esc(objectiveId(o.cprtIdentifier, scheme.token))}, ${esc(o.cprtIdentifier)}, ` +
      `${esc(o.text)}, ${o.sortOrder}, ${esc(controlId(o.controlNumber, scheme.token))}, ${part})`
    );
  });
  const methodRows = methods.map(
    (m) =>
      `  (${esc(methodId(m.controlNumber, m.method, scheme.token))}, ${esc(m.cprtIdentifier)}, ` +
      `'${m.method}'::"AssessmentMethodKind", ${esc(m.text)}, ${esc(controlId(m.controlNumber, scheme.token))})`,
  );

  const sql =
    header(
      "08-assessment-procedures.sql",
      `${note}\n-- ${objectiveRows.length} determination statements, ${methodRows.length} assessment method entries`,
    ) +
    `-- Source publication: NIST SP 800-53A Release 5.2.0, via the CPRT export pinned in sources/nist-800-53/SOURCE.md.\n` +
    `-- partId is NULL when the determination assesses the control's root statement rather than a lettered item.\n` +
    `--\n${methodGapLines(gaps)}\n` +
    (objectiveRows.length > 0
      ? `INSERT INTO "AssessmentObjective" ("id", "cprtIdentifier", "text", "sortOrder", "nistControlId", "partId")\nVALUES\n${objectiveRows.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`
      : "-- No determination statements.\n") +
    "\n" +
    (methodRows.length > 0
      ? `INSERT INTO "AssessmentMethod" ("id", "cprtIdentifier", "method", "text", "nistControlId")\nVALUES\n${methodRows.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`
      : "-- No assessment method entries.\n");
  writeFileSync(join(outputDir, "08-assessment-procedures.sql"), sql);
}

// ---- 07: control parameters ----------------------------------------------------

/**
 * A comment-only file, deliberately.
 *
 * NIST declares 1,600 organization-defined parameters but assigns no values, so
 * there is nothing to insert. Writing a valid empty file rather than skipping it
 * keeps the numbered sequence intact and tells a reader the absence was decided
 * rather than forgotten.
 */
export function writeControlParametersSql(
  outputDir: string,
  note: string,
): void {
  const sql =
    header("07-control-parameters.sql", note) +
    `-- Intentionally empty. NIST SP 800-53 declares organization-defined parameters\n` +
    `-- but assigns no values to them; the placeholders are rendered into the prose in\n` +
    `-- 06 instead. A tailoring authority that assigns values populates this file.\n`;
  writeFileSync(join(outputDir, "07-control-parameters.sql"), sql);
}

// ---- 15: withdrawn controls ----------------------------------------------------

/**
 * The controls the catalog withdraws, in a file of their own so 04 and 05 keep meaning
 * the live catalog for everything that reads them. Each row carries its number, title and
 * status; a withdrawn control keeps no statement, because the catalog's text for it is
 * where it went, which 16 records. Parent references follow the rows, as in 05: a
 * withdrawn enhancement's parent may be live or withdrawn, and both exist by then.
 */
export function writeWithdrawnControlsSql(
  outputDir: string,
  withdrawn: ParsedControl[],
  all: ParsedControl[],
  scheme: IdScheme,
  note: string,
): void {
  const byOscalId = new Map(all.map((c) => [c.oscalId, c.controlNumber]));
  const rows = withdrawn.map((c) => {
    const id = controlId(c.controlNumber, scheme.token);
    return (
      `  (${esc(id)}, ${esc(c.controlNumber)}, ${esc(c.controlName)}, ${esc(c.guidance)}, ` +
      `${esc(c.oscalId)}, ${esc(c.sortId)}, ${textArray(c.baselineLabels)}, ` +
      `${textArray(c.relatedControls)}, 'WITHDRAWN', ${esc(c.familyId)}, ${esc(scheme.versionRowId)}, ` +
      `${esc(SYSTEM_USER_ID)}, ${esc(SYSTEM_USER_ID)}, NOW(), NOW())`
    );
  });
  const updates: string[] = [];
  for (const c of withdrawn) {
    if (c.parentOscalId === null) continue;
    const parentNumber = byOscalId.get(c.parentOscalId);
    if (!parentNumber) {
      throw new Error(
        `${c.controlNumber} has parent ${c.parentOscalId}, which is not being written.`,
      );
    }
    updates.push(
      `  UPDATE "NistControl" SET "parentControlId" = ${esc(controlId(parentNumber, scheme.token))} WHERE "id" = ${esc(controlId(c.controlNumber, scheme.token))};`,
    );
  }
  const sql =
    header(
      "15-withdrawn-controls.sql",
      `${note}\n-- ${withdrawn.length} withdrawn controls, ${updates.length} of them enhancements`,
    ) +
    `INSERT INTO "NistControl" ("id", "controlNumber", "controlName", "discussion", "oscalId", "sortId", "baselineLabels", "relatedControls", "status", "controlFamilyId", "nistVersionId", "createdById", "updatedById", "createdAt", "updatedAt")\n` +
    `VALUES\n${rows.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n\n` +
    (updates.length > 0 ? updates.join("\n") + "\n" : "");
  writeFileSync(join(outputDir, "15-withdrawn-controls.sql"), sql);
}

// ---- 16: control lineage -------------------------------------------------------

/** A lineage row's id, content-addressed like every other: the control, the kind, and
 *  the successor or the release compared against. */
export function lineageId(row: LineageRow, token: string): string {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  const target = row.relatedControlNumber ?? row.sinceRelease ?? "none";
  return `lin_${norm(row.controlNumber)}_${row.kind.toLowerCase()}_${norm(target)}_${token}`;
}

/**
 * Where withdrawn controls went, and what the release added or dropped. A row names both
 * sides by control number; the foreign keys are set when that control is seeded, which a
 * family successor (SR) and a dropped control never are.
 */
export function writeLineageSql(
  outputDir: string,
  rows: LineageRow[],
  seededNumbers: ReadonlySet<string>,
  scheme: IdScheme,
  note: string,
): void {
  const fk = (number: string | null): string =>
    number !== null && seededNumbers.has(number)
      ? esc(controlId(number, scheme.token))
      : "NULL";
  // A part's row is seeded with its control, so the part's key is set exactly when the
  // successor control's is.
  const partFk = (r: LineageRow): string =>
    r.relatedPartOscalId !== null && fk(r.relatedControlNumber) !== "NULL"
      ? esc(partId(r.relatedPartOscalId, scheme.token))
      : "NULL";
  const values = rows.map(
    (r) =>
      `  (${esc(lineageId(r, scheme.token))}, ${esc(scheme.versionRowId)}, ${esc(r.controlNumber)}, '${r.kind}', ` +
      `${esc(r.relatedControlNumber)}, ${esc(r.relatedPartOscalId)}, ${esc(r.release)}, ${esc(r.sinceRelease)}, ` +
      `${fk(r.controlNumber)}, ${fk(r.relatedControlNumber)}, ${partFk(r)}, NOW())`,
  );
  const count = (kind: LineageRow["kind"]): number =>
    rows.filter((r) => r.kind === kind).length;
  const sql =
    header(
      "16-control-lineage.sql",
      `${note}\n-- ${rows.length} rows: ${count("INCORPORATED_INTO")} incorporated into, ${count("MOVED_TO")} moved to, ${count("ADDED")} added, ${count("DROPPED")} dropped`,
    ) +
    (values.length > 0
      ? `INSERT INTO "ControlLineage" ("id", "nistVersionId", "controlNumber", "kind", "relatedControlNumber", "relatedPartOscalId", "release", "sinceRelease", "controlId", "relatedControlId", "relatedPartId", "createdAt")\n` +
        `VALUES\n${values.join(",\n")}\nON CONFLICT ("id") DO NOTHING;\n`
      : "-- No lineage in this catalog.\n");
  writeFileSync(join(outputDir, "16-control-lineage.sql"), sql);
}
