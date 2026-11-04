/**
 * Tests for emitting 08-assessment-procedures.sql and for the ids it uses.
 *
 * Same discipline as sql-writer.test.ts: assert what the SQL says, not a golden
 * file, and mock node:fs so nothing reaches disk.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  methodId,
  nistIdScheme,
  objectiveId,
  writeAssessmentProceduresSql,
  writeCleanupSql,
  type MethodGaps,
} from "../sql-writer.js";
import type { ParsedMethod, ParsedObjective } from "../types.js";

const OUT = "/tmp/nist-seed-test";
const NOTE = "Source: test";
const scheme = nistIdScheme("5.2.0");

function objective(overrides: Partial<ParsedObjective> = {}): ParsedObjective {
  return {
    cprtIdentifier: "DS-AC-02a.[01]",
    controlNumber: "AC-02",
    oscalPartId: "ac-2_smt.a",
    text: "account types allowed for use within the system are defined;",
    sortOrder: 0,
    ...overrides,
  };
}

function method(overrides: Partial<ParsedMethod> = {}): ParsedMethod {
  return {
    cprtIdentifier: "E-AC-02",
    controlNumber: "AC-02",
    method: "EXAMINE",
    text: "[SELECT FROM: Access control policy; account records].",
    ...overrides,
  };
}

/** No gaps, which is the uninteresting case most of these tests want. */
function gaps(overrides: Partial<MethodGaps> = {}): MethodGaps {
  return {
    liveControls: 1,
    missing: { EXAMINE: [], INTERVIEW: [], TEST: [] },
    withoutAny: [],
    ...overrides,
  };
}

function writtenSql(): string {
  return mockedWriteFileSync.mock.calls[0]![1] as string;
}

beforeEach(() => {
  mockedWriteFileSync.mockClear();
});

describe("objectiveId", () => {
  it("derives a stable id from the publication's own identifier", () => {
    expect(objectiveId("DS-AC-02a.[01]", "r520")).toBe("obj_ac-02a.01_r520");
    expect(objectiveId("DS-AC-02b.", "r520")).toBe("obj_ac-02b_r520");
    expect(objectiveId("DS-AC-02(01)", "r520")).toBe("obj_ac-02_01__r520");
    expect(objectiveId("DS-AC-02(03)(a)", "r520")).toBe(
      "obj_ac-02_03__a__r520",
    );
    expect(objectiveId("DS-SA-05a.02[02]", "r520")).toBe(
      "obj_sa-05a.02.02_r520",
    );
  });

  it("keeps distinct identifiers distinct across the shapes the export uses", () => {
    const ids = [
      "DS-AC-02",
      "DS-AC-02[01]",
      "DS-AC-02a.",
      "DS-AC-02a.[01]",
      "DS-AC-02(01)",
      "DS-AC-02(01)[01]",
      "DS-AC-02(03)(a)",
      "DS-AC-02a.01(a)[01]",
    ].map((id) => objectiveId(id, "r520"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits only key-safe characters", () => {
    for (const id of [
      "DS-AC-02a.[01]",
      "DS-AC-02(03)(a)",
      "DS-SA-05a.02[02]",
    ]) {
      expect(objectiveId(id, "r520")).toMatch(/^obj_[a-z0-9_.-]+_r520$/);
    }
  });
});

describe("methodId", () => {
  it("keys on control and kind, since the model allows one of each per control", () => {
    expect(methodId("AC-02", "EXAMINE", "r520")).toBe(
      "method_ac-02_examine_r520",
    );
    expect(methodId("AC-02(01)", "TEST", "r520")).toBe(
      "method_ac-02_01__test_r520",
    );
  });
});

describe("writeCleanupSql", () => {
  it("truncates the assessment tables before the controls and parts they reference", () => {
    writeCleanupSql(OUT, NOTE);
    const sql = writtenSql();
    expect(sql.indexOf('"AssessmentObjective"')).toBeLessThan(
      sql.indexOf('"ControlPart"'),
    );
    expect(sql.indexOf('"AssessmentMethod"')).toBeLessThan(
      sql.indexOf('"NistControl"'),
    );
  });
});

describe("writeAssessmentProceduresSql", () => {
  it("writes 08-assessment-procedures.sql with the provenance note", () => {
    writeAssessmentProceduresSql(
      OUT,
      [objective()],
      [method()],
      gaps(),
      scheme,
      NOTE,
    );
    expect(mockedWriteFileSync).toHaveBeenCalledOnce();
    expect(mockedWriteFileSync.mock.calls[0]![0]).toContain(
      "08-assessment-procedures.sql",
    );
    expect(writtenSql()).toContain("-- Source: test");
    expect(writtenSql()).toContain(
      "-- 1 determination statements, 1 assessment method entries",
    );
  });

  it("points an objective at its control and at the part it assesses", () => {
    writeAssessmentProceduresSql(OUT, [objective()], [], gaps(), scheme, NOTE);
    expect(writtenSql()).toContain(
      `('obj_ac-02a.01_r520', 'DS-AC-02a.[01]', 'account types allowed for use within the system are defined;', 0, 'ctrl_ac-02_r520', 'part_ac-2_smt.a_r520')`,
    );
  });

  it("writes NULL, not a fabricated part, for a root-statement objective", () => {
    writeAssessmentProceduresSql(
      OUT,
      [
        objective({
          cprtIdentifier: "DS-AC-02(01)",
          controlNumber: "AC-02(01)",
          oscalPartId: null,
          text: "supported;",
        }),
      ],
      [],
      gaps(),
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain(
      `('obj_ac-02_01__r520', 'DS-AC-02(01)', 'supported;', 0, 'ctrl_ac-02_01__r520', NULL)`,
    );
  });

  it("casts the method kind to the enum and keeps the SELECT FROM text verbatim", () => {
    writeAssessmentProceduresSql(
      OUT,
      [],
      [method({ method: "TEST", cprtIdentifier: "T-AC-02" })],
      gaps(),
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain(
      `('method_ac-02_test_r520', 'T-AC-02', 'TEST'::"AssessmentMethodKind", '[SELECT FROM: Access control policy; account records].', 'ctrl_ac-02_r520')`,
    );
  });

  it("escapes quotes in determination text", () => {
    writeAssessmentProceduresSql(
      OUT,
      [objective({ text: "the system's owner is notified;" })],
      [],
      gaps(),
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain("'the system''s owner is notified;'");
  });

  it("emits both INSERTs with ON CONFLICT DO NOTHING, and a comment when a table has no rows", () => {
    writeAssessmentProceduresSql(OUT, [objective()], [], gaps(), scheme, NOTE);
    const sql = writtenSql();
    expect(sql).toContain('INSERT INTO "AssessmentObjective"');
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING;');
    expect(sql).toContain("-- No assessment method entries.");
    expect(sql).not.toContain('INSERT INTO "AssessmentMethod"');

    mockedWriteFileSync.mockClear();
    writeAssessmentProceduresSql(OUT, [], [], gaps(), scheme, NOTE);
    expect(writtenSql()).toContain("-- No determination statements.");
  });

  it("states the per-kind method coverage in the header, naming small gaps and counting the large one", () => {
    // A missing row cannot say whether the publication carries nothing or the ingest did, so the file says it: which kinds are short, and by how much.
    writeAssessmentProceduresSql(
      OUT,
      [objective()],
      [method()],
      gaps({
        liveControls: 1014,
        missing: {
          EXAMINE: ["PM-12"],
          INTERVIEW: ["CM-03(08)", "SA-10(04)"],
          TEST: Array.from({ length: 108 }, (_, i) => `XX-${i}`),
        },
      }),
      scheme,
      NOTE,
    );
    const sql = writtenSql();
    expect(sql).toContain(
      "absent in SP 800-53A itself rather than un-ingested",
    );
    expect(sql).toContain("--   examine: 1013 controls; 1 carry none (PM-12)");
    expect(sql).toContain(
      "--   interview: 1012 controls; 2 carry none (CM-03(08), SA-10(04))",
    );
    // The large gap is counted rather than listed; 108 identifiers in a header would bury the two that a reader can actually act on.
    expect(sql).toContain("--   test: 906 controls; 108 carry none");
    expect(sql).not.toContain("XX-1,");
    expect(sql).toContain("--   controls carrying no method of any kind: 0");
  });

  it("says a kind is universal when nothing is missing", () => {
    writeAssessmentProceduresSql(
      OUT,
      [],
      [method()],
      gaps({ liveControls: 1014 }),
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain("--   examine: all 1014 controls");
  });
});
