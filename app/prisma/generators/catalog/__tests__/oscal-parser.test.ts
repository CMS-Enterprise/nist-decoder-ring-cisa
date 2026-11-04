/**
 * Tests for reading the catalog into the internal representation.
 *
 * The cases that matter are the ones where NIST's shape differs from what a
 * reader would assume: three label props per control, a status prop rather than
 * a missing statement marking withdrawal, and statement trees that nest deeper
 * than the two levels Rev 5 happens to use.
 */

import { describe, expect, it } from "vitest";

import { buildParamIndex } from "../parameter-resolver.js";
import {
  catalogControlIds,
  flattenExternalMarkdownLinks,
  isWithdrawn,
  parseControls,
  parseFamilies,
  withdrawalOf,
  zeroPaddedLabel,
} from "../oscal-parser.js";
import type {
  OscalCatalog,
  OscalControl,
  OscalGroup,
  OscalPart,
  OscalProp,
} from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function prop(name: string, value: string, cls?: string): OscalProp {
  return cls === undefined ? { name, value } : { name, value, class: cls };
}

/** The three label props NIST publishes per control, plus a sort id. */
function labelProps(plain: string, padded: string): OscalProp[] {
  return [
    prop("label", plain),
    prop("label", padded, "zero-padded"),
    prop("label", padded, "sp800-53a"),
    prop("sort-id", padded.toLowerCase()),
  ];
}

function makeControl(
  overrides: Partial<OscalControl> & { id: string; padded: string },
): OscalControl {
  const { padded, ...rest } = overrides;
  return {
    title: "Test Control",
    props: labelProps(padded.replace(/0(\d)/g, "$1"), padded),
    ...rest,
  };
}

function statement(
  id: string,
  items: { id: string; label: string; prose: string }[],
): OscalPart {
  return {
    id: `${id}_smt`,
    name: "statement",
    prose: "Do the following:",
    parts: items.map((i) => ({
      id: i.id,
      name: "item",
      prose: i.prose,
      props: [prop("label", i.label)],
    })),
  };
}

function makeCatalog(groups: OscalGroup[]): OscalCatalog {
  return {
    catalog: {
      uuid: "00000000-0000-0000-0000-000000000000",
      metadata: {
        title: "Test Catalog",
        version: "5.2.0",
        "oscal-version": "1.2.2",
        "last-modified": "2026-05-11T00:00:00.000Z",
      },
      groups,
    },
  };
}

/** Parse with no baselines and an index built from the same catalog. */
function parse(catalog: OscalCatalog) {
  return parseControls(catalog, new Map(), buildParamIndex(catalog));
}

// ---------------------------------------------------------------------------

describe("zeroPaddedLabel", () => {
  it("selects the zero-padded label, not whichever prop is last", () => {
    // Three label props share a name; a last-wins prop map would pick by
    // serializer order. The padded form is also what lets a cross-catalog join
    // on control number work.
    const control = makeControl({ id: "ac-2", padded: "AC-02" });
    expect(zeroPaddedLabel(control)).toBe("AC-02");
  });

  it("returns undefined when no label carries the class", () => {
    expect(
      zeroPaddedLabel({ id: "x", title: "t", props: [prop("label", "AC-2")] }),
    ).toBeUndefined();
  });
});

describe("parseFamilies", () => {
  it("uppercases the group id and keeps its title", () => {
    const families = parseFamilies(
      makeCatalog([{ id: "ac", title: "Access Control", controls: [] }]),
    );
    expect(families).toEqual([{ id: "AC", name: "Access Control" }]);
  });

  it("refuses a catalog with no groups rather than returning an empty list", () => {
    // An empty family list would sail through and produce an empty seed.
    expect(() => parseFamilies(makeCatalog([]))).toThrow(/no groups/);
  });
});

describe("withdrawal", () => {
  it("detects withdrawal from the status prop", () => {
    const control = makeControl({
      id: "ac-2.10",
      padded: "AC-02(10)",
      props: [
        ...labelProps("AC-2(10)", "AC-02(10)"),
        prop("status", "withdrawn"),
      ],
    });
    expect(isWithdrawn(control)).toBe(true);
    expect(isWithdrawn(makeControl({ id: "ac-1", padded: "AC-01" }))).toBe(
      false,
    );
  });

  it("prefers incorporated-into over moved-to when a control carries both", () => {
    const control = makeControl({
      id: "x",
      padded: "AC-99",
      props: [...labelProps("AC-99", "AC-99"), prop("status", "withdrawn")],
      links: [
        { rel: "moved-to", href: "#sc-1" },
        { rel: "incorporated-into", href: "#ac-6" },
      ],
    });
    expect(withdrawalOf(control)).toEqual({
      relation: "incorporated-into",
      targets: ["ac-6"],
    });
  });

  it("carries every successor when a control was split across several", () => {
    // Eleven withdrawn controls have more than one successor, which is why the
    // relation cannot be a nullable foreign key.
    const control = makeControl({
      id: "ac-3.6",
      padded: "AC-03(06)",
      props: [
        ...labelProps("AC-3(6)", "AC-03(06)"),
        prop("status", "withdrawn"),
      ],
      links: [
        { rel: "incorporated-into", href: "#mp-4" },
        { rel: "incorporated-into", href: "#sc-28" },
      ],
    });
    expect(withdrawalOf(control)?.targets).toEqual(["mp-4", "sc-28"]);
  });

  it("records a withdrawal with no successor rather than skipping it", () => {
    // Two controls withdraw with no links at all; a null relation is the fact.
    const control = makeControl({
      id: "x",
      padded: "AC-98",
      props: [...labelProps("AC-98", "AC-98"), prop("status", "withdrawn")],
    });
    expect(withdrawalOf(control)).toEqual({ relation: null, targets: [] });
  });

  it("returns undefined for a live control", () => {
    expect(
      withdrawalOf(makeControl({ id: "ac-1", padded: "AC-01" })),
    ).toBeUndefined();
  });
});

describe("parseControls", () => {
  it("reads a control's number, name, ids and family", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "Access Control",
        controls: [
          makeControl({ id: "ac-1", padded: "AC-01", title: "Policy" }),
        ],
      },
    ]);
    const { controls } = parse(catalog);
    expect(controls[0]).toMatchObject({
      controlNumber: "AC-01",
      controlName: "Policy",
      oscalId: "ac-1",
      sortId: "ac-01",
      familyId: "AC",
      parentOscalId: null,
    });
  });

  it("refuses a control with no zero-padded label instead of guessing", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [{ id: "ac-1", title: "t", props: [prop("label", "AC-1")] }],
      },
    ]);
    expect(() => parse(catalog)).toThrow(/no zero-padded label/);
  });

  it("records an enhancement's parent", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-2",
            padded: "AC-02",
            controls: [makeControl({ id: "ac-2.1", padded: "AC-02(01)" })],
          }),
        ],
      },
    ]);
    const { controls } = parse(catalog);
    expect(controls.map((c) => [c.controlNumber, c.parentOscalId])).toEqual([
      ["AC-02", null],
      ["AC-02(01)", "ac-2"],
    ]);
  });

  it("recurses past the two levels Rev 5 happens to use", () => {
    // A reader that hardcoded two levels would silently drop a third if a
    // future revision introduced one.
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            controls: [
              makeControl({
                id: "ac-1.1",
                padded: "AC-01(01)",
                controls: [
                  makeControl({ id: "ac-1.1.1", padded: "AC-01(01)(a)" }),
                ],
              }),
            ],
          }),
        ],
      },
    ]);
    expect(parse(catalog).controls).toHaveLength(3);
  });

  it("includes withdrawn controls so the counts reconcile", () => {
    // Which ones get written is the caller's decision; dropping them here would
    // make the published totals unverifiable.
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({ id: "ac-1", padded: "AC-01" }),
          makeControl({
            id: "ac-2",
            padded: "AC-02",
            props: [
              ...labelProps("AC-2", "AC-02"),
              prop("status", "withdrawn"),
            ],
          }),
        ],
      },
    ]);
    const { controls } = parse(catalog);
    expect(controls).toHaveLength(2);
    expect(controls.filter((c) => c.withdrawal)).toHaveLength(1);
  });

  it("upper-cases related-control references so the column reads the same either way", () => {
    // NIST hrefs are lower-case OSCAL ids; the column stores them upper-case.
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            links: [
              { rel: "related", href: "#ac-6" },
              { rel: "reference", href: "#ignored" },
            ],
          }),
        ],
      },
    ]);
    expect(parse(catalog).controls[0]?.relatedControls).toEqual(["AC-6"]);
  });

  it("builds the statement tree and drops a part with no id", () => {
    // A part with no id cannot be addressed by a foreign key, so it cannot be a row.
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            parts: [
              {
                id: "ac-1_smt",
                name: "statement",
                parts: [
                  {
                    id: "ac-1_smt.a",
                    name: "item",
                    prose: "first",
                    props: [prop("label", "a.")],
                  },
                  { name: "item", prose: "unaddressable" },
                ],
              },
            ],
          }),
        ],
      },
    ]);
    const root = parse(catalog).controls[0]!.statementParts[0]!;
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({
      oscalPartId: "ac-1_smt.a",
      label: "a.",
    });
  });

  it("keeps the published marker verbatim, because it carries the nesting level", () => {
    // NIST uses "a." then "1." then "(a)". Reducing them to a bare letter maps
    // "a." and "(a)" onto the same label and loses the third level.
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            parts: [
              statement("ac-1", [
                { id: "ac-1_smt.a", label: "(a)", prose: "x" },
              ]),
            ],
          }),
        ],
      },
    ]);
    expect(
      parse(catalog).controls[0]?.statementParts[0]?.children[0]?.label,
    ).toBe("(a)");
  });

  it("returns an empty statement list when the control has none", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [makeControl({ id: "ac-1", padded: "AC-01" })],
      },
    ]);
    expect(parse(catalog).controls[0]?.statementParts).toEqual([]);
  });

  it("renders placeholders in statement prose and in guidance", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            params: [{ id: "p1", label: "roles" }],
            parts: [
              statement("ac-1", [
                {
                  id: "ac-1_smt.a",
                  label: "a.",
                  prose: "to {{ insert: param, p1 }}",
                },
              ]),
              {
                id: "ac-1_gdn",
                name: "guidance",
                prose: "see {{ insert: param, p1 }}",
              },
            ],
          }),
        ],
      },
    ]);
    const { controls, resolutions } = parse(catalog);
    expect(controls[0]?.statementParts[0]?.children[0]?.prose).toBe(
      "to [Assignment: organization-defined roles]",
    );
    expect(controls[0]?.guidance).toBe(
      "see [Assignment: organization-defined roles]",
    );
    expect(resolutions).toHaveLength(2);
  });

  it("applies baseline membership from the map it is given", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [makeControl({ id: "ac-1", padded: "AC-01" })],
      },
    ]);
    const { controls } = parseControls(
      catalog,
      new Map([["ac-1", ["Low", "Moderate"]]]),
      buildParamIndex(catalog),
    );
    expect(controls[0]?.baselineLabels).toEqual(["Low", "Moderate"]);
  });
});

describe("catalogControlIds", () => {
  it("collects ids at every depth, so a profile reference can be checked before parsing", () => {
    const catalog = makeCatalog([
      {
        id: "ac",
        title: "AC",
        controls: [
          makeControl({
            id: "ac-1",
            padded: "AC-01",
            controls: [makeControl({ id: "ac-1.1", padded: "AC-01(01)" })],
          }),
        ],
      },
    ]);
    expect([...catalogControlIds(catalog)].sort()).toEqual(["ac-1", "ac-1.1"]);
  });
});

describe("flattenExternalMarkdownLinks", () => {
  it("reduces an external markdown link to its label", () => {
    // PM-17's guidance cites a regulation this way. Nothing in the rendering
    // path parses markdown, so the whole construct reached the page as text.
    expect(
      flattenExternalMarkdownLinks(
        "codified in [32 CFR 2002.14h](https://www.govinfo.gov/content/x.xml) . The policy",
      ),
    ).toBe("codified in 32 CFR 2002.14h . The policy");
  });

  it("leaves internal anchors alone", () => {
    // Over five hundred of these exist. They are intra-document references
    // rather than outward links, and flattening them is a separate decision.
    const prose =
      "see [32 CFR 2002](#91f992fb-f668-4c91-a50f-0f05b95ccee3) and";
    expect(flattenExternalMarkdownLinks(prose)).toBe(prose);
  });

  it("flattens only the external link when both forms share a sentence", () => {
    expect(
      flattenExternalMarkdownLinks(
        "[a](#uuid) and [b](https://example.gov/b) together",
      ),
    ).toBe("[a](#uuid) and b together");
  });

  it("passes null through", () => {
    expect(flattenExternalMarkdownLinks(null)).toBeNull();
  });
});
