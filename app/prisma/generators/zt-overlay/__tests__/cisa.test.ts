import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CSV_HEADER,
  FUNCTION_GROUPS,
  SHEET_HEADER,
  toCsvRow,
  transformSheet,
} from "../lib/cisa";
import { SOURCES_DIR } from "../lib/paths";
import type { Sheet } from "../lib/xlsx";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const CODES: [string, string][] = [
  ["0201", "Authentication"],
  ["0204", "Access Management"],
  ["0301", "Traffic Management"],
  ["0401", "Application Access"],
  ["0407", "Application Automation and Orchestration"],
];
const PIL: Record<string, string> = {
  Device: "01",
  Identity: "02",
  Network: "03",
  Application: "04",
  Data: "05",
};

type Row = [string, string, string, string, string, string, string, string];

/** A sheet whose formula columns hold what the workbook's formulas would cache. */
function sheetOf(
  rows: Row[],
  override?: (r: string[], i: number) => void,
): Sheet {
  const sheet: Sheet = new Map();
  const set = (row: number, col: string, value: string) => {
    const cells =
      sheet.get(row) ?? new Map<string, { value: string; formula: boolean }>();
    cells.set(col, { value, formula: false });
    sheet.set(row, cells);
  };
  SHEET_HEADER.forEach((h, i) => set(1, COLS[i]!, h));
  set(1, "Z", "AA (Function Name)");
  set(1, "AA", "AB (Function Number)");
  CODES.forEach(([code, name], i) => {
    set(i + 2, "Z", name);
    set(i + 2, "AA", code);
  });
  const code = new Map(CODES.map(([c, n]) => [n, c]));
  rows.forEach((r, i) => {
    const nA = rows.filter((x) => x[0] === r[0]).length;
    const nAD = rows.filter((x) => x[0] === r[0] && x[3] === r[3]).length;
    const full = [
      ...r,
      nA > 1 ? "Yes" : "-",
      nA === 1 ? "-" : `${r[0]}_PIL_${PIL[r[3]] ?? ""}`,
      nAD > 1 ? "Yes" : "-",
      nAD === 1 ? "-" : `${r[0]}_FUN_${code.get(r[4]) ?? ""}`,
    ];
    override?.(full, i);
    full.forEach((v, c) => set(i + 2, COLS[c]!, v));
  });
  return sheet;
}

const base: Row[] = [
  [
    "AC-2",
    "Account Management",
    "a. Define...",
    "Identity",
    "Access Management",
    "Traditional+",
    "Key",
    "-",
  ],
  [
    "AC-2",
    "Account Management",
    "a. Define...",
    "Network",
    "Traffic Management",
    "Advanced+",
    "Supporting",
    "Yes",
  ],
  [
    "IA-2(1)",
    "Multi-factor",
    "Implement...",
    "Identity",
    "Authentication",
    "Optimal",
    "Informative",
    "-",
  ],
];

describe("transformSheet", () => {
  it("reads every row into the seed's vocabulary and keeps what was published", () => {
    const { rows, functionCodes, findings } = transformSheet(sheetOf(base));
    expect(
      rows.map((r) => [r.controlId, r.pillar, r.function, r.maturity]),
    ).toEqual([
      ["AC-02", "IDENTITY", "Access Management", "TRADITIONAL"],
      ["AC-02", "NETWORKS", "Traffic Management", "ADVANCED"],
      ["IA-02(01)", "IDENTITY", "Authentication", "OPTIMAL"],
    ]);
    expect(rows[1]!.functionTransform).toBe("as published");
    expect(rows[1]!.ifApplicable).toBe(true);
    expect(rows[1]!.cisa).toMatchObject({
      controlId: "AC-2",
      pillar: "Network",
      maturity: "Advanced+",
      functionCode: "0301",
    });
    expect(functionCodes).toHaveLength(CODES.length);
    expect(findings).toEqual([]);
  });

  it("writes a CSV row for every header column", () => {
    const { rows } = transformSheet(sheetOf(base));
    expect(toCsvRow(rows[0]!)).toHaveLength(CSV_HEADER.length);
  });

  it("stops when a mapping column is missing", () => {
    const sheet = sheetOf(base);
    sheet.get(1)!.set("E", { value: "Function", formula: false });
    expect(() => transformSheet(sheet)).toThrow(
      /missing column\(s\): ZT Function/,
    );
  });

  it("reads a later edition: columns reordered, one added, the analysis columns dropped", () => {
    const sheet = sheetOf(base);
    for (const cells of sheet.values()) {
      const a = cells.get("A");
      const b = cells.get("B");
      if (a) cells.set("B", a);
      if (b) cells.set("A", b);
      for (const col of ["I", "J", "K", "L"]) cells.delete(col);
    }
    sheet.get(1)!.set("M", { value: "Implementation Notes", formula: false });
    sheet.get(2)!.set("M", { value: "see playbook", formula: false });
    const { rows, extraColumns } = transformSheet(sheet);
    expect(rows.map((r) => r.controlId)).toEqual([
      "AC-02",
      "AC-02",
      "IA-02(01)",
    ]);
    expect(extraColumns).toEqual(["cisa_extra_implementation_notes"]);
    expect(rows[0]!.cisa.extra).toEqual({
      cisa_extra_implementation_notes: "see playbook",
    });
    expect(toCsvRow(rows[0]!)).toHaveLength(CSV_HEADER.length + 1);
  });

  it("stops when two columns carry the same header", () => {
    const sheet = sheetOf(base);
    sheet.get(1)!.set("M", { value: "Designation", formula: false });
    expect(() => transformSheet(sheet)).toThrow(
      /names a column twice: "Designation" in columns G and M/,
    );
  });

  it("stops when two extra headers would become one CSV column", () => {
    const sheet = sheetOf(base);
    sheet.get(1)!.set("M", { value: "Notes", formula: false });
    sheet.get(1)!.set("N", { value: "Notes?", formula: false });
    expect(() => transformSheet(sheet)).toThrow(
      /"Notes" and "Notes\?" both become cisa_extra_notes/,
    );
  });

  it("stops on a formula value that no longer matches its formula", () => {
    const sheet = sheetOf(base, (r, i) => {
      if (i === 2) r[9] = "IA-2(1)_PIL_02";
    });
    expect(() => transformSheet(sheet)).toThrow(
      /row 4: Pillar Duplicate ID caches .* recalculate the workbook/,
    );
  });

  it("stops on an unknown pillar, maturity, function or designation, listing each", () => {
    const sheet = sheetOf([
      [
        "AC-3",
        "x",
        "x",
        "Cloud",
        "Access Management",
        "Traditional+",
        "Key",
        "-",
      ],
      ["AC-4", "x", "x", "Identity", "Access Management", "Expert", "Key", "-"],
      ["AC-5", "x", "x", "Identity", "Telepathy", "Traditional+", "Key", "-"],
      [
        "AC-6",
        "x",
        "x",
        "Identity",
        "Access Management",
        "Traditional+",
        "Vital",
        "-",
      ],
    ]);
    expect(() => transformSheet(sheet)).toThrow(
      /4 row problem\(s\)[\s\S]*unknown pillar "Cloud"[\s\S]*unknown maturity "Expert"[\s\S]*no guidance group for IDENTITY "Telepathy"[\s\S]*unknown designation "Vital"/,
    );
  });

  it("stops on a statement item, which is not a whole control", () => {
    const sheet = sheetOf([
      [
        "AC-2a",
        "x",
        "x",
        "Identity",
        "Access Management",
        "Traditional+",
        "Key",
        "-",
      ],
    ]);
    expect(() => transformSheet(sheet)).toThrow(/not a whole control/);
  });

  it("records what looks wrong without stopping", () => {
    const sheet = sheetOf(
      [
        [
          "AC-2",
          "Account Management",
          "x",
          "Identity",
          "Access Management",
          "Traditional+",
          "Key",
          "-",
        ],
        [
          "AC-2",
          "Account management",
          "x",
          "Identity",
          "Access Management",
          "Traditional+",
          "Supporting",
          "-",
        ],
        [
          "AC-2",
          "Account Management",
          "x",
          "Identity",
          "Access Management",
          "Initial+",
          "Key",
          "-",
        ],
        [
          "AC-17",
          "Remote Access",
          "x",
          "Application",
          "Application Access ",
          "Traditional+",
          "Key",
          "-",
        ],
        [
          "AC-17",
          "Remote Access",
          "x",
          "Application",
          "Automation and Orchestration",
          "Traditional+",
          "Key",
          "-",
        ],
      ],
      (r, i) => {
        if (i === 3) r[8] = "-";
      },
    );
    const { rows, findings } = transformSheet(sheet);
    expect(rows).toHaveLength(5);
    expect(rows[3]!.function).toBe("Application Access");
    expect(rows[3]!.functionTransform).toBe("whitespace trimmed");
    expect(rows[4]!.function).toBe("Application Automation and Orchestration");
    expect(rows[4]!.functionTransform).toBe(
      'renamed from "Automation and Orchestration"',
    );
    const kinds = findings
      .map((f) => `${f.kind} ${f.controlId} ${f.rows.join(";")}`)
      .sort();
    expect(kinds).toEqual([
      "control named two ways AC-02 2;3;4",
      "duplicate row, designations disagree AC-02 2;3",
      "function code not found AC-17 5",
      "function code not found AC-17 6",
      "function outside the sheet's own list AC-17 6",
      "function spelling AC-17 5",
      "hand-entered column disagrees AC-17 5",
      "one function at two maturities AC-02 2;3;4",
    ]);
  });
});

describe("FUNCTION_GROUPS", () => {
  it("seeds every function under the name in CISA's own function-code table", () => {
    const table = readFileSync(
      join(SOURCES_DIR, "cisa-ztmm-functions.csv"),
      "utf8",
    );
    const names = new Set(
      table
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.slice(line.indexOf(",") + 1)),
    );
    for (const [pillar, groups] of Object.entries(FUNCTION_GROUPS)) {
      for (const [published, seeded] of Object.entries(groups))
        expect(names.has(seeded), `${pillar} ${published} -> ${seeded}`).toBe(
          true,
        );
    }
  });

  it("stops on a function read as a name the sheet's code table lacks", () => {
    const sheet = sheetOf([
      [
        "AC-2",
        "Account Management",
        "x",
        "Identity",
        "Identity Visibility and Analytics",
        "Initial+",
        "Key",
        "-",
      ],
    ]);
    expect(() => transformSheet(sheet)).toThrow(
      /not in the sheet's function-code table/,
    );
  });
});
