/**
 * Tests for control lineage: where withdrawn controls went, the release delta, and the two
 * files that carry them (15 and 16).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The writer imports from "node:fs"; mock that module, not "fs", or the writes reach disk.
const { mockedWriteFileSync } = vi.hoisted(() => ({
  mockedWriteFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal requires import() type syntax
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, writeFileSync: mockedWriteFileSync },
    writeFileSync: mockedWriteFileSync,
  };
});

import {
  catalogEntries,
  releaseDelta,
  withdrawalLineage,
  withdrawnWithoutParent,
  type CatalogEntry,
} from "../lineage.js";
import {
  lineageId,
  nistIdScheme,
  writeCleanupSql,
  writeLineageSql,
  writeWithdrawnControlsSql,
} from "../sql-writer.js";
import type {
  LineageRow,
  OscalCatalog,
  ParsedControl,
  ParsedFamily,
} from "../types.js";

const OUT = "/tmp/nist-seed-test";
const NOTE = "Source: test";
const scheme = nistIdScheme("5.2.0");
const families: ParsedFamily[] = [
  { id: "AC", name: "Access Control" },
  { id: "SR", name: "Supply Chain Risk Management" },
];

function control(overrides: Partial<ParsedControl> = {}): ParsedControl {
  return {
    controlNumber: "AC-02",
    controlName: "Account Management",
    oscalId: "ac-2",
    sortId: "ac-02",
    guidance: null,
    parentOscalId: null,
    familyId: "AC",
    baselineLabels: [],
    relatedControls: [],
    statementParts: [],
    ...overrides,
  };
}

function withdrawn(
  number: string,
  oscalId: string,
  relation: "incorporated-into" | "moved-to" | null,
  targets: string[],
  overrides: Partial<ParsedControl> = {},
): ParsedControl {
  return control({
    controlNumber: number,
    controlName: "Withdrawn",
    oscalId,
    sortId: oscalId,
    withdrawal: { relation, targets },
    ...overrides,
  });
}

const live = control({
  statementParts: [
    {
      oscalPartId: "ac-2_smt",
      name: "statement",
      label: null,
      prose: null,
      sortOrder: 0,
      children: [
        {
          oscalPartId: "ac-2_smt.k",
          name: "item",
          label: "k.",
          prose: "text",
          sortOrder: 0,
          children: [],
        },
      ],
    },
  ],
});
const au6 = control({
  controlNumber: "AU-06",
  oscalId: "au-6",
  sortId: "au-06",
  familyId: "AU",
});

describe("withdrawalLineage", () => {
  it("records each successor by control number, with the relation's kind", () => {
    const out = withdrawalLineage(
      [
        live,
        au6,
        withdrawn("AC-13", "ac-13", "incorporated-into", ["ac-2", "au-6"]),
        withdrawn("AC-02(02)", "ac-2.2", "moved-to", ["au-6"]),
      ],
      families,
      "5.2.0",
    );
    expect(out.rows).toEqual([
      {
        controlNumber: "AC-13",
        kind: "INCORPORATED_INTO",
        relatedControlNumber: "AC-02",
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: null,
      },
      {
        controlNumber: "AC-13",
        kind: "INCORPORATED_INTO",
        relatedControlNumber: "AU-06",
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: null,
      },
      {
        controlNumber: "AC-02(02)",
        kind: "MOVED_TO",
        relatedControlNumber: "AU-06",
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: null,
      },
    ]);
    expect(out.multiSuccessor).toEqual(["AC-13"]);
    expect(out.unresolved).toEqual([]);
  });

  it("resolves a statement part to its control and a family to its code", () => {
    const out = withdrawalLineage(
      [
        live,
        withdrawn("AC-02(10)", "ac-2.10", "incorporated-into", ["ac-2_smt.k"]),
        withdrawn("SA-12", "sa-12", "incorporated-into", ["sr"]),
      ],
      families,
      "5.2.0",
    );
    expect(out.rows.map((r) => r.relatedControlNumber)).toEqual([
      "AC-02",
      "SR",
    ]);
    expect(out.rows.map((r) => r.relatedPartOscalId)).toEqual([
      "ac-2_smt.k",
      null,
    ]);
    expect(out.viaPart).toEqual(["AC-02(10) -> ac-2_smt.k"]);
    expect(out.viaFamily).toEqual(["SA-12 -> sr"]);
  });

  it("reports a target naming nothing, and writes no row for it", () => {
    const out = withdrawalLineage(
      [live, withdrawn("AC-14", "ac-14", "incorporated-into", ["zz-99"])],
      families,
      "5.2.0",
    );
    expect(out.rows).toEqual([]);
    expect(out.unresolved).toEqual(["AC-14 -> zz-99"]);
  });

  it("reports a successor that is itself withdrawn, so no chain runs past one step", () => {
    const out = withdrawalLineage(
      [
        live,
        withdrawn("AC-13", "ac-13", "incorporated-into", ["ac-2"]),
        withdrawn("AC-14", "ac-14", "moved-to", ["ac-13"]),
      ],
      families,
      "5.2.0",
    );
    expect(out.toWithdrawn).toEqual(["AC-14 -> AC-13"]);
    // The row is still written: the gate, not the resolver, decides what a run may seed.
    expect(out.rows.map((r) => r.controlNumber)).toEqual(["AC-13", "AC-14"]);
  });

  it("counts a withdrawn control with no successor, and skips live controls", () => {
    const out = withdrawalLineage(
      [live, withdrawn("SC-19", "sc-19", null, [])],
      families,
      "5.2.0",
    );
    expect(out.rows).toEqual([]);
    expect(out.withoutSuccessor).toEqual(["SC-19"]);
  });
});

describe("withdrawnWithoutParent", () => {
  it("names a withdrawn enhancement whose parent the catalog lacks, before anything is written", () => {
    const orphan = withdrawn("ZZ-01(01)", "zz-1.1", null, [], {
      parentOscalId: "zz-1",
    });
    const kept = withdrawn("AC-02(10)", "ac-2.10", null, [], {
      parentOscalId: "ac-2",
    });
    expect(
      withdrawnWithoutParent([orphan, kept], [live, orphan, kept]),
    ).toEqual(["ZZ-01(01) -> zz-1"]);
  });
});

describe("releaseDelta", () => {
  const entry = (
    oscalId: string,
    controlNumber: string,
    isWithdrawn = false,
  ): CatalogEntry => ({ oscalId, controlNumber, withdrawn: isWithdrawn });

  it("finds controls added and dropped by identifier, and newly withdrawn ones", () => {
    const delta = releaseDelta(
      [entry("ac-1", "AC-01"), entry("ac-2", "AC-02"), entry("zz-1", "ZZ-01")],
      [
        entry("ac-1", "AC-01"),
        entry("ac-2", "AC-02", true),
        entry("sa-24", "SA-24"),
        entry("sa-25", "SA-25", true),
      ],
      "5.1.1+u4",
      "5.2.0",
    );
    expect(delta.added).toEqual(["SA-24"]);
    expect(delta.dropped).toEqual(["ZZ-01"]);
    expect(delta.newlyWithdrawn).toEqual(["AC-02"]);
    expect(delta.rows).toEqual([
      {
        controlNumber: "SA-24",
        kind: "ADDED",
        relatedControlNumber: null,
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: "5.1.1+u4",
      },
      {
        controlNumber: "ZZ-01",
        kind: "DROPPED",
        relatedControlNumber: null,
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: "5.1.1+u4",
      },
    ]);
  });

  it("reads a catalog's controls, enhancements and status by label", () => {
    const catalog = {
      catalog: {
        groups: [
          {
            id: "ac",
            title: "Access Control",
            controls: [
              {
                id: "ac-2",
                title: "Account Management",
                props: [
                  { name: "label", class: "zero-padded", value: "AC-02" },
                ],
                controls: [
                  {
                    id: "ac-2.10",
                    title: "Withdrawn",
                    props: [
                      {
                        name: "label",
                        class: "zero-padded",
                        value: "AC-02(10)",
                      },
                      { name: "status", value: "withdrawn" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    } as unknown as OscalCatalog;
    expect(catalogEntries(catalog)).toEqual([
      { oscalId: "ac-2", controlNumber: "AC-02", withdrawn: false },
      { oscalId: "ac-2.10", controlNumber: "AC-02(10)", withdrawn: true },
    ]);
  });
});

describe("the lineage files", () => {
  beforeEach(() => mockedWriteFileSync.mockReset());

  const sql = (): string => mockedWriteFileSync.mock.calls[0]![1] as string;

  it("cleanup truncates the lineage before the controls it names", () => {
    writeCleanupSql(OUT, NOTE);
    const body = sql();
    expect(body.indexOf('"ControlLineage"')).toBeGreaterThan(-1);
    expect(body.indexOf('"ControlLineage"')).toBeLessThan(
      body.indexOf('"NistControl"'),
    );
  });

  it("writes withdrawn controls with their status and parent references", () => {
    writeWithdrawnControlsSql(
      OUT,
      [
        withdrawn("AC-02(10)", "ac-2.10", "incorporated-into", ["ac-2"], {
          parentOscalId: "ac-2",
        }),
      ],
      [
        live,
        withdrawn("AC-02(10)", "ac-2.10", "incorporated-into", ["ac-2"], {
          parentOscalId: "ac-2",
        }),
      ],
      scheme,
      NOTE,
    );
    expect(mockedWriteFileSync.mock.calls[0]![0]).toBe(
      `${OUT}/15-withdrawn-controls.sql`,
    );
    expect(sql()).toContain("'WITHDRAWN'");
    expect(sql()).toContain("1 withdrawn controls, 1 of them enhancements");
    expect(sql()).toContain(
      `UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-02_r520' WHERE "id" = 'ctrl_ac-02_10__r520';`,
    );
  });

  it("refuses a withdrawn enhancement whose parent is not written", () => {
    const orphan = withdrawn("AC-02(10)", "ac-2.10", "incorporated-into", [], {
      parentOscalId: "ac-2",
    });
    expect(() =>
      writeWithdrawnControlsSql(OUT, [orphan], [orphan], scheme, NOTE),
    ).toThrow(/not being written/);
  });

  it("sets each foreign key only when that control is seeded", () => {
    const rows: LineageRow[] = [
      {
        controlNumber: "AC-13",
        kind: "INCORPORATED_INTO",
        relatedControlNumber: "AC-02",
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: null,
      },
      {
        controlNumber: "SA-12",
        kind: "INCORPORATED_INTO",
        relatedControlNumber: "SR",
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: null,
      },
      {
        controlNumber: "AC-02(10)",
        kind: "INCORPORATED_INTO",
        relatedControlNumber: "AC-02",
        relatedPartOscalId: "ac-2_smt.k",
        release: "5.2.0",
        sinceRelease: null,
      },
      {
        controlNumber: "ZZ-01",
        kind: "DROPPED",
        relatedControlNumber: null,
        relatedPartOscalId: null,
        release: "5.2.0",
        sinceRelease: "5.1.1+u4",
      },
    ];
    writeLineageSql(
      OUT,
      rows,
      new Set(["AC-13", "AC-02", "SA-12"]),
      scheme,
      NOTE,
    );
    const body = sql();
    expect(body).toContain(
      "('lin_ac_13_incorporated_into_ac_02_r520', 'nist_r520', 'AC-13', 'INCORPORATED_INTO', 'AC-02', NULL, '5.2.0', NULL, 'ctrl_ac-13_r520', 'ctrl_ac-02_r520', NULL, NOW())",
    );
    expect(body).toContain(
      "'SA-12', 'INCORPORATED_INTO', 'SR', NULL, '5.2.0', NULL, 'ctrl_sa-12_r520', NULL, NULL, NOW()",
    );
    // The successor's item keys its part row, which is seeded with its control; the
    // withdrawn control itself is not in the seeded set here, so its own key stays NULL.
    expect(body).toContain(
      "'AC-02(10)', 'INCORPORATED_INTO', 'AC-02', 'ac-2_smt.k', '5.2.0', NULL, NULL, 'ctrl_ac-02_r520', 'part_ac-2_smt.k_r520', NOW()",
    );
    expect(body).toContain(
      "'ZZ-01', 'DROPPED', NULL, NULL, '5.2.0', '5.1.1+u4', NULL, NULL, NULL, NOW()",
    );
    expect(body).toContain(
      "4 rows: 3 incorporated into, 0 moved to, 0 added, 1 dropped",
    );
  });

  it("gives an added row an id from the release it was compared against", () => {
    expect(
      lineageId(
        {
          controlNumber: "SI-02(07)",
          kind: "ADDED",
          relatedControlNumber: null,
          relatedPartOscalId: null,
          release: "5.2.0",
          sinceRelease: "5.1.1+u4",
        },
        "r520",
      ),
    ).toBe("lin_si_02_07_added_5_1_1_u4_r520");
  });

  it("writes a comment when there is no lineage", () => {
    writeLineageSql(OUT, [], new Set(), scheme, NOTE);
    expect(sql()).toContain("-- No lineage in this catalog.");
  });
});
