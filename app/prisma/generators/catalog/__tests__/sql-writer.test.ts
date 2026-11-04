/**
 * Tests for SQL emission.
 *
 * The generated files are a reviewable artifact, so these assert what the SQL
 * says rather than comparing against a golden file — a golden file would fail on
 * a whitespace change and tell you nothing about which invariant broke.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The writer imports from "node:fs", not "fs". Mocking "fs" would leave the real
// writeFileSync in place and these tests would write to disk while passing.
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
  controlId,
  nistIdScheme,
  partId,
  writeCatalogVersionSql,
  writeCleanupSql,
  writeControlFamiliesSql,
  writeControlPartsSql,
  writeControlParametersSql,
  writeControlsSql,
  writeParentRefsSql,
} from "../sql-writer.js";
import type { ParsedControl, ParsedPart } from "../types.js";

const OUT = "/tmp/nist-seed-test";
const NOTE = "Source: test";
const scheme = nistIdScheme("5.2.0");

function makeControl(overrides: Partial<ParsedControl> = {}): ParsedControl {
  return {
    controlNumber: "AC-01",
    controlName: "Policy and Procedures",
    oscalId: "ac-1",
    sortId: "ac-01",
    guidance: null,
    parentOscalId: null,
    familyId: "AC",
    baselineLabels: [],
    relatedControls: [],
    statementParts: [],
    ...overrides,
  };
}

function makePart(
  overrides: Partial<ParsedPart> & { oscalPartId: string },
): ParsedPart {
  return {
    name: "item",
    label: "a.",
    prose: "text",
    sortOrder: 0,
    children: [],
    ...overrides,
  };
}

/** The SQL body of the single write this test performed. */
function writtenSql(): string {
  return mockedWriteFileSync.mock.calls[0]![1] as string;
}
function writtenPath(): string {
  return mockedWriteFileSync.mock.calls[0]![0] as string;
}

beforeEach(() => {
  mockedWriteFileSync.mockClear();
});

// ---------------------------------------------------------------------------

describe("id scheme", () => {
  it("scopes every id to the catalog revision", () => {
    expect(nistIdScheme("5.2.0")).toEqual({
      versionRowId: "nist_r520",
      token: "r520",
    });
  });

  it("derives a control id from the number, not from its position", () => {
    // Content-addressed so a control keeps its id when its neighbours change.
    expect(controlId("AC-02(01)", "r520")).toBe("ctrl_ac-02_01__r520");
    expect(partId("ac-1_smt.a", "r520")).toBe("part_ac-1_smt.a_r520");
  });
});

describe("writeCleanupSql", () => {
  it("writes 00-cleanup.sql", () => {
    writeCleanupSql(OUT, NOTE);
    expect(mockedWriteFileSync).toHaveBeenCalledOnce();
    expect(writtenPath()).toContain("00-cleanup.sql");
  });

  it("truncates children before parents", () => {
    writeCleanupSql(OUT, NOTE);
    const sql = writtenSql();
    expect(sql.indexOf('"NistControl"')).toBeLessThan(
      sql.indexOf('"ControlFamily"'),
    );
    expect(sql.indexOf('"ControlPart"')).toBeLessThan(
      sql.indexOf('"NistControl"'),
    );
  });

  it("quiets the cascade notices so a real warning stands out", () => {
    writeCleanupSql(OUT, NOTE);
    expect(writtenSql()).toContain("SET client_min_messages = warning;");
  });
});

describe("writeCatalogVersionSql", () => {
  const row = {
    version: "800-53r5.2.0",
    catalogKey: "nist-800-53-r5",
    displayLabel: "NIST SP 800-53 Rev 5",
    upstreamRevision: "NIST SP 800-53 Rev 5.2.0",
    tailoringNote: null,
    releaseDate: "2025-08-26T14:33:16.000Z",
    description: "Test catalog",
  };

  it("writes a NULL tailoring note rather than an empty string", () => {
    // The null is the meaning: a stock catalog applies no tailoring, which is
    // different from applying one and failing to describe it.
    writeCatalogVersionSql(OUT, { ...row }, scheme, NOTE);
    expect(writtenSql()).toContain("  NULL,\n");
    expect(writtenSql()).not.toContain("''");
  });

  it("carries the catalog key and display label the API reads", () => {
    writeCatalogVersionSql(OUT, { ...row }, scheme, NOTE);
    const sql = writtenSql();
    expect(sql).toContain("'nist-800-53-r5'");
    expect(sql).toContain("'NIST SP 800-53 Rev 5'");
    expect(sql).toContain("'nist_r520'");
  });
});

describe("writeControlsSql", () => {
  it("writes an empty text array as '{}', which is not the same as ARRAY[]", () => {
    // ARRAY[]::text[] is a syntax error in Postgres, so the empty case cannot
    // go through the same path as a populated one.
    writeControlsSql(OUT, [makeControl()], scheme, NOTE);
    expect(writtenSql()).toContain("'{}'");
    expect(writtenSql()).not.toContain("ARRAY[]");
  });

  it("emits a populated array as a typed text[]", () => {
    writeControlsSql(
      OUT,
      [makeControl({ baselineLabels: ["Low", "Moderate"] })],
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain("ARRAY['Low','Moderate']::text[]");
  });

  it("escapes a quote by doubling it rather than dropping the row", () => {
    writeControlsSql(
      OUT,
      [makeControl({ controlName: "Don't Panic" })],
      scheme,
      NOTE,
    );
    expect(writtenSql()).toContain("'Don''t Panic'");
  });

  it("writes NULL for absent guidance, not an empty string", () => {
    writeControlsSql(OUT, [makeControl({ guidance: null })], scheme, NOTE);
    expect(writtenSql()).toMatch(/'Policy and Procedures', NULL,/);
  });

  it("leaves the columns the stock catalog does not state as NULL", () => {
    // reviewFrequency, assessmentFrequency, priority and referencePolicy are a
    // tailoring authority's to fill, and an invented value would be a claim.
    writeControlsSql(OUT, [makeControl()], scheme, NOTE);
    const sql = writtenSql();
    expect(sql).toContain("reviewFrequency");
    expect(sql).toContain("NULL, NULL,");
  });

  it("stamps the provenance line into the file", () => {
    writeControlsSql(OUT, [makeControl()], scheme, NOTE);
    expect(writtenSql()).toContain(NOTE);
  });
});

describe("writeParentRefsSql", () => {
  it("emits one UPDATE per enhancement, in a second pass", () => {
    // A self-referencing foreign key cannot be satisfied by ordering rows inside
    // one INSERT.
    const controls = [
      makeControl({ controlNumber: "AC-02", oscalId: "ac-2" }),
      makeControl({
        controlNumber: "AC-02(01)",
        oscalId: "ac-2.1",
        parentOscalId: "ac-2",
      }),
    ];
    writeParentRefsSql(OUT, controls, scheme, NOTE);
    const sql = writtenSql();
    expect(sql).toContain(
      `UPDATE "NistControl" SET "parentControlId" = 'ctrl_ac-02_r520' WHERE "id" = 'ctrl_ac-02_01__r520';`,
    );
    expect(sql.match(/UPDATE/g) ?? []).toHaveLength(1);
  });

  it("throws when an enhancement's parent is not being written", () => {
    // The integrity gate catches this before any write, so reaching here means
    // the gate was bypassed rather than that a row should be skipped.
    const orphan = [
      makeControl({
        controlNumber: "AC-02(01)",
        oscalId: "ac-2.1",
        parentOscalId: "ac-2",
      }),
    ];
    expect(() => writeParentRefsSql(OUT, orphan, scheme, NOTE)).toThrow(
      /not being written/,
    );
  });

  it("writes a valid comment-only file when there are no enhancements", () => {
    writeParentRefsSql(OUT, [makeControl()], scheme, NOTE);
    expect(writtenSql()).toContain("No enhancements");
    expect(writtenSql()).not.toContain("UPDATE");
  });
});

describe("writeControlPartsSql", () => {
  it("emits parents before children so every parentPartId resolves in one INSERT", () => {
    const control = makeControl({
      statementParts: [
        makePart({
          oscalPartId: "ac-1_smt",
          name: "statement",
          label: null,
          children: [makePart({ oscalPartId: "ac-1_smt.a" })],
        }),
      ],
    });
    writeControlPartsSql(OUT, [control], scheme, NOTE);
    const sql = writtenSql();
    expect(sql.indexOf("'part_ac-1_smt_r520'")).toBeLessThan(
      sql.indexOf("'part_ac-1_smt.a_r520'"),
    );
  });

  it("gives a root part a NULL parent and a child the root's id", () => {
    const control = makeControl({
      statementParts: [
        makePart({
          oscalPartId: "ac-1_smt",
          name: "statement",
          label: null,
          children: [makePart({ oscalPartId: "ac-1_smt.a" })],
        }),
      ],
    });
    writeControlPartsSql(OUT, [control], scheme, NOTE);
    const sql = writtenSql();
    expect(sql).toContain(`'statement', 'text', 0, NULL, 'ctrl_ac-01_r520'`);
    expect(sql).toContain(`0, 'part_ac-1_smt_r520', 'ctrl_ac-01_r520'`);
  });

  it("writes a valid comment-only file when no control has a statement", () => {
    writeControlPartsSql(OUT, [makeControl()], scheme, NOTE);
    expect(writtenSql()).toContain("No statement parts");
  });
});

describe("writeControlParametersSql", () => {
  it("writes a valid comment-only file, because the absence is decided", () => {
    // NIST declares 1,600 parameters and assigns no values. An absent file would
    // look like a forgotten step; an empty one says the decision was made.
    writeControlParametersSql(OUT, NOTE);
    const sql = writtenSql();
    expect(writtenPath()).toContain("07-control-parameters.sql");
    expect(sql).toContain("Intentionally empty");
    expect(sql).not.toContain("INSERT");
  });
});

describe("writeControlFamiliesSql", () => {
  it("assigns 1-based sort order matching input position", () => {
    writeControlFamiliesSql(
      OUT,
      [
        { id: "AC", name: "Access Control" },
        { id: "AU", name: "Audit" },
      ],
      NOTE,
    );
    const sql = writtenSql();
    expect(sql).toContain(`('AC', 'Access Control', 1)`);
    expect(sql).toContain(`('AU', 'Audit', 2)`);
  });
});
