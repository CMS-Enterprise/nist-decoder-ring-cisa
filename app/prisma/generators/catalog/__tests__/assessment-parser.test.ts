/**
 * Tests for reading SP 800-53A assessment procedures out of the CPRT export.
 *
 * The cases that matter are the joins: every control and statement the export
 * names must resolve against the catalog the pipeline parsed, and a miss must
 * fail naming the offender rather than drop a row. The fixtures are shaped like
 * the export (flat elements, projections between them) but small enough to read.
 */

import { describe, expect, it } from "vitest";

import {
  CPRT_DOC_IDENTIFIER,
  KNOWN_DIVERGENT_DUPLICATES,
  KNOWN_IDENTICAL_DUPLICATES,
  KNOWN_ORPHAN_DETERMINATIONS,
  indexExport,
  readAssessmentContent,
  renderOdpReferences,
  statementToPartId,
} from "../assessment-parser.js";
import { assertExpectations } from "../expectations.js";
import type {
  CprtElement,
  CprtExport,
  CprtRelationship,
  OdpResolution,
  ParsedControl,
  ParsedPart,
} from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function el(
  element_type: string,
  element_identifier: string,
  text = "",
  title = "",
): CprtElement {
  return {
    doc_identifier: CPRT_DOC_IDENTIFIER,
    element_type,
    element_identifier,
    title,
    text,
  };
}

function proj(source: string, dest: string): CprtRelationship {
  return {
    source_doc_identifier: CPRT_DOC_IDENTIFIER,
    source_element_identifier: source,
    dest_doc_identifier: CPRT_DOC_IDENTIFIER,
    dest_element_identifier: dest,
    provenance_doc_identifier: CPRT_DOC_IDENTIFIER,
    relationship_identifier: "projection",
  };
}

function makeExport(
  elements: CprtElement[],
  relationships: CprtRelationship[],
): CprtExport {
  return {
    response: {
      requestType: "framework",
      elements: {
        documents: [
          {
            doc_identifier: CPRT_DOC_IDENTIFIER,
            name: "Assessing Security and Privacy Controls",
            version: "5.2.0",
            website: "https://example.test/sp800-53a.pdf",
          },
        ],
        elements,
        relationships,
        relationship_types: [
          { relationship_identifier: "projection", description: "" },
        ],
      },
    },
  };
}

function part(oscalPartId: string, children: ParsedPart[] = []): ParsedPart {
  return {
    oscalPartId,
    name: oscalPartId.endsWith("_smt") ? "statement" : "item",
    label: null,
    prose: "text",
    sortOrder: 0,
    children,
  };
}

function control(
  controlNumber: string,
  oscalId: string,
  statementParts: ParsedPart[],
  withdrawn = false,
): ParsedControl {
  const c: ParsedControl = {
    controlNumber,
    controlName: `Control ${controlNumber}`,
    oscalId,
    sortId: controlNumber.toLowerCase(),
    guidance: null,
    parentOscalId: oscalId.includes(".") ? oscalId.split(".")[0]! : null,
    familyId: "AC",
    baselineLabels: [],
    relatedControls: [],
    statementParts,
  };
  if (withdrawn) c.withdrawal = { relation: "incorporated-into", targets: [] };
  return c;
}

/** AC-02 with items a and c, its enhancement AC-02(01) as a single block, and
 *  the withdrawn AC-02(10): the three shapes the real export has. */
const LIVE = [
  control("AC-02", "ac-2", [
    part("ac-2_smt", [part("ac-2_smt.a"), part("ac-2_smt.c")]),
  ]),
  control("AC-02(01)", "ac-2.1", [part("ac-2.1_smt")]),
];
const WITHDRAWN = [control("AC-02(10)", "ac-2.10", [], true)];

const ELEMENTS: CprtElement[] = [
  el("control", "AC-02", "", "ACCOUNT MANAGEMENT"),
  el("control_enhancement", "AC-02(01)", "", "AUTOMATED"),
  el("control_enhancement", "AC-02(10)", "", "WITHDRAWN"),
  el("control_statement", "CST-AC-02"),
  el("control_statement", "CST-AC-02-a", "Define account types:"),
  el(
    "control_statement",
    "CST-AC-02-c",
    "Require [Assignment: ...] for membership;",
  ),
  el(
    "control_statement",
    "CST-AC-02(01)",
    "Support account management using ...",
  ),
  el("control_statement", "CST-AC-02(10)", "Withdrawn"),
  el("determination", "DS-AC-02a.[01]", "account types allowed are defined;"),
  el(
    "determination",
    "DS-AC-02a.[02]",
    "account types prohibited are defined;",
  ),
  el(
    "determination",
    "DS-AC-02c.",
    "<AC-02_ODP[01] prerequisites and criteria> for membership are required;",
  ),
  el(
    "determination",
    "DS-AC-02(01)",
    "account management is supported using <AC-02(01)_ODP automated mechanisms>.",
  ),
  el("determination", "DS-AC-02(10)", "[WITHDRAWN: Incorporated into AC-2k.]"),
  el(
    "odp",
    "AC-02_ODP[01]",
    "prerequisites and criteria are defined;",
    "prerequisites and criteria",
  ),
  el(
    "odp",
    "AC-02(01)_ODP",
    "automated mechanisms are defined;",
    "automated mechanisms",
  ),
  el("odp_type", "single_entry", "", "Assignment"),
  el(
    "examine",
    "E-AC-02",
    "[SELECT FROM: Access control policy; account records].",
  ),
  el("interview", "I-AC-02", "[SELECT FROM: Account managers]."),
  el("test", "T-AC-02", "[SELECT FROM: Account management mechanisms]."),
  el("examine", "E-AC-02(01)", "[SELECT FROM: Automated mechanisms]."),
  el("interview", "I-AC-02(01)", "[SELECT FROM: Administrators]."),
];

const RELATIONSHIPS: CprtRelationship[] = [
  proj("AC-02", "CST-AC-02"),
  proj("CST-AC-02", "CST-AC-02-a"),
  proj("CST-AC-02", "CST-AC-02-c"),
  proj("CST-AC-02-a", "DS-AC-02a.[01]"),
  proj("CST-AC-02-a", "DS-AC-02a.[02]"),
  proj("CST-AC-02-c", "DS-AC-02c."),
  proj("AC-02", "E-AC-02"),
  proj("AC-02", "I-AC-02"),
  proj("AC-02", "T-AC-02"),
  proj("AC-02(01)", "CST-AC-02(01)"),
  proj("CST-AC-02(01)", "DS-AC-02(01)"),
  proj("AC-02(01)", "E-AC-02(01)"),
  proj("AC-02(01)", "I-AC-02(01)"),
  proj("AC-02(10)", "CST-AC-02(10)"),
  proj("CST-AC-02(10)", "DS-AC-02(10)"),
  proj("AC-02_ODP[01]", "single_entry"),
  proj("AC-02(01)_ODP", "single_entry"),
];

// ===========================================================================
//  indexExport
// ===========================================================================

describe("indexExport", () => {
  it("indexes elements by type and projections by source, in export order", () => {
    const index = indexExport(makeExport(ELEMENTS, RELATIONSHIPS));
    expect(index.version).toBe("5.2.0");
    expect(index.byType.get("determination")?.size).toBe(5);
    expect(index.projections.get("CST-AC-02")).toEqual([
      "CST-AC-02-a",
      "CST-AC-02-c",
    ]);
    expect(index.duplicates).toEqual([]);
    expect(index.danglingEndpoints).toEqual([]);
  });

  it("collects a relationship endpoint that names no element, rather than filtering it", () => {
    // The type-filtered reads cannot see this: a target of the wrong type and a target that does not exist both disappear from projectedOfType.
    const index = indexExport(
      makeExport(ELEMENTS, [
        ...RELATIONSHIPS,
        proj("CST-AC-02-a", "DS-GHOST[01]"),
        proj("ZZ-NOWHERE", "DS-AC-02a.[01]"),
      ]),
    );
    expect(index.danglingEndpoints).toEqual([
      "dest:DS-GHOST[01]",
      "source:ZZ-NOWHERE",
    ]);
  });

  it("refuses an export that is not the one document this reader was measured against", () => {
    const raw = makeExport(ELEMENTS, RELATIONSHIPS);
    raw.response.elements.documents[0]!.doc_identifier = "SP_800_53_5_2_0";
    expect(() => indexExport(raw)).toThrow(/Expected exactly one document/);
  });

  it("refuses an element that belongs to another document", () => {
    const stray = { ...el("control", "ZZ-01"), doc_identifier: "OTHER" };
    expect(() =>
      indexExport(makeExport([...ELEMENTS, stray], RELATIONSHIPS)),
    ).toThrow(/belongs to OTHER/);
  });

  it("refuses a payload with no response.elements", () => {
    expect(() => indexExport({} as CprtExport)).toThrow(/not a CPRT/);
  });

  it("keeps the first of a duplicated identifier and records whether the copies agree", () => {
    const dup = el(
      "odp",
      "AC-02_ODP[01]",
      "second copy",
      "prerequisites and criteria",
    );
    const index = indexExport(makeExport([...ELEMENTS, dup], RELATIONSHIPS));
    expect(index.duplicates).toEqual([
      {
        identifier: "AC-02_ODP[01]",
        elementType: "odp",
        copies: 2,
        identical: false,
      },
    ]);
    expect(index.byType.get("odp")?.get("AC-02_ODP[01]")?.text).toBe(
      "prerequisites and criteria are defined;",
    );
  });

  it("marks a byte-identical republication as identical, where first-wins loses nothing", () => {
    const same = el(
      "odp",
      "AC-02_ODP[01]",
      "prerequisites and criteria are defined;",
      "prerequisites and criteria",
    );
    const index = indexExport(makeExport([...ELEMENTS, same], RELATIONSHIPS));
    expect(index.duplicates).toEqual([
      {
        identifier: "AC-02_ODP[01]",
        elementType: "odp",
        copies: 2,
        identical: true,
      },
    ]);
  });

  it("treats a differing title as divergent, not only differing text", () => {
    const retitled = el(
      "odp",
      "AC-02_ODP[01]",
      "prerequisites and criteria are defined;",
      "something else",
    );
    const index = indexExport(
      makeExport([...ELEMENTS, retitled], RELATIONSHIPS),
    );
    expect(index.duplicates[0]!.identical).toBe(false);
  });

  it("does not conflate one identifier reused across two element types", () => {
    // Same identifier under two types is not a duplicate: the reads are type-scoped.
    const other = el("odp", "DS-AC-02b.", "an odp that happens to share an id");
    const index = indexExport(makeExport([...ELEMENTS, other], RELATIONSHIPS));
    expect(index.duplicates).toEqual([]);
  });
});

// ===========================================================================
//  statementToPartId
// ===========================================================================

describe("statementToPartId", () => {
  it("maps a root statement to the control's statement part", () => {
    expect(statementToPartId("CST-AC-02")).toBe("ac-2_smt");
    expect(statementToPartId("CST-AC-02(01)")).toBe("ac-2.1_smt");
  });

  it("maps lettered and numbered paths, stripping CPRT's zero padding on numbers", () => {
    expect(statementToPartId("CST-AC-02-a")).toBe("ac-2_smt.a");
    expect(statementToPartId("CST-AC-02(01)-b")).toBe("ac-2.1_smt.b");
    expect(statementToPartId("CST-AC-03(03)-b-01")).toBe("ac-3.3_smt.b.1");
    expect(statementToPartId("CST-IA-05(02)-a-2")).toBe("ia-5.2_smt.a.2");
  });

  it("returns null for a shape it does not know rather than guessing", () => {
    expect(statementToPartId("CST-AC-2")).not.toBeNull(); // unpadded number still parses
    expect(statementToPartId("DS-AC-02a.[01]")).toBeNull();
    expect(statementToPartId("CST-AC-02-A")).toBeNull(); // upper-case segment is not a path
  });
});

// ===========================================================================
//  renderOdpReferences
// ===========================================================================

describe("renderOdpReferences", () => {
  const index = indexExport(makeExport(ELEMENTS, RELATIONSHIPS));

  it("renders an assignment in the catalog's bracket convention and logs it", () => {
    const log: OdpResolution[] = [];
    const out = renderOdpReferences(
      index,
      "DS-AC-02c.",
      "<AC-02_ODP[01] prerequisites and criteria> for membership are required;",
      log,
    );
    expect(out).toBe(
      "[Assignment: organization-defined prerequisites and criteria] for membership are required;",
    );
    expect(log).toEqual([
      {
        cprtIdentifier: "DS-AC-02c.",
        odpId: "AC-02_ODP[01]",
        rendered:
          "[Assignment: organization-defined prerequisites and criteria]",
      },
    ]);
  });

  it("handles an unindexed ODP identifier", () => {
    const log: OdpResolution[] = [];
    expect(
      renderOdpReferences(
        index,
        "x",
        "using <AC-02(01)_ODP automated mechanisms>.",
        log,
      ),
    ).toBe("using [Assignment: organization-defined automated mechanisms].");
  });

  it("does not double an 'organization-defined' the label already carries", () => {
    const withLabel = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("odp", "AC-03_ODP[01]", "", "organization-defined policy"),
        ],
        [...RELATIONSHIPS, proj("AC-03_ODP[01]", "single_entry")],
      ),
    );
    expect(
      renderOdpReferences(
        withLabel,
        "x",
        "<AC-03_ODP[01] organization-defined policy> applies",
        [],
      ),
    ).toBe("[Assignment: organization-defined policy] applies");
  });

  it("renders a selection from the odp_statement's choices, not the reference's placeholder text", () => {
    const withSelect = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el(
            "odp",
            "AC-02(02)_ODP[01]",
            "one of the following PARAMETER VALUES is selected: {remove; disable};",
            "SELECTED PARAMETER VALUE",
          ),
          el("odp_statement", "OS-ac-02(02)_odp[01]", " remove; disable"),
          el("odp_type", "single_select", "", "Selection (one)"),
          el("odp", "AC-01_ODP[03]", "", "SELECTED PARAMETER VALUES"),
          el(
            "odp_statement",
            "OS-ac-01_odp[03]",
            "organization-level; system-level",
          ),
          el("odp_type", "multi_select", "", "Selection (one or more)"),
        ],
        [
          ...RELATIONSHIPS,
          proj("AC-02(02)_ODP[01]", "OS-ac-02(02)_odp[01]"),
          proj("AC-02(02)_ODP[01]", "single_select"),
          proj("AC-01_ODP[03]", "multi_select"),
          proj("AC-01_ODP[03]", "OS-ac-01_odp[03]"),
        ],
      ),
    );
    expect(
      renderOdpReferences(
        withSelect,
        "x",
        "accounts are <AC-02(02)_ODP[01] SELECTED PARAMETER VALUE> after",
        [],
      ),
    ).toBe("accounts are [Selection (one): remove; disable] after");
    expect(
      renderOdpReferences(
        withSelect,
        "x",
        "<AC-01_ODP[03] SELECTED PARAMETER VALUES> policy",
        [],
      ),
    ).toBe(
      "[Selection (one or more): organization-level; system-level] policy",
    );
  });

  it("renders a reference nested inside a selection's choices, one level down", () => {
    const nested = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("odp", "AC-04(04)_ODP[02]", "", "SELECTED PARAMETER VALUES"),
          el(
            "odp_statement",
            "OS-ac-04(04)_odp[02]",
            "decrypting; <AC-04(04)_ODP[03] organization-defined procedure>",
          ),
          el("odp", "AC-04(04)_ODP[03]", "", "organization-defined procedure"),
          el("odp_type", "multi_select", "", "Selection (one or more)"),
        ],
        [
          ...RELATIONSHIPS,
          proj("AC-04(04)_ODP[02]", "multi_select"),
          proj("AC-04(04)_ODP[02]", "OS-ac-04(04)_odp[02]"),
          proj("AC-04(04)_ODP[03]", "single_entry"),
        ],
      ),
    );
    const log: OdpResolution[] = [];
    expect(
      renderOdpReferences(
        nested,
        "x",
        "by <AC-04(04)_ODP[02] SELECTED PARAMETER VALUES>;",
        log,
      ),
    ).toBe(
      "by [Selection (one or more): decrypting; [Assignment: organization-defined procedure]];",
    );
    // Only the top-level reference is logged.
    expect(log).toHaveLength(1);
  });

  it("leaves an unknown reference in place and logs it unresolved", () => {
    const log: OdpResolution[] = [];
    const out = renderOdpReferences(
      index,
      "x",
      "see <ZZ-99_ODP[01] nothing> here",
      log,
    );
    expect(out).toBe("see <ZZ-99_ODP[01] nothing> here");
    expect(log[0]?.rendered).toBeNull();
  });

  it("returns text without references unchanged and logs nothing", () => {
    const log: OdpResolution[] = [];
    expect(renderOdpReferences(index, "x", "plain text;", log)).toBe(
      "plain text;",
    );
    expect(log).toEqual([]);
  });
});

// ===========================================================================
//  readAssessmentContent
// ===========================================================================

describe("readAssessmentContent", () => {
  const index = indexExport(makeExport(ELEMENTS, RELATIONSHIPS));
  const content = readAssessmentContent(index, LIVE, WITHDRAWN);

  it("attaches determinations to the control and to the lettered part they assess", () => {
    expect(
      content.objectives.map((o) => [
        o.cprtIdentifier,
        o.controlNumber,
        o.oscalPartId,
        o.sortOrder,
      ]),
    ).toEqual([
      ["DS-AC-02a.[01]", "AC-02", "ac-2_smt.a", 0],
      ["DS-AC-02a.[02]", "AC-02", "ac-2_smt.a", 1],
      ["DS-AC-02c.", "AC-02", "ac-2_smt.c", 2],
      ["DS-AC-02(01)", "AC-02(01)", null, 0],
    ]);
  });

  it("renders ODP references in determination text", () => {
    expect(content.objectives[2]!.text).toBe(
      "[Assignment: organization-defined prerequisites and criteria] for membership are required;",
    );
    expect(content.odpResolutions).toHaveLength(2);
  });

  it("reads one method entry per kind per control, in examine / interview / test order", () => {
    expect(content.methods.map((m) => [m.controlNumber, m.method])).toEqual([
      ["AC-02", "EXAMINE"],
      ["AC-02", "INTERVIEW"],
      ["AC-02", "TEST"],
      ["AC-02(01)", "EXAMINE"],
      ["AC-02(01)", "INTERVIEW"],
    ]);
  });

  it("names which controls lack each method kind, and which lack every kind", () => {
    // Per kind and by name, because "1 control has no method" would describe AC-02(01) — which carries two of the three — as having no assessment content.
    expect(content.measured.controlsWithoutMethod).toEqual({
      EXAMINE: [],
      INTERVIEW: [],
      TEST: ["AC-02(01)"],
    });
    expect(content.measured.controlsWithoutAnyMethod).toEqual([]);
  });

  it("separates a control carrying no method at all from one missing a single kind", () => {
    const withBare = [...LIVE, control("AC-03", "ac-3", [part("ac-3_smt")])];
    const bare = readAssessmentContent(
      indexExport(
        makeExport(
          [
            ...ELEMENTS,
            el("control", "AC-03"),
            el("control_statement", "CST-AC-03", "x"),
            el("determination", "DS-AC-03", "y"),
          ],
          [
            ...RELATIONSHIPS,
            proj("AC-03", "CST-AC-03"),
            proj("CST-AC-03", "DS-AC-03"),
          ],
        ),
      ),
      withBare,
      WITHDRAWN,
    );
    expect(bare.measured.controlsWithoutAnyMethod).toEqual(["AC-03"]);
    expect(bare.measured.controlsWithoutMethod.EXAMINE).toEqual(["AC-03"]);
  });

  it("counts withdrawn controls and emits nothing for them", () => {
    expect(content.measured.controlsInExport).toBe(3);
    expect(content.measured.controlsWithdrawn).toBe(1);
    expect(content.measured.controlsLive).toBe(2);
    expect(
      content.objectives.some((o) => o.controlNumber === "AC-02(10)"),
    ).toBe(false);
    // The withdrawn control's determination is reached, so it is not an orphan.
    expect(content.measured.determinationsOrphaned).toEqual([]);
  });

  it("measures the statement join exactly", () => {
    expect(content.measured.statementsLive).toBe(4);
    expect(content.measured.statementsResolved).toBe(4);
    expect(content.measured.controlsWithoutObjectives).toEqual([]);
  });

  it("emits in catalog order, whatever order the export listed things", () => {
    const shuffled = makeExport(
      [...ELEMENTS].reverse(),
      [...RELATIONSHIPS].reverse(),
    );
    const out = readAssessmentContent(indexExport(shuffled), LIVE, WITHDRAWN);
    expect(out.objectives.map((o) => o.controlNumber)).toEqual([
      "AC-02",
      "AC-02",
      "AC-02",
      "AC-02(01)",
    ]);
    expect(out.methods.map((m) => m.method)).toEqual([
      "EXAMINE",
      "INTERVIEW",
      "TEST",
      "EXAMINE",
      "INTERVIEW",
    ]);
  });

  it("throws, naming the control, when the export names a control the catalog lacks", () => {
    const extra = indexExport(
      makeExport([...ELEMENTS, el("control", "ZZ-99")], RELATIONSHIPS),
    );
    expect(() => readAssessmentContent(extra, LIVE, WITHDRAWN)).toThrow(
      /1 control\(s\) in the export are not in the catalog: ZZ-99/,
    );
  });

  it("throws, naming the statement, when a statement matches no seeded part", () => {
    const extra = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("control_statement", "CST-AC-02-m", "an item the catalog lacks"),
        ],
        [...RELATIONSHIPS, proj("CST-AC-02", "CST-AC-02-m")],
      ),
    );
    expect(() => readAssessmentContent(extra, LIVE, WITHDRAWN)).toThrow(
      /match no seeded part: CST-AC-02-m/,
    );
  });

  it("reports a determination nothing projects to as orphaned", () => {
    const extra = indexExport(
      makeExport(
        [...ELEMENTS, el("determination", "DS-IA-*[05]", "unreachable")],
        RELATIONSHIPS,
      ),
    );
    const out = readAssessmentContent(extra, LIVE, WITHDRAWN);
    expect(out.measured.determinationsOrphaned).toEqual(["DS-IA-*[05]"]);
    expect(KNOWN_ORPHAN_DETERMINATIONS.has("DS-IA-*[05]")).toBe(true);
  });

  it("refuses a control that projects to two entries of one method kind", () => {
    const extra = indexExport(
      makeExport(
        [...ELEMENTS, el("test", "T-AC-02-again", "[SELECT FROM: more].")],
        [...RELATIONSHIPS, proj("AC-02", "T-AC-02-again")],
      ),
    );
    expect(() => readAssessmentContent(extra, LIVE, WITHDRAWN)).toThrow(
      /projects to 2 test elements/,
    );
  });

  it("refuses a method whose identifier prefix disagrees with its type", () => {
    const extra = indexExport(
      makeExport(
        [...ELEMENTS, el("test", "E-AC-02(01)-x", "[SELECT FROM: x].")],
        [...RELATIONSHIPS, proj("AC-02(01)", "E-AC-02(01)-x")],
      ),
    );
    expect(() => readAssessmentContent(extra, LIVE, WITHDRAWN)).toThrow(
      /identifier says otherwise/,
    );
  });

  it("sorts republished and divergent duplicates into separate measurements", () => {
    const dup = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("odp", "IA-13_ODP[01]", "same text"),
          el("odp", "IA-13_ODP[01]", "same text"),
          el("determination", "DS-AC-02b.", "one text"),
          el("determination", "DS-AC-02b.", "a different text"),
        ],
        RELATIONSHIPS,
      ),
    );
    const out = readAssessmentContent(dup, LIVE, WITHDRAWN);
    expect(out.measured.duplicatesIdentical).toEqual(["IA-13_ODP[01]"]);
    expect(out.measured.duplicatesDivergent).toEqual(["DS-AC-02b."]);
    expect(KNOWN_IDENTICAL_DUPLICATES.has("IA-13_ODP[01]")).toBe(true);
    expect(KNOWN_DIVERGENT_DUPLICATES.has("DS-IA-*(*)[01]")).toBe(true);
  });

  it("flags a divergent duplicate that was actually emitted, rather than trusting it is unreachable", () => {
    // DS-AC-02a.[01] is reachable and emitted, so a second copy under that id means first-wins silently dropped content that shipped. The declared one at the pin is safe only because it is also an orphan; this is the assertion of that.
    const dup = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("determination", "DS-AC-02a.[01]", "a conflicting second text"),
        ],
        RELATIONSHIPS,
      ),
    );
    const out = readAssessmentContent(dup, LIVE, WITHDRAWN);
    expect(out.measured.duplicatesDivergent).toEqual(["DS-AC-02a.[01]"]);
    expect(out.measured.divergentDuplicatesEmitted).toEqual(["DS-AC-02a.[01]"]);
  });

  it("does not flag a divergent duplicate that never reaches the output", () => {
    const dup = indexExport(
      makeExport(
        [
          ...ELEMENTS,
          el("determination", "DS-UNREACHED", "first"),
          el("determination", "DS-UNREACHED", "second"),
        ],
        RELATIONSHIPS,
      ),
    );
    const out = readAssessmentContent(dup, LIVE, WITHDRAWN);
    expect(out.measured.duplicatesDivergent).toEqual(["DS-UNREACHED"]);
    expect(out.measured.divergentDuplicatesEmitted).toEqual([]);
  });

  it("passes the export's dangling endpoints through to the measurement", () => {
    const withGhost = indexExport(
      makeExport(ELEMENTS, [...RELATIONSHIPS, proj("CST-AC-02-a", "DS-GHOST")]),
    );
    const out = readAssessmentContent(withGhost, LIVE, WITHDRAWN);
    expect(out.measured.danglingEndpoints).toEqual(["dest:DS-GHOST"]);
  });
});

// ===========================================================================
//  Counting against the catalog rather than against the export
// ===========================================================================

describe("completeness measured against the catalog", () => {
  it("names a live catalog control the export never mentions", () => {
    // The failure this exists for: the export stops naming a control, it emits no rows, and every count derived from the export still balances. AC-03 is in the catalog and absent from the export.
    const catalog = [...LIVE, control("AC-03", "ac-3", [part("ac-3_smt")])];
    const out = readAssessmentContent(
      indexExport(makeExport(ELEMENTS, RELATIONSHIPS)),
      catalog,
      WITHDRAWN,
    );
    expect(out.measured.catalogLive).toBe(3);
    expect(out.measured.controlsMissingFromExport).toEqual(["AC-03"]);
    expect(out.measured.controlsLive).toBe(2);
    // And it is visible in the per-control measurements too, rather than only in the new one — the old shape reported an empty list here.
    expect(out.measured.controlsWithoutObjectives).toEqual(["AC-03"]);
    expect(out.measured.controlsWithoutAnyMethod).toEqual(["AC-03"]);
  });

  it("reports nothing missing when the export covers the whole catalog", () => {
    const out = readAssessmentContent(
      indexExport(makeExport(ELEMENTS, RELATIONSHIPS)),
      LIVE,
      WITHDRAWN,
    );
    expect(out.measured.controlsMissingFromExport).toEqual([]);
    expect(out.measured.catalogLive).toBe(out.measured.controlsLive);
  });

  it("counts withdrawn controls from the export without letting them into the live set", () => {
    const out = readAssessmentContent(
      indexExport(makeExport(ELEMENTS, RELATIONSHIPS)),
      LIVE,
      WITHDRAWN,
    );
    expect(out.measured.controlsInExport).toBe(3);
    expect(out.measured.controlsWithdrawn).toBe(1);
    expect(out.measured.catalogLive).toBe(2);
  });
});

// ===========================================================================
//  The gate, on a deliberately truncated input
// ===========================================================================

describe("assessment gate on a truncated export", () => {
  it("fails the determination floor when the export loses its determinations", () => {
    // Drop every determination projection: the reader finds controls and statements but no procedures, which is the collapse the gate exists for.
    const truncated = indexExport(
      makeExport(
        ELEMENTS,
        RELATIONSHIPS.filter(
          (r) => !r.dest_element_identifier.startsWith("DS-"),
        ),
      ),
    );
    const out = readAssessmentContent(truncated, LIVE, WITHDRAWN);
    expect(out.objectives).toHaveLength(0);
    expect(out.measured.controlsWithoutObjectives).toEqual([
      "AC-02",
      "AC-02(01)",
    ]);
    expect(() =>
      assertExpectations("nist assessment", [
        {
          name: "determination statements",
          actual: out.objectives.length,
          floor: 4,
        },
        {
          name: "controls with no determination",
          actual: out.measured.controlsWithoutObjectives.length,
          floor: 0,
          ceiling: 0,
          because: "every live control carries at least one",
        },
      ]),
    ).toThrow(
      /determination statements: got 0, expected at least 4[\s\S]*controls with no determination: got 2/,
    );
  });
});

describe("readAssessmentContent — reading order", () => {
  // AC-02d is a lettered item with numbered sub-items. The export lists the
  // sub-item statements after every lettered statement; the published
  // assessment lists d.01 between c. and e. The walk must be depth-first so
  // the numbering follows the page, not the export.
  const live = [
    control("AC-02", "ac-2", [
      part("ac-2_smt", [
        part("ac-2_smt.c"),
        part("ac-2_smt.d", [part("ac-2_smt.d.1")]),
        part("ac-2_smt.e"),
      ]),
    ]),
  ];
  const elements: CprtElement[] = [
    el("control", "AC-02", "", "ACCOUNT MANAGEMENT"),
    el("control_statement", "CST-AC-02"),
    el("control_statement", "CST-AC-02-c", "Require criteria;"),
    el("control_statement", "CST-AC-02-d", "Specify:"),
    el("control_statement", "CST-AC-02-e", "Require approvals;"),
    el("control_statement", "CST-AC-02-d-01", "Authorized users;"),
    el("determination", "DS-AC-02c.", "criteria are required;"),
    el("determination", "DS-AC-02e.", "approvals are required;"),
    el("determination", "DS-AC-02d.01", "authorized users are specified;"),
    el("examine", "E-AC-02", "[SELECT FROM: Account records]."),
  ];
  const relationships: CprtRelationship[] = [
    proj("AC-02", "CST-AC-02"),
    proj("CST-AC-02", "CST-AC-02-c"),
    proj("CST-AC-02", "CST-AC-02-d"),
    proj("CST-AC-02", "CST-AC-02-e"),
    proj("CST-AC-02-d", "CST-AC-02-d-01"),
    proj("CST-AC-02-c", "DS-AC-02c."),
    proj("CST-AC-02-e", "DS-AC-02e."),
    proj("CST-AC-02-d-01", "DS-AC-02d.01"),
    proj("AC-02", "E-AC-02"),
  ];

  it("numbers a nested item's determinations before the next lettered item's", () => {
    const out = readAssessmentContent(
      indexExport(makeExport(elements, relationships)),
      live,
      [],
    );
    expect(
      out.objectives.map((o) => [o.cprtIdentifier, o.oscalPartId, o.sortOrder]),
    ).toEqual([
      ["DS-AC-02c.", "ac-2_smt.c", 0],
      ["DS-AC-02d.01", "ac-2_smt.d.1", 1],
      ["DS-AC-02e.", "ac-2_smt.e", 2],
    ]);
  });
});
