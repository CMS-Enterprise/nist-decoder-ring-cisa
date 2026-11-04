// Docs: prisma/generators/zt-overlay/README.md
/**
 * CISA's Zero Trust control mapping workbook, as rows the overlay generator reads.
 *
 * One sheet row is one NIST SP 800-53 control mapped to one Zero Trust pillar and
 * function at one maturity floor, designated Key, Supporting or Informative. Every
 * row is kept, duplicates included, and every column the sheet carries is kept
 * beside the values derived from it, so nothing the publisher wrote is lost on the
 * way in. What the transform adds is the vocabulary the seed speaks:
 *
 *   - the control in canonical form (AC-2(1) → AC-02(01)), through the shared
 *     identifier rule;
 *   - the pillar as the schema's enum (Device → DEVICES);
 *   - the maturity without its "+" (Traditional+ → TRADITIONAL), the "+" meaning
 *     "this level and above", which a single enum value already implies;
 *   - the function as the sheet's function-code table names it, through FUNCTION_GROUPS.
 *
 * The four columns the sheet computes by formula are recomputed here and must
 * match what the workbook cached; a mismatch means the cached values are stale
 * and the run stops. Anything else that looks wrong in the source is a finding:
 * recorded, counted, and left for a person to decide.
 */

import {
  assertNoCollisions,
  canonicalize,
} from "../../shared/control-identifier/canonical.js";
import { compareText } from "./order.js";
import { cellValue, type Sheet } from "./xlsx.js";

export const SHEET_NAME = "Control Mapping";

/** The sheet's header, columns A to L, exactly as published. */
export const SHEET_HEADER = [
  "Control ID",
  "Control Name",
  "Control Text",
  "ZT Pillar",
  "ZT Function",
  "Maturity Level",
  "Designation",
  "If Applicable",
  "Appears in Multiple Pillars",
  "Pillar Duplicate ID",
  "Appears in Multiple Functions? (Y/N)",
  "Function Duplicate ID",
] as const;

/** The first eight columns carry the mapping and must be present. The four
 *  analysis columns after them are checked when present, since a later edition
 *  may drop them. Any other column is carried through unread. */
const REQUIRED_COLUMNS = 8;

/** The function-code table the sheet's formulas look up, found by its headers. */
const CODE_HEADER = ["AA (Function Name)", "AB (Function Number)"] as const;

export type Pillar =
  "IDENTITY" | "DEVICES" | "NETWORKS" | "APPLICATIONS" | "DATA";
export type Maturity = "TRADITIONAL" | "INITIAL" | "ADVANCED" | "OPTIMAL";

const PILLARS: Record<string, Pillar> = {
  Identity: "IDENTITY",
  Device: "DEVICES",
  Network: "NETWORKS",
  Application: "APPLICATIONS",
  Data: "DATA",
};

/** The two-digit pillar codes the sheet's Pillar Duplicate ID formula uses. */
const PILLAR_CODES: Record<string, string> = {
  Device: "01",
  Identity: "02",
  Network: "03",
  Application: "04",
  Data: "05",
};

const MATURITIES: Record<string, Maturity> = {
  "Traditional+": "TRADITIONAL",
  "Initial+": "INITIAL",
  "Advanced+": "ADVANCED",
  Optimal: "OPTIMAL",
};

/**
 * Each CISA function, per pillar, and the name it is seeded under: the name in
 * the sheet's own function-code table. Every pair the sheet may use is listed, so
 * a pair missing from here is an unknown function and stops the run rather than
 * passing through under a name no guidance row carries.
 *
 * Most names are seeded as published. Two spellings the sheet uses outside its
 * own code table are read as the code table's name, and recorded as a finding:
 * "Application Threat Protections", and a bare "Automation and Orchestration"
 * under Applications. The guidance seed's groups use these same names, so a
 * mapping resolves by the name CISA gives the function.
 */
export const FUNCTION_GROUPS: Record<Pillar, Record<string, string>> = {
  IDENTITY: {
    Authentication: "Authentication",
    "Identity Stores": "Identity Stores",
    "Risk Assessments": "Risk Assessments",
    "Access Management": "Access Management",
    "Identity Visibility and Analytics": "Identity Visibility and Analytics",
    "Identity Automation and Orchestration":
      "Identity Automation and Orchestration",
  },
  DEVICES: {
    "Policy Enforcement": "Policy Enforcement",
    "Asset and Supply Chain": "Asset and Supply Chain",
    "Resource Access": "Resource Access",
    "Device Threat Protection": "Device Threat Protection",
    "Device Visibility and Analytics": "Device Visibility and Analytics",
    "Device Automation and Orchestration":
      "Device Automation and Orchestration",
  },
  NETWORKS: {
    "Traffic Management": "Traffic Management",
    "Traffic Segmentation": "Traffic Segmentation",
    "Traffic Encryption": "Traffic Encryption",
    Resilience: "Resilience",
    "Network Visibility and Analytics": "Network Visibility and Analytics",
    "Network Automation and Orchestration":
      "Network Automation and Orchestration",
  },
  APPLICATIONS: {
    "Application Access": "Application Access",
    "Application Threat Protection": "Application Threat Protection",
    "Application Threat Protections": "Application Threat Protection",
    "Accessible Applications": "Accessible Applications",
    "Secure App Development": "Secure App Development",
    "Security Testing": "Security Testing",
    "Application Visibility and Analytics":
      "Application Visibility and Analytics",
    "Application Automation and Orchestration":
      "Application Automation and Orchestration",
    "Automation and Orchestration": "Application Automation and Orchestration",
  },
  DATA: {
    "Inventory Management": "Inventory Management",
    Categorization: "Categorization",
    Availability: "Availability",
    "Data Access": "Data Access",
    Encryption: "Encryption",
    "Data Visibility and Analytics": "Data Visibility and Analytics",
    "Data Automation and Orchestration": "Data Automation and Orchestration",
  },
};

/** The transformed table's columns. Canonical values first, then everything the
 *  sheet carries, verbatim. */
export const CSV_HEADER = [
  "source_row",
  "control_id",
  "pillar",
  "function",
  "maturity",
  "designation",
  "if_applicable",
  "function_transform",
  "cisa_control_id",
  "cisa_pillar",
  "cisa_function",
  "cisa_maturity",
  "cisa_function_code",
  "cisa_multiple_pillars",
  "cisa_pillar_duplicate_id",
  "cisa_multiple_functions",
  "cisa_function_duplicate_id",
  "cisa_control_name",
  "cisa_control_text",
] as const;

/** A column the sheet carries beyond the known ones, kept in the CSV as
 *  `cisa_extra_<slug of its header>`. */
export function extraColumnName(header: string): string {
  return `cisa_extra_${header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

export interface CisaRow {
  sourceRow: number;
  controlId: string;
  pillar: Pillar;
  function: string;
  maturity: Maturity;
  designation: string;
  ifApplicable: boolean;
  /** How the function name was read: "as published", or what was changed. */
  functionTransform: string;
  cisa: {
    controlId: string;
    pillar: string;
    function: string;
    maturity: string;
    functionCode: string;
    multiplePillars: string;
    pillarDuplicateId: string;
    multipleFunctions: string;
    functionDuplicateId: string;
    controlName: string;
    controlText: string;
    /** Columns beyond the known ones, by their CSV name, in sheet order. */
    extra: Record<string, string>;
  };
}

export interface FunctionCode {
  code: string;
  name: string;
}

/** Something in the source a person should look at. Never fatal. */
export interface Finding {
  kind: string;
  rows: number[];
  controlId: string;
  detail: string;
}

export interface Transformed {
  rows: CisaRow[];
  /** The CSV names of the sheet's extra columns, in sheet order. */
  extraColumns: string[];
  functionCodes: FunctionCode[];
  findings: Finding[];
}

/** Collapse internal runs of whitespace and trim, recording what changed. */
function normaliseFunction(raw: string): {
  name: string;
  change: string | null;
} {
  const name = raw.replace(/\s+/g, " ").trim();
  return { name, change: name === raw ? null : "whitespace trimmed" };
}

/** Each header in row 1 and its column. Columns are read by name, so a
 *  reordered or widened sheet still reads. A missing mapping column, or a name
 *  on two columns, stops the run: reading one copy would drop the other. */
function readHeader(sheet: Sheet): Map<string, string> {
  const byName = new Map<string, string>();
  const repeated: string[] = [];
  for (const [col, cell] of sheet.get(1) ?? []) {
    const name = cell.value.trim();
    if (!name) continue;
    const first = byName.get(name);
    if (first) repeated.push(`"${name}" in columns ${first} and ${col}`);
    else byName.set(name, col);
  }
  if (repeated.length) {
    throw new Error(
      `The "${SHEET_NAME}" sheet names a column twice: ${repeated.join("; ")}. Rename one so both are kept.`,
    );
  }
  const missing = SHEET_HEADER.slice(0, REQUIRED_COLUMNS).filter(
    (h) => !byName.has(h),
  );
  if (missing.length) {
    throw new Error(
      `The "${SHEET_NAME}" sheet is missing column(s): ${missing.join(", ")}. Found: ${[...byName.keys()].join(" | ")}`,
    );
  }
  return byName;
}

function readFunctionCodes(
  sheet: Sheet,
  header: Map<string, string>,
  lastRow: number,
): FunctionCode[] {
  const nameCol = header.get(CODE_HEADER[0]);
  const codeCol = header.get(CODE_HEADER[1]);
  if (!nameCol || !codeCol) {
    throw new Error(
      `The function-code table the sheet's formulas use is missing (headers "${CODE_HEADER[0]}" and "${CODE_HEADER[1]}").`,
    );
  }
  const codes: FunctionCode[] = [];
  for (let r = 2; r <= lastRow; r++) {
    const name = cellValue(sheet, nameCol, r);
    const code = cellValue(sheet, codeCol, r);
    if (name && code) codes.push({ code, name });
  }
  return codes;
}

/** Column letters in sheet order: A … Z, AA, AB … */
const columnOrder = (a: string, b: string) =>
  a.length - b.length || compareText(a, b);

/**
 * Turn the sheet into rows. Throws on anything the seed could not carry — an
 * unknown pillar, maturity or function, an unparseable control, a stale
 * formula — and lists every offender at once. Returns everything else with its
 * findings.
 */
export function transformSheet(sheet: Sheet): Transformed {
  const header = readHeader(sheet);
  const lastRow = Math.max(...sheet.keys());
  const functionCodes = readFunctionCodes(sheet, header, lastRow);
  const codeByName = new Map(functionCodes.map((f) => [f.name, f.code]));
  const known = new Set<string>([...SHEET_HEADER, ...CODE_HEADER]);
  const extras = [...header]
    .filter(([name]) => !known.has(name))
    .sort((a, b) => columnOrder(a[1], b[1]));
  const extraColumns = extras.map(([name]) => extraColumnName(name));
  const headerOf = new Map<string, string>();
  const clashes: string[] = [];
  extras.forEach(([name], i) => {
    const other = headerOf.get(extraColumns[i]!);
    if (other !== undefined) {
      clashes.push(`"${other}" and "${name}" both become ${extraColumns[i]}`);
    } else headerOf.set(extraColumns[i]!, name);
  });
  if (clashes.length) {
    throw new Error(
      `Extra columns in "${SHEET_NAME}" would share a CSV column, and one would be lost: ${clashes.join("; ")}. Rename one in the workbook.`,
    );
  }
  const present = (h: string) => header.has(h);

  const raw: { r: number; v: string[]; extra: Record<string, string> }[] = [];
  for (let r = 2; r <= lastRow; r++) {
    const v = SHEET_HEADER.map((h) =>
      present(h) ? cellValue(sheet, header.get(h)!, r) : "",
    );
    if (v.slice(0, REQUIRED_COLUMNS).every((x) => x === "")) continue;
    const extra: Record<string, string> = {};
    extras.forEach(([, col], i) => {
      extra[extraColumns[i]!] = cellValue(sheet, col, r);
    });
    raw.push({ r, v, extra });
  }

  assertNoCollisions(raw.map(({ v }) => v[0]!));

  const errors: string[] = [];
  const findings: Finding[] = [];
  const rows: CisaRow[] = [];

  // The formulas' COUNTIF and COUNTIFS, over the cells as stored.
  const byControl = new Map<string, number>();
  const byControlPillar = new Map<string, number>();
  for (const { v } of raw) {
    byControl.set(v[0]!, (byControl.get(v[0]!) ?? 0) + 1);
    const k = `${v[0]}\u0000${v[3]}`;
    byControlPillar.set(k, (byControlPillar.get(k) ?? 0) + 1);
  }

  for (const { r, v, extra } of raw) {
    const [
      id,
      name,
      text,
      pillarRaw,
      functionRaw,
      maturityRaw,
      designation,
      ifApplicable,
      multiPillars,
      pillarDupId,
      multiFunctions,
      functionDupId,
    ] = v as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    for (let i = 0; i < 8; i++) {
      if (v[i] === "") errors.push(`row ${r}: "${SHEET_HEADER[i]}" is empty`);
    }

    let controlId = "";
    try {
      const parsed = canonicalize(id);
      if (parsed.declaredMalformed || parsed.letter) {
        errors.push(
          `row ${r}: control ${JSON.stringify(id)} is not a whole control`,
        );
      }
      controlId = parsed.controlNumber;
    } catch (e) {
      errors.push(`row ${r}: ${(e as Error).message}`);
    }

    // Recompute the three formula columns exactly as the sheet defines them.
    const nControl = byControl.get(id) ?? 0;
    const nControlPillar = byControlPillar.get(`${id}\u0000${pillarRaw}`) ?? 0;
    const expectPillarDup =
      nControl === 1 ? "-" : `${id}_PIL_${PILLAR_CODES[pillarRaw] ?? ""}`;
    const expectMultiFunctions = nControlPillar > 1 ? "Yes" : "-";
    const expectFunctionDup =
      nControlPillar === 1
        ? "-"
        : `${id}_FUN_${codeByName.get(functionRaw) ?? ""}`;
    for (const [col, stored, computed] of [
      [SHEET_HEADER[9], pillarDupId, expectPillarDup],
      [SHEET_HEADER[10], multiFunctions, expectMultiFunctions],
      [SHEET_HEADER[11], functionDupId, expectFunctionDup],
    ] as const) {
      if (present(col) && stored !== computed) {
        errors.push(
          `row ${r}: ${col} caches ${JSON.stringify(stored)} but its formula gives ${JSON.stringify(computed)}; recalculate the workbook`,
        );
      }
    }
    // "Appears in Multiple Pillars" is typed by hand, so a disagreement is a
    // finding, not a failure.
    const expectMultiPillars = nControl > 1 ? "Yes" : "-";
    if (present(SHEET_HEADER[8]) && multiPillars !== expectMultiPillars) {
      findings.push({
        kind: "hand-entered column disagrees",
        rows: [r],
        controlId: controlId || id,
        detail: `"Appears in Multiple Pillars" is ${JSON.stringify(multiPillars)}, but the control appears on ${nControl} rows`,
      });
    }
    if (nControlPillar > 1 && !codeByName.has(functionRaw)) {
      findings.push({
        kind: "function code not found",
        rows: [r],
        controlId: controlId || id,
        detail: `"${functionRaw}" is not spelled as in the function-code table, so its Function Duplicate ID has no code: ${functionDupId}`,
      });
    }

    const pillar = PILLARS[pillarRaw];
    if (!pillar)
      errors.push(`row ${r}: unknown pillar ${JSON.stringify(pillarRaw)}`);

    const maturity = MATURITIES[maturityRaw];
    if (!maturity)
      errors.push(`row ${r}: unknown maturity ${JSON.stringify(maturityRaw)}`);

    const { name: fnName, change } = normaliseFunction(functionRaw);
    const group = pillar ? FUNCTION_GROUPS[pillar][fnName] : undefined;
    if (pillar && !group) {
      errors.push(`row ${r}: no guidance group for ${pillar} "${fnName}"`);
    }
    if (group && !codeByName.has(group)) {
      errors.push(
        `row ${r}: ${pillar} "${fnName}" is read as "${group}", which is not in the sheet's function-code table`,
      );
    }
    const transforms = [
      change,
      group && group !== fnName ? `renamed from "${fnName}"` : null,
    ].filter(Boolean);
    if (change) {
      findings.push({
        kind: "function spelling",
        rows: [r],
        controlId: controlId || id,
        detail: `"${functionRaw}" carries extra whitespace`,
      });
    }
    if (fnName && !codeByName.has(fnName)) {
      findings.push({
        kind: "function outside the sheet's own list",
        rows: [r],
        controlId: controlId || id,
        detail: `"${fnName}" is not one of the function names in the sheet's code table; read as ${group ?? "nothing"}`,
      });
    }

    if (!["Key", "Supporting", "Informative"].includes(designation)) {
      errors.push(
        `row ${r}: unknown designation ${JSON.stringify(designation)}`,
      );
    }
    if (!["Yes", "-"].includes(ifApplicable)) {
      errors.push(
        `row ${r}: unknown If Applicable value ${JSON.stringify(ifApplicable)}`,
      );
    }

    if (!pillar || !maturity || !group || !controlId) continue;

    rows.push({
      sourceRow: r,
      controlId,
      pillar,
      function: group,
      maturity,
      designation,
      ifApplicable: ifApplicable === "Yes",
      functionTransform: transforms.length
        ? transforms.join("; ")
        : "as published",
      cisa: {
        controlId: id,
        pillar: pillarRaw,
        function: functionRaw,
        maturity: maturityRaw,
        functionCode:
          codeByName.get(functionRaw) ?? codeByName.get(fnName) ?? "",
        multiplePillars: multiPillars,
        pillarDuplicateId: pillarDupId,
        multipleFunctions: multiFunctions,
        functionDuplicateId: functionDupId,
        controlName: name,
        controlText: text,
        extra,
      },
    });
  }

  if (errors.length) {
    throw new Error(
      `${errors.length} row problem(s) in "${SHEET_NAME}":\n  ${errors.join("\n  ")}`,
    );
  }

  findings.push(...crossRowFindings(rows));
  return { rows, extraColumns, functionCodes, findings };
}

/** Findings that only show across rows: repeats, disagreements, and a control
 *  named two ways. */
export function crossRowFindings(rows: CisaRow[]): Finding[] {
  const findings: Finding[] = [];
  const group = <K>(key: (row: CisaRow) => K) => {
    const m = new Map<string, CisaRow[]>();
    for (const row of rows) {
      const k = JSON.stringify(key(row));
      m.set(k, [...(m.get(k) ?? []), row]);
    }
    return [...m.values()];
  };

  for (const same of group((x) => [
    x.controlId,
    x.pillar,
    x.function,
    x.maturity,
  ])) {
    if (same.length < 2) continue;
    const designations = [...new Set(same.map((x) => x.designation))];
    findings.push({
      kind:
        designations.length > 1
          ? "duplicate row, designations disagree"
          : "duplicate row",
      rows: same.map((x) => x.sourceRow),
      controlId: same[0]!.controlId,
      detail:
        `${same.length} rows map ${same[0]!.pillar} ${same[0]!.function} at ${same[0]!.maturity}` +
        (designations.length > 1
          ? `, designated ${designations.join(" and ")}`
          : ""),
    });
  }

  for (const same of group((x) => [x.controlId, x.pillar, x.function])) {
    const maturities = [...new Set(same.map((x) => x.maturity))];
    if (maturities.length < 2) continue;
    findings.push({
      kind: "one function at two maturities",
      rows: same.map((x) => x.sourceRow),
      controlId: same[0]!.controlId,
      detail: `${same[0]!.pillar} ${same[0]!.function} at ${maturities.join(" and ")}`,
    });
  }

  for (const same of group((x) => x.controlId)) {
    const names = [...new Set(same.map((x) => x.cisa.controlName.trim()))];
    if (names.length < 2) continue;
    findings.push({
      kind: "control named two ways",
      rows: same.map((x) => x.sourceRow),
      controlId: same[0]!.controlId,
      detail: names.map((n) => JSON.stringify(n)).join(" vs "),
    });
  }
  return findings;
}

export function toCsvRow(row: CisaRow): (string | number)[] {
  return [
    row.sourceRow,
    row.controlId,
    row.pillar,
    row.function,
    row.maturity,
    row.designation,
    row.ifApplicable ? "yes" : "no",
    row.functionTransform,
    row.cisa.controlId,
    row.cisa.pillar,
    row.cisa.function,
    row.cisa.maturity,
    row.cisa.functionCode,
    row.cisa.multiplePillars,
    row.cisa.pillarDuplicateId,
    row.cisa.multipleFunctions,
    row.cisa.functionDuplicateId,
    row.cisa.controlName,
    row.cisa.controlText,
    ...Object.values(row.cisa.extra),
  ];
}
