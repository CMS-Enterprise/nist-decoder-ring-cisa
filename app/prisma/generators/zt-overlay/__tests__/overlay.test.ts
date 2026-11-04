import { describe, expect, it } from "vitest";

import type { CisaRow } from "../lib/cisa";
import {
  affinityId,
  affinitySql,
  buildOverlay,
  coverageSql,
  designationRank,
  type Drop,
  mappingsSql,
  oscalBase,
  reconcile,
  selectRepresentative,
  tupleDesignation,
  tupleIfApplicable,
  type OverlayTuple,
} from "../lib/overlay";
import { summary, tupleRows } from "../lib/report";
import type { SeedContext } from "../lib/seed";

const seed: SeedContext = {
  controlIds: new Set([
    "ctrl_ac-02_r520",
    "ctrl_ac-02_01__r520",
    "ctrl_sc-07_r520",
    "ctrl_pm-01_r520",
  ]),
  guidanceGroups: new Set([
    "IDENTITY|Access Management",
    "NETWORKS|Traffic Segmentation",
  ]),
};

function cisaRow(
  sourceRow: number,
  controlId: string,
  pillar: string,
  fn: string,
  maturity: string,
  designation = "Key",
): CisaRow {
  return {
    sourceRow,
    controlId,
    pillar: pillar as CisaRow["pillar"],
    function: fn,
    maturity: maturity as CisaRow["maturity"],
    designation,
    ifApplicable: false,
    functionTransform: "as published",
    cisa: {
      controlId,
      pillar,
      function: fn,
      maturity,
      functionCode: "",
      multiplePillars: "-",
      pillarDuplicateId: "-",
      multipleFunctions: "-",
      functionDuplicateId: "-",
      controlName: "",
      controlText: "",
      extra: {},
    },
  };
}

const cisa = [
  cisaRow(2, "AC-02", "IDENTITY", "Access Management", "TRADITIONAL"),
  cisaRow(
    3,
    "AC-02",
    "IDENTITY",
    "Access Management",
    "TRADITIONAL",
    "Supporting",
  ),
  cisaRow(4, "AC-02", "NETWORKS", "Traffic Segmentation", "ADVANCED"),
  cisaRow(5, "SC-07", "NETWORKS", "Traffic Segmentation", "INITIAL"),
];

describe("buildOverlay", () => {
  const overlay = buildOverlay({ cisa, drops: [], seed });

  it("folds CISA's rows into tuples, keeping every row's designation", () => {
    expect(overlay.mappings.map((m) => m.controlId)).toEqual([
      "AC-02",
      "SC-07",
    ]);
    const ac2 = overlay.mappings[0]!.tuples.map((t) => [
      t.pillar,
      t.cisaRows,
      t.designations,
    ]);
    expect(ac2).toEqual([
      ["IDENTITY", [2, 3], ["Key", "Supporting"]],
      ["NETWORKS", [4], ["Key"]],
    ]);
  });

  it("puts the representative's pillar first", () => {
    expect(overlay.mappings[0]).toMatchObject({
      pillars: ["IDENTITY", "NETWORKS"],
      function: "Access Management",
      maturity: "TRADITIONAL",
    });
  });

  it("removes a tuple only through a declared drop, and reports it", () => {
    const drop: Drop = {
      controlId: "SC-07",
      pillar: "NETWORKS",
      function: "Traffic Segmentation",
      maturity: "INITIAL",
      reason: "decided out of scope",
      decidedBy: "owner",
      decidedOn: "2026-10-21",
    };
    const dropped = buildOverlay({ cisa, drops: [drop], seed });
    expect(dropped.mappings.map((m) => m.controlId)).toEqual(["AC-02"]);
    const row = tupleRows(dropped, seed.guidanceGroups).find(
      (r) => r[0] === "SC-07",
    )!;
    expect(row[4]).toBe("dropped");
    expect(row[10]).toBe("decided out of scope");
  });

  it("stops on a drop with no reason or naming a tuple CISA does not map", () => {
    const base = {
      controlId: "SC-07",
      pillar: "NETWORKS",
      function: "Traffic Segmentation",
      decidedBy: "",
      decidedOn: "",
    };
    const noReason: Drop = { ...base, maturity: "INITIAL", reason: " " };
    const nothing: Drop = { ...base, maturity: "OPTIMAL", reason: "x" };
    expect(() =>
      buildOverlay({ cisa, drops: [noReason, nothing], seed }),
    ).toThrow(
      /drop without a reason[\s\S]*drop names a tuple CISA does not map/,
    );
  });

  it("stops on a control the catalog seed does not have", () => {
    expect(() =>
      buildOverlay({
        cisa: [cisaRow(9, "ZZ-01", "IDENTITY", "Access Management", "OPTIMAL")],
        drops: [],
        seed,
      }),
    ).toThrow(/ZZ-01 is not in the catalog seed/);
  });
});

describe("reconcile", () => {
  it("names every CISA row the output does not account for", () => {
    const missing = reconcile({ cisa, drops: [], mappings: [] });
    expect(missing).toHaveLength(cisa.length);
    expect(missing).toContain(
      'CISA row 5 lost: ["SC-07","NETWORKS","Traffic Segmentation","INITIAL"]',
    );
  });
});

describe("selectRepresentative", () => {
  const t = (
    pillar: string,
    fn: string,
    maturity: string,
    designations: string[] = [],
  ): OverlayTuple => ({
    controlId: "AC-02",
    pillar,
    function: fn,
    maturity,
    cisaRows: [],
    designations,
    ifApplicable: [],
  });
  it("prefers a resolving tuple, then the lowest maturity", () => {
    expect(
      selectRepresentative(
        [
          t("DATA", "No Such Group", "TRADITIONAL"),
          t("IDENTITY", "Access Management", "INITIAL"),
          t("NETWORKS", "Traffic Segmentation", "ADVANCED"),
        ],
        seed.guidanceGroups,
      ),
    ).toEqual({
      pillars: ["IDENTITY", "NETWORKS", "DATA"],
      function: "Access Management",
      maturity: "INITIAL",
    });
  });
  it("prefers Key, then Supporting, then Informative, before maturity", () => {
    expect(
      selectRepresentative(
        [
          t("IDENTITY", "Access Management", "TRADITIONAL", ["Informative"]),
          t("NETWORKS", "Traffic Segmentation", "OPTIMAL", [
            "Supporting",
            "Key",
          ]),
        ],
        seed.guidanceGroups,
      ),
    ).toMatchObject({ function: "Traffic Segmentation", maturity: "OPTIMAL" });
    expect(
      designationRank(t("DATA", "x", "INITIAL", ["Informative", "Supporting"])),
    ).toBe(1);
    expect(designationRank(t("DATA", "x", "INITIAL"))).toBe(3);
  });
  it("falls back to every tuple when none resolves", () => {
    expect(
      selectRepresentative(
        [t("DATA", "B", "OPTIMAL"), t("DATA", "A", "OPTIMAL")],
        new Set(),
      ).function,
    ).toBe("A");
  });
});

describe("ids and SQL", () => {
  it("builds the OSCAL base and content-addressed affinity ids", () => {
    expect(oscalBase("AC-02(01)")).toBe("ac-2.1");
    expect(oscalBase("SC-07")).toBe("sc-7");
    expect(() => oscalBase("AC-2")).not.toThrow();
    expect(() => oscalBase("nope")).toThrow(/Not a canonical control number/);
    expect(
      affinityId({
        controlId: "AC-02(01)",
        pillar: "DATA",
        function: "Data Visibility & Analytics",
        maturity: "INITIAL",
      }),
    ).toBe("ztaff_ac-2.1_data_data-visibility-analytics_initial_r520");
  });

  it("writes loadable SQL, escaping quotes, and a valid 11 that covers nothing", () => {
    const overlay = buildOverlay({
      cisa: [
        cisaRow(2, "AC-02", "IDENTITY", "Access Management", "TRADITIONAL"),
      ],
      drops: [],
      seed,
    });
    overlay.mappings[0]!.function = "O'Brien";
    expect(mappingsSql(overlay.mappings, ["Source: test"])).toContain(
      "'O''Brien'",
    );
    expect(affinitySql(overlay.mappings, [])).toContain(
      'ON CONFLICT ("ztMappingId", "pillar", "function", "maturity") DO NOTHING;',
    );
    const empty = coverageSql();
    expect(empty).not.toContain("INSERT");
    expect(empty).toContain("-- No covered items.");
  });
  it("records CISA's designation and If Applicable flag on each tuple", () => {
    // AC-02's first tuple folds a Key row and a Supporting row: it is Key.
    const overlay = buildOverlay({ cisa, drops: [], seed });
    const sql = affinitySql(overlay.mappings, []);
    expect(sql).toContain('"designation", "ifApplicable")');
    expect(sql).toMatch(
      /'Access Management',\n {4}'TRADITIONAL'::"ZTMaturityLevel",\n {4}'KEY'::"ZTDesignation",\n {4}false\n/,
    );
    const folded = overlay.mappings[0]!.tuples[0]!;
    expect(folded.designations).toEqual(["Key", "Supporting"]);
    expect(tupleDesignation(folded)).toBe("KEY");
  });

  it("marks a tuple If Applicable only when every row it folds is", () => {
    const tuple = (flags: boolean[], designations: string[] = []) => ({
      controlId: "AC-02",
      pillar: "IDENTITY",
      function: "Access Management",
      maturity: "TRADITIONAL",
      cisaRows: flags.map((_, i) => i + 2),
      designations,
      ifApplicable: flags,
    });
    expect(tupleIfApplicable(tuple([true, true]))).toBe(true);
    expect(tupleIfApplicable(tuple([true, false]))).toBe(false);
    expect(tupleIfApplicable(tuple([]))).toBe(false);
    expect(tupleDesignation(tuple([false]))).toBeNull();
    expect(tupleDesignation(tuple([false], ["Informative"]))).toBe(
      "INFORMATIVE",
    );
  });
});

describe("summary", () => {
  it("counts the overlay and the repeats folded into it", () => {
    const overlay = buildOverlay({ cisa, drops: [], seed });
    const lines = summary(overlay, seed.guidanceGroups, {
      cisaRows: cisa.length,
      findings: 0,
    }).join("\n");
    expect(lines).toContain("controls: 2");
    expect(lines).toContain("tuples kept: 3; dropped by decision: 0");
    expect(lines).toContain("CISA rows folded into a tuple they repeat: 1");
    expect(lines).toContain("tuples with no guidance group: 0");
  });
});
