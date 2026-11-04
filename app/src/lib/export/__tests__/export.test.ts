// @vitest-environment node
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

// The selection's parsers read the product config, which validates ~/env at import; nothing here connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});

import { buildCopyText } from "../copy-text";
import { bookmarkFor, writeDocx } from "../docx";
import {
  LINE_FIELDS,
  toExportControl,
  type DetailSource,
} from "../from-detail";
import { EXPORT_DATASETS, EXPORT_FIELDS, type ExportRecord } from "../record";
import {
  exportSelectionSchema,
  loadExportSelection,
  serializeExportSelection,
} from "../selection";
import {
  columnLayout,
  EXCEL_CELL_LIMIT,
  exportSheets,
  fitCell,
  rowHeight,
  writeXlsx,
} from "../xlsx";

const LABELS = {
  discussionHeading: "Discussion",
  enhancementChip: "Enhancement-specific",
};

const detail = (over: Partial<DetailSource> = {}): DetailSource => ({
  id: "AC-02",
  oscalId: "ac-2",
  name: "Account Management",
  description: "Manage accounts.\n  a. Define types [Low: x]",
  discussion: "It says so.",
  baselines: ["Low", "Moderate"],
  frequency: {
    nist: [
      {
        part: null,
        before: "Review accounts",
        parameter: "organization-defined frequency",
        after: ".",
      },
      {
        part: "(c)",
        before: "Audit",
        parameter: "organization-defined frequency",
        after: "and report",
      },
    ],
  },
  parts: [
    {
      parameters: [
        { label: "frequency", values: [{ baselines: ["LOW"], value: "x" }] },
      ],
      children: [
        {
          parameters: [
            { label: "roles", values: [{ baselines: ["HIGH"], value: "y" }] },
          ],
          children: [],
        },
      ],
    },
  ],
  ztMapping: {
    pillar: "IDENTITY",
    function: "Authentication",
    maturity: "ADVANCED",
    guidance: "Use MFA.",
    affinities: [
      {
        pillar: "IDENTITY",
        function: "Authentication",
        maturity: "ADVANCED",
        guidance: "Use MFA.",
        designation: "KEY",
        ifApplicable: false,
      },
    ],
  },
  ztLinks: [{ label: "ZT doc", url: "https://example.gov/zt" }],
  nistLinks: [],
  ...over,
});

describe("toExportControl", () => {
  it("collects parameters from every level of the part tree", () => {
    const c = toExportControl(detail(), null, EXPORT_DATASETS, EXPORT_FIELDS);
    expect(c.statement!.parameters.map((p) => p.label)).toEqual([
      "frequency",
      "roles",
    ]);
    expect(c.family).toBe("AC");
  });

  it("leaves an unchosen dataset undefined, and never fills assessment here", () => {
    const c = toExportControl(detail(), null, ["zeroTrust"], EXPORT_FIELDS);
    expect(c.statement).toBeUndefined();
    expect(c.references).toBeUndefined();
    expect(c.assessment).toBeUndefined();
    expect(c.zeroTrust).toHaveLength(1);
  });

  it("leaves an unchosen field undefined", () => {
    const c = toExportControl(detail(), null, EXPORT_DATASETS, []);
    expect(c.baselines).toBeUndefined();
    expect(c.frequency).toBeUndefined();
    expect(c.priority).toBeUndefined();
    expect(c.lineage).toBeUndefined();
  });

  it("on an enhancement with no frequency of its own, names its base's in words", () => {
    const base = detail();
    const enh = toExportControl(
      detail({ id: "AC-02(01)", frequency: { nist: [] } }),
      base,
      [],
      ["frequency"],
    );
    expect(enh.frequency!.map((f) => f.label)).toEqual([
      "AC-02 statement",
      "AC-02 item (c)",
    ]);
    const own = toExportControl(
      detail({ id: "AC-02(01)" }),
      base,
      [],
      ["frequency"],
    );
    expect(own.frequency!.map((f) => f.label)).toEqual([
      "statement",
      "item (c)",
    ]);
  });

  it("carries a withdrawn control's lineage as the lines Copy prints", () => {
    const c = toExportControl(
      detail({ catalogStatus: "withdrawn", lineage: null }),
      null,
      [],
      ["lineage"],
    );
    expect(c.lineage).toEqual(["Status: Withdrawn"]);
    expect(toExportControl(detail(), null, [], ["lineage"]).lineage).toEqual(
      [],
    );
  });

  it("falls back to the representative tuple on the pre-load shape", () => {
    const zt = { ...detail().ztMapping!, affinities: undefined };
    const c = toExportControl(
      detail({ ztMapping: zt }),
      null,
      ["zeroTrust"],
      EXPORT_FIELDS,
    );
    expect(c.zeroTrust).toEqual([
      {
        pillar: "IDENTITY",
        function: "Authentication",
        maturity: "ADVANCED",
        guidance: "Use MFA.",
      },
    ]);
  });
});

describe("toExportControl on the catalog's SP 800-53A content", () => {
  it("labels identifiers and methods as the modal does, keeping a missing method", () => {
    const c = toExportControl(
      detail({
        assessment: {
          objectives: [
            { identifier: "DS-AC-02a.[01]", text: "types are defined" },
          ],
          methods: [
            { method: "EXAMINE", text: "policy" },
            { method: "TEST", text: null },
          ],
        },
      }),
      null,
      ["assessment"],
      [],
    );
    expect(c.assessment).toEqual({
      objectives: [{ identifier: "AC-02a.[01]", text: "types are defined" }],
      methods: [
        { method: "Examine", text: "policy" },
        { method: "Test", text: null },
      ],
    });
    expect(
      buildCopyText({ ...c, lineage: ["Status: Withdrawn"] }, LABELS).split(
        "\n",
      ),
    ).toEqual([
      "Control: AC-02 - Account Management",
      "Status: Withdrawn",
      "Description: ",
      "ZT Guidance: N/A",
      "Assessment Procedures:",
      "  AC-02a.[01] types are defined",
      "  Examine: policy",
      "  Test: none published for this control",
    ]);
  });

  it("is an empty assessment, not a missing one, when the control has none", () => {
    const c = toExportControl(detail(), null, ["assessment"], []);
    expect(c.assessment).toEqual({ objectives: [], methods: [] });
  });

  it("writes the discussion's markdown links as the modal shows them", () => {
    const c = toExportControl(
      detail({
        discussion:
          "See [AC-11](#ac-11), [AC-17(1)](#ac-17.1) and [SP 800-63](#a1b2-c3). Ask [ncdsmo@nsa.gov](mailto:ncdsmo@nsa.gov) or [the guide](https://example.gov/g).",
      }),
      null,
      ["statement"],
      [],
    );
    expect(c.statement?.discussion).toBe(
      "See AC-11, AC-17(1) and SP 800-63. Ask ncdsmo@nsa.gov or the guide (https://example.gov/g).",
    );
    expect(
      toExportControl(detail({ discussion: null }), null, ["statement"], [])
        .statement?.discussion,
    ).toBeNull();
  });
});

describe("buildCopyText", () => {
  it("lays out a single-tuple control with every field", () => {
    const c = toExportControl(detail(), null, EXPORT_DATASETS, EXPORT_FIELDS);
    expect(buildCopyText(c, LABELS)).toBe(
      [
        "Control: AC-02 - Account Management",
        "Baselines: Low, Moderate",
        "Frequency:",
        "  - Catalog statement: Review accounts [organization-defined frequency].",
        "  - Catalog item (c): Audit [organization-defined frequency] and report",
        "Description: Manage accounts.\n  a. Define types [Low: x]",
        "ZT Guidance (Key): Use MFA.",
        "Discussion: It says so.",
        "References:",
        "  - ZT doc: https://example.gov/zt",
      ].join("\n"),
    );
  });

  it("lists every tuple when a control has more than one", () => {
    const tuples = [
      {
        pillar: "IDENTITY",
        function: "A",
        maturity: "INITIAL",
        guidance: "g1",
      },
      {
        pillar: "DATA",
        function: "B",
        maturity: "OPTIMAL",
        guidance: "g2",
        designation: "SUPPORTING",
        ifApplicable: true,
      },
    ];
    const c = toExportControl(
      detail({ ztMapping: { ...detail().ztMapping!, affinities: tuples } }),
      null,
      ["zeroTrust"],
      EXPORT_FIELDS,
    );
    expect(buildCopyText(c, LABELS)).toContain(
      "ZT Guidance:\n  - IDENTITY / A / INITIAL (Unassigned): g1\n  - DATA / B / OPTIMAL (Supporting, If applicable): g2",
    );
  });

  it("on an enhancement, chips its own references and inherits its base's once", () => {
    const base = detail({
      ztLinks: [
        { label: "Shared", url: "https://example.gov/shared" },
        { label: "Base only", url: "https://example.gov/base" },
      ],
    });
    const enh = toExportControl(
      detail({
        id: "AC-02(01)",
        ztLinks: [{ label: "Shared", url: "https://example.gov/shared/" }],
      }),
      base,
      EXPORT_DATASETS,
      EXPORT_FIELDS,
    );
    expect(enh.references!.map((r) => [r.url, r.scope])).toEqual([
      ["https://example.gov/shared/", "enhancement"],
      ["https://example.gov/base", "base"],
    ]);
    expect(buildCopyText(enh, LABELS)).toContain(
      "References:\n  - Shared (enhancement-specific): https://example.gov/shared/\n  - Base only: https://example.gov/base",
    );
  });

  it("lists a base control's own references once each, unchipped", () => {
    const c = toExportControl(
      detail({
        ztLinks: [
          { label: "A", url: "https://example.gov/a" },
          { label: "A again", url: "https://example.gov/a/" },
        ],
      }),
      null,
      ["references"],
      EXPORT_FIELDS,
    );
    expect(c.references).toEqual([
      {
        pane: "zeroTrust",
        label: "A",
        url: "https://example.gov/a",
        citation: null,
      },
    ]);
  });

  it("shows assessment methods even when a control has no objectives", () => {
    const text = buildCopyText(
      {
        id: "AC-09",
        oscalId: null,
        name: "Previous Logon Notification",
        family: "AC",
        baseId: null,
        baselines: [],
        assessment: {
          objectives: [],
          methods: [{ method: "Examine", text: null }],
        },
      },
      LABELS,
    );
    expect(text).toContain(
      "Assessment Procedures:\n  Examine: none published for this control",
    );
  });

  it("puts lineage under the title, says when no priority is assigned, and leaves out fields not chosen", () => {
    const text = buildCopyText(
      {
        id: "AC-13",
        oscalId: null,
        name: "Supervision and Review",
        family: "AC",
        baseId: null,
        priority: null,
        lineage: ["Status: Withdrawn, incorporated into AC-02"],
      },
      LABELS,
    );
    expect(text).toBe(
      "Control: AC-13 - Supervision and Review\nStatus: Withdrawn, incorporated into AC-02\nPriority: none assigned\nDescription: \nZT Guidance: N/A",
    );
  });

  it("copies an unloaded control as its identity and N/A", () => {
    expect(
      buildCopyText(
        {
          id: "AC-09",
          oscalId: null,
          name: "Previous Logon Notification",
          family: "AC",
          baseId: null,
          baselines: [],
        },
        LABELS,
      ),
    ).toBe(
      "Control: AC-09 - Previous Logon Notification\nDescription: \nZT Guidance: N/A",
    );
  });
});

describe("the selection URL", () => {
  it("defaults to the whole catalog, base and enhancements, every dataset", () => {
    const s = loadExportSelection("https://x.test/api/export");
    expect(s.pick).toEqual([]);
    expect(s.enhancements).toBe("with");
    expect(s.data).toEqual([...EXPORT_DATASETS]);
    expect(s.fields).toEqual([...EXPORT_FIELDS]);
  });

  it("is refused by the procedure's schema when it names a facet the app lacks", () => {
    const s = loadExportSelection("https://x.test/api/export");
    expect(exportSelectionSchema.safeParse(s).success).toBe(true);
    expect(
      exportSelectionSchema.safeParse({ ...s, notAFacet: ["X"] }).success,
    ).toBe(false);
  });

  it("round-trips through the serializer, and drops values it does not know", () => {
    const url = serializeExportSelection("https://x.test/api/export", {
      family: ["AC"],
      pick: ["AC-02", "AC-02(01)"],
      enhancements: "without",
      data: ["statement"],
      fields: ["priority"],
    });
    const s = loadExportSelection(url + "&pillar=NOT_A_PILLAR");
    expect(s.family).toEqual(["AC"]);
    expect(s.pick).toEqual(["AC-02", "AC-02(01)"]);
    expect(s.enhancements).toBe("without");
    expect(s.data).toEqual(["statement"]);
    expect(s.fields).toEqual(["priority"]);
    expect(s.pillar).toEqual([]);
  });
});

const record = (): ExportRecord => ({
  catalog: "Example Catalog 1.0",
  versionId: "v1",
  datasets: ["statement", "zeroTrust", "references"],
  fields: [...LINE_FIELDS],
  controls: [
    toExportControl(detail(), null, EXPORT_DATASETS, EXPORT_FIELDS),
    toExportControl(
      detail({
        id: "AC-02(01)",
        oscalId: "ac-2.1",
        parts: [],
        ztLinks: [{ label: "Own", url: "https://example.gov/own" }],
      }),
      detail(),
      EXPORT_DATASETS,
      EXPORT_FIELDS,
    ),
  ],
});

describe("exportSheets", () => {
  it("writes one sheet per chosen dataset, each row keyed by control", () => {
    const sheets = exportSheets(record());
    expect(sheets.map((s) => s.name)).toEqual([
      "Controls",
      "Frequency",
      "Statement",
      "Parameters",
      "Zero Trust",
      "References",
    ]);
    for (const s of sheets) {
      expect(s.header[0]).toBe("Control");
      for (const row of s.rows)
        expect(["AC-02", "AC-02(01)"]).toContain(row[0]);
    }
    const controls = sheets[0]!;
    expect(controls.rows[1]).toEqual([
      "AC-02(01)",
      "ac-2.1",
      "Account Management",
      "AC",
      "AC-02",
      "Low, Moderate",
      null,
    ]);
    expect(sheets[1]!.rows.slice(0, 2)).toEqual([
      [
        "AC-02",
        "Catalog",
        "statement",
        "Review accounts [organization-defined frequency].",
      ],
      [
        "AC-02",
        "Catalog",
        "item (c)",
        "Audit [organization-defined frequency] and report",
      ],
    ]);
    expect(sheets[3]!.rows).toEqual([
      ["AC-02", "frequency", "LOW", "x"],
      ["AC-02", "roles", "HIGH", "y"],
    ]);
    expect(sheets[5]!.rows).toEqual([
      ["AC-02", "Zero Trust", "ZT doc", "https://example.gov/zt", null],
      ["AC-02(01)", "Zero Trust", "Own", "https://example.gov/own", null],
      ["AC-02(01)", "Zero Trust", "ZT doc", "https://example.gov/zt", "AC-02"],
    ]);
  });

  it("adds the Parameters sheet only when the selection has parameters", () => {
    const names = (r: ExportRecord) => exportSheets(r).map((s) => s.name);
    expect(names(record())).toContain("Parameters");
    const r = record();
    for (const c of r.controls) if (c.statement) c.statement.parameters = [];
    expect(names(r)).toContain("Statement");
    expect(names(r)).not.toContain("Parameters");
  });

  it("adds the Citation column only when some reference carries a citation", () => {
    const references = (r: ExportRecord) =>
      exportSheets(r).find((s) => s.name === "References")!;
    expect(references(record()).header).not.toContain("Citation");
    const r = record();
    r.controls[0]!.references![0]!.citation = "SP 800-207, §3";
    const sheet = references(r);
    expect(sheet.header).toEqual([
      "Control",
      "Pane",
      "Title",
      "URL",
      "Citation",
      "Inherited from",
    ]);
    expect(sheet.rows[0]![4]).toBe("SP 800-207, §3");
  });

  it("leaves out the columns and sheet of fields not chosen, and adds lineage's", () => {
    const r = record();
    r.fields = ["lineage"];
    r.controls[0]!.lineage = ["Status: Withdrawn", "New in 5.1"];
    const [controls, next] = exportSheets(r);
    expect(controls!.header).toEqual([
      "Control",
      "OSCAL ID",
      "Name",
      "Family",
      "Base control",
      "Lineage",
    ]);
    expect(controls!.rows[0]!.at(-1)).toBe("Status: Withdrawn\nNew in 5.1");
    expect(next!.name).toBe("Statement");
  });

  it("adds CISA's designation and If Applicable to the Zero Trust sheet", () => {
    const zt = exportSheets(record()).find((s) => s.name === "Zero Trust")!;
    expect(zt.header).toEqual([
      "Control",
      "Pillar",
      "Function",
      "Maturity",
      "CISA designation",
      "If applicable",
      "Guidance",
    ]);
    expect(zt.rows[0]).toEqual([
      "AC-02",
      "IDENTITY",
      "Authentication",
      "ADVANCED",
      "Key",
      null,
      "Use MFA.",
    ]);
    const r = record();
    r.controls[0]!.zeroTrust = [
      {
        ...r.controls[0]!.zeroTrust![0]!,
        designation: null,
        ifApplicable: true,
      },
    ];
    expect(
      exportSheets(r)
        .find((s) => s.name === "Zero Trust")!
        .rows[0]!.slice(4, 6),
    ).toEqual(["Unassigned", "Yes"]);
  });

  it("leaves CISA's columns out for tuples without its mapping", () => {
    const r = record();
    for (const c of r.controls)
      c.zeroTrust = c.zeroTrust?.map(
        ({ designation: _d, ifApplicable: _i, ...t }) => t,
      );
    const zt = exportSheets(r).find((s) => s.name === "Zero Trust")!;
    expect(zt.header).toEqual([
      "Control",
      "Pillar",
      "Function",
      "Maturity",
      "Guidance",
    ]);
    expect(buildCopyText(r.controls[0]!, LABELS)).toContain(
      "ZT Guidance: Use MFA.",
    );
  });

  it("adds an Assessment sheet only when the record carries that dataset", () => {
    const r = record();
    r.datasets = ["assessment"];
    r.fields = [];
    r.controls[0]!.assessment = {
      objectives: [{ identifier: "AC-02a.[01]", text: "types are defined" }],
      methods: [{ method: "EXAMINE", text: "policy" }],
    };
    const [, assessment] = exportSheets(r);
    expect(assessment!.name).toBe("Assessment");
    expect(assessment!.rows).toEqual([
      ["AC-02", "Objective", "AC-02a.[01]", "types are defined"],
      ["AC-02", "EXAMINE", null, "policy"],
    ]);
  });
});

describe("the XLSX layout", () => {
  it("cuts a value past Excel's cell limit and says so in the cell", () => {
    expect(fitCell("short")).toBe("short");
    expect(fitCell("x".repeat(EXCEL_CELL_LIMIT))).toHaveLength(
      EXCEL_CELL_LIMIT,
    );
    const cut = fitCell("x".repeat(40_000))!;
    expect(cut).toHaveLength(EXCEL_CELL_LIMIT);
    expect(cut).toMatch(
      /Cut at Excel's 32,767-character cell limit from 40,000/,
    );
    // The leading "x" puts the cut inside a surrogate pair, which is dropped whole.
    const emoji = fitCell("x" + "😀".repeat(20_000))!;
    expect(emoji).toHaveLength(EXCEL_CELL_LIMIT - 1);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("applies the cut to every sheet's cells", () => {
    const r = record();
    const long = "y".repeat(40_000);
    const c = r.controls[0]!;
    c.name = long;
    c.statement!.discussion = long;
    c.statement!.parameters[0]!.values[0]!.value = long;
    c.zeroTrust![0]!.guidance = long;
    c.references![0]!.label = long;
    const sheets = exportSheets(r);
    for (const name of [
      "Controls",
      "Statement",
      "Parameters",
      "Zero Trust",
      "References",
    ]) {
      const cells = sheets.find((s) => s.name === name)!.rows.flat();
      expect(cells.some((v) => v?.length === EXCEL_CELL_LIMIT)).toBe(true);
      expect(cells.every((v) => (v?.length ?? 0) <= EXCEL_CELL_LIMIT)).toBe(
        true,
      );
    }
  });

  it("fits each column to its longest line and wraps the ones too wide for it", () => {
    const layout = columnLayout({
      name: "T",
      header: ["Control", "Name", "Statement"],
      rows: [
        ["AC-02", "Account Management", "a".repeat(200)],
        ["AC-02(01)", null, "one\ntwo"],
      ],
    });
    expect(layout).toEqual([
      { width: 11, wrap: false },
      { width: 20, wrap: false },
      { width: 60, wrap: true },
    ]);
    // A short line-broken value wraps at its breaks without widening the column, and a
    // Windows line break counts as one.
    expect(
      columnLayout({ name: "T", header: ["Lineage"], rows: [["a\nb"]] }),
    ).toEqual([{ width: 11, wrap: true }]);
    expect(
      columnLayout({ name: "T", header: ["L"], rows: [["abcdefgh\r\nb"]] }),
    ).toEqual([{ width: 10, wrap: true }]);
    // A header longer than its values keeps room for the filter button.
    expect(
      columnLayout({
        name: "T",
        header: ["Inherited from"],
        rows: [["AC-02"]],
      }),
    ).toEqual([{ width: 18, wrap: false }]);
  });
});

describe("the XLSX row heights", () => {
  const layout = [
    { width: 11, wrap: false },
    { width: 20, wrap: true },
  ];

  it("leaves a one-line row at Excel's default", () => {
    expect(rowHeight(["AC-02", "short"], layout)).toBeUndefined();
    // A long value in a column that does not wrap stays on one line.
    expect(rowHeight(["x".repeat(50), null], layout)).toBeUndefined();
  });

  it("counts wrapped and broken lines in the tallest cell", () => {
    // 45 characters at 20 a line is 3 lines; a line break adds one more.
    expect(rowHeight(["AC-02", "y".repeat(45)], layout)).toBe(45);
    expect(rowHeight(["AC-02", `${"y".repeat(45)}\nz`], layout)).toBe(60);
  });

  it("caps a row at Excel's 409 points", () => {
    expect(rowHeight(["AC-02", "y".repeat(10_000)], layout)).toBe(409);
  });
});

describe("the writers", () => {
  const isZip = (b: Buffer) => b.subarray(0, 2).toString() === "PK";

  it("writes an XLSX package with column widths and wrapped text", async () => {
    const parts = unzipSync(new Uint8Array(await writeXlsx(record())));
    const text = (path: string) => strFromU8(parts[path]!);
    const rId = /<sheet [^>]*r:id="([^"]+)"[^>]*name="Statement"/.exec(
      text("xl/workbook.xml"),
    )![1]!;
    const target = new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`).exec(
      text("xl/_rels/workbook.xml.rels"),
    )![1]!;
    const statement = text(`xl/${target.replace(/^\/?xl\//, "")}`);
    expect(statement).toMatch(/<col [^>]*width="/);
    expect(statement).toMatch(/<row [^>]*ht="\d+"[^>]*customHeight="1"/);
    expect(strFromU8(parts["xl/styles.xml"]!)).toMatch(
      /<alignment [^>]*vertical="top"[^>]*wrapText="1"|<alignment [^>]*wrapText="1"[^>]*vertical="top"/,
    );
  });

  it("adds header filters, repeated print titles and a document title to the XLSX", async () => {
    const r = record();
    r.catalog = "Catalog & <Co>";
    const parts = unzipSync(new Uint8Array(await writeXlsx(r)));
    const text = (path: string) => strFromU8(parts[path]!);
    const sheets = exportSheets(r);
    const workbook = text("xl/workbook.xml");
    sheets.forEach((s, i) => {
      const last = String.fromCharCode(64 + s.header.length);
      const rows = s.rows.length + 1;
      expect(text(`xl/worksheets/sheet${i + 1}.xml`)).toContain(
        `</sheetData><autoFilter ref="A1:${last}${rows}"/>`,
      );
      expect(workbook).toContain(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${s.name}'!$A$1:$${last}$${rows}</definedName>`,
      );
      expect(workbook).toContain(
        `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${s.name}'!$1:$1</definedName>`,
      );
    });
    expect(workbook).not.toContain("<definedNames/>");
    expect(text("docProps/core.xml")).toContain(
      "<dc:title>Catalog &amp; &lt;Co&gt;</dc:title>",
    );
    expect(text("[Content_Types].xml")).toContain(
      'PartName="/docProps/core.xml"',
    );
    expect(text("_rels/.rels")).toContain('Target="docProps/core.xml"');
  });

  it("writes a DOCX package, assessment procedures included", async () => {
    const r = record();
    r.datasets = [...EXPORT_DATASETS];
    r.controls[0]!.assessment = {
      objectives: [{ identifier: "AC-02a.[01]", text: "types are defined" }],
      methods: [
        { method: "EXAMINE", text: "policy" },
        { method: "TEST", text: null },
      ],
    };
    r.controls[0]!.references![0]!.citation = "SP 800-207, §3";
    const docx = await writeDocx(r);
    expect(isZip(docx)).toBe(true);
    const doc = strFromU8(
      unzipSync(new Uint8Array(docx))["word/document.xml"]!,
    );
    expect(doc).toContain("IDENTITY / Authentication / ADVANCED: ");
    expect(doc).toContain(">Key<");
  });

  it("writes a package whose links all resolve, escaping what XML cannot hold", async () => {
    const r = record();
    r.controls[0]!.name = 'Tags <b> & "quotes"\u0001';
    const parts = unzipSync(new Uint8Array(await writeDocx(r)));
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/numbering.xml",
      "word/settings.xml",
      "word/styles.xml",
    ]);
    const doc = strFromU8(parts["word/document.xml"]!);
    const rels = strFromU8(parts["word/_rels/document.xml.rels"]!);
    const all = (re: RegExp, text: string) =>
      [...text.matchAll(re)].map((m) => m[1]).sort();
    expect(all(/w:anchor="([^"]+)"/g, doc)).toEqual(
      all(/w:bookmarkStart [^>]*w:name="([^"]+)"/g, doc),
    );
    expect([...new Set(all(/r:id="([^"]+)"/g, doc))]).toEqual(
      all(/Id="(rIdL\d+)"/g, rels),
    );
    expect(doc).toContain(
      "AC-02 Tags &lt;b&gt; &amp; &quot;quotes&quot;</w:t>",
    );
    expect(doc).not.toContain("\u0001");
  });

  it("drops what XML cannot hold, links only web addresses, and bullets references", async () => {
    const r = record();
    r.controls[0]!.name = "bad \uFFFE\uFFFF \uD800 end";
    r.controls[0]!.references = [
      {
        pane: "catalog",
        label: "Share",
        url: "file://server/share",
        citation: null,
      },
      {
        pane: "catalog",
        label: "Web",
        url: "https://example.gov/a",
        citation: null,
      },
    ];
    r.controls[0]!.assessment = {
      objectives: [],
      methods: [{ method: "Test", text: null }],
    };
    const parts = unzipSync(new Uint8Array(await writeDocx(r)));
    const doc = strFromU8(parts["word/document.xml"]!);
    const rels = strFromU8(parts["word/_rels/document.xml.rels"]!);
    expect(doc).toContain("AC-02 bad   end</w:t>");
    expect(doc).toContain("Share (file://server/share)");
    expect(rels).not.toContain("file:");
    expect(rels).toContain('Target="https://example.gov/a"');
    expect(doc).toContain('<w:numId w:val="1"/>');
    expect(doc).toContain("none published for this control");
  });

  it("writes each chosen field under the control's heading", async () => {
    const r = record();
    r.controls[0]!.lineage = ["Status: Withdrawn"];
    const parts = unzipSync(new Uint8Array(await writeDocx(r)));
    const doc = strFromU8(parts["word/document.xml"]!);
    for (const text of [
      "Status: Withdrawn",
      "Baselines: ",
      "Catalog statement frequency: ",
      "Catalog item (c) frequency: ",
    ])
      expect(doc).toContain(text);
  });

  it("wires settings.xml in, in Word 2013's compatibility mode", async () => {
    const parts = unzipSync(new Uint8Array(await writeDocx(record())));
    const text = (path: string) => strFromU8(parts[path]!);
    expect(text("[Content_Types].xml")).toContain(
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    );
    expect(text("word/_rels/document.xml.rels")).toMatch(
      /Type="[^"]*\/relationships\/settings" Target="settings.xml"/,
    );
    expect(text("word/settings.xml")).toContain(
      'w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"',
    );
  });

  it("names an untitled link by its address", async () => {
    const r = record();
    r.controls[0]!.references![0]!.label = " ";
    const doc = strFromU8(
      unzipSync(new Uint8Array(await writeDocx(r)))["word/document.xml"]!,
    );
    expect(doc).toMatch(
      /<w:hyperlink r:id="[^"]+"[^>]*>(?:(?!<\/w:hyperlink>).)*https:\/\/example\.gov\/zt<\/w:t>/,
    );
  });

  it("starts an enhancement whose base is not in the document at level 2", async () => {
    const r = record();
    r.controls = r.controls.slice(1);
    const doc = strFromU8(
      unzipSync(new Uint8Array(await writeDocx(r)))["word/document.xml"]!,
    );
    const levels = [...doc.matchAll(/w:pStyle w:val="Heading(\d)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(levels.slice(0, 4)).toEqual([1, 1, 2, 3]);
    expect(levels).not.toContain(4);
    // Its contents line is not indented under a base that is not there.
    expect(doc).not.toContain(
      '<w:ind w:left="360"/></w:pPr><w:hyperlink w:anchor',
    );
  });

  it("never skips a heading level", async () => {
    const r = record();
    r.datasets = [...EXPORT_DATASETS];
    const parts = unzipSync(new Uint8Array(await writeDocx(r)));
    const doc = strFromU8(parts["word/document.xml"]!);
    const levels = [...doc.matchAll(/w:pStyle w:val="Heading(\d)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(levels).toContain(4);
    levels.reduce((prev, level) => {
      expect(level).toBeLessThanOrEqual(prev + 1);
      return level;
    });
  });

  it("writes the same bytes for the same record", async () => {
    expect((await writeDocx(record())).equals(await writeDocx(record()))).toBe(
      true,
    );
  });

  it("names bookmarks Word accepts", () => {
    expect(bookmarkFor("AC-02(01)")).toBe("c_AC_02_01_");
    expect(bookmarkFor("x".repeat(60))).toHaveLength(40);
  });
});
