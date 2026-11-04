/**
 * Tests for placeholder rendering.
 *
 * NIST assigns no parameter values; it leaves `{{ insert: param, <id> }}` markers
 * where a value belongs. Rendering them wrong is visible on the page, so the
 * cases here are mostly about what the rendered text says and what happens when
 * an id resolves to nothing.
 */

import { describe, expect, it } from "vitest";

import {
  buildParamIndex,
  renderPlaceholders,
  type Resolution,
} from "../parameter-resolver.js";
import type {
  OscalCatalog,
  OscalControl,
  OscalGroup,
  OscalParam,
} from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeControl(
  overrides: Partial<OscalControl> & { id: string },
): OscalControl {
  return { title: "Test Control", ...overrides };
}

function makeGroup(
  overrides: Partial<OscalGroup> & { id: string },
): OscalGroup {
  return { title: "Test Family", controls: [], ...overrides };
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

/** A catalog whose single control declares the given parameters. */
function catalogWithParams(
  params: OscalParam[],
  controlId = "ac-1",
): OscalCatalog {
  return makeCatalog([
    makeGroup({ id: "ac", controls: [makeControl({ id: controlId, params })] }),
  ]);
}

const at = { controlId: "ac-1", partId: "ac-1_smt" };

// ---------------------------------------------------------------------------
// buildParamIndex
// ---------------------------------------------------------------------------

describe("buildParamIndex", () => {
  it("indexes parameters declared on a control, a nested control, and a group", () => {
    // Catalog-wide rather than per-control because prose regularly references a
    // parameter declared on the parent or on the family's policy control.
    const catalog = makeCatalog([
      makeGroup({
        id: "ac",
        params: [{ id: "ac-prm", label: "group level" }],
        controls: [
          makeControl({
            id: "ac-1",
            params: [{ id: "ac-1_prm_1", label: "control level" }],
            controls: [
              makeControl({
                id: "ac-1.1",
                params: [{ id: "ac-1.1_prm_1", label: "enhancement level" }],
              }),
            ],
          }),
        ],
      }),
    ]);
    const index = buildParamIndex(catalog);
    expect([...index.keys()].sort()).toEqual([
      "ac-1.1_prm_1",
      "ac-1_prm_1",
      "ac-prm",
    ]);
    expect(index.get("ac-prm")?.ownerId).toBe("ac");
    expect(index.get("ac-1.1_prm_1")?.ownerId).toBe("ac-1.1");
  });

  it("refuses a duplicate parameter id rather than letting last-wins decide", () => {
    // Parameter ids are globally unique in OSCAL. A duplicate means the catalog
    // is malformed, and resolving it silently would make the output depend on
    // traversal order.
    const catalog = makeCatalog([
      makeGroup({
        id: "ac",
        controls: [
          makeControl({ id: "ac-1", params: [{ id: "dupe", label: "first" }] }),
          makeControl({
            id: "ac-2",
            params: [{ id: "dupe", label: "second" }],
          }),
        ],
      }),
    ]);
    expect(() => buildParamIndex(catalog)).toThrow(/duplicate parameter id/);
    expect(() => buildParamIndex(catalog)).toThrow(/dupe/);
  });

  it("returns an empty index for a catalog that declares none", () => {
    expect(buildParamIndex(catalogWithParams([])).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renderPlaceholders
// ---------------------------------------------------------------------------

describe("renderPlaceholders", () => {
  it("returns null and empty prose untouched, and logs nothing", () => {
    const log: Resolution[] = [];
    const index = buildParamIndex(catalogWithParams([]));
    expect(renderPlaceholders(null, index, at, log)).toBeNull();
    expect(renderPlaceholders("plain prose", index, at, log)).toBe(
      "plain prose",
    );
    expect(log).toEqual([]);
  });

  it("renders an assignment in the publication's bracket convention", () => {
    const index = buildParamIndex(
      catalogWithParams([{ id: "p1", label: "personnel or roles" }]),
    );
    const out = renderPlaceholders(
      "disseminate to {{ insert: param, p1 }};",
      index,
      at,
      [],
    );
    expect(out).toBe(
      "disseminate to [Assignment: organization-defined personnel or roles];",
    );
  });

  it("does not double a label that already says organization-defined", () => {
    // The publication is inconsistent about it, and doubling reads as our bug.
    const index = buildParamIndex(
      catalogWithParams([
        { id: "p1", label: "organization-defined frequency" },
      ]),
    );
    expect(renderPlaceholders("{{ insert: param, p1 }}", index, at, [])).toBe(
      "[Assignment: organization-defined frequency]",
    );
  });

  it("falls back to the parameter id when it carries no label", () => {
    const index = buildParamIndex(catalogWithParams([{ id: "p1" }]));
    expect(renderPlaceholders("{{ insert: param, p1 }}", index, at, [])).toBe(
      "[Assignment: organization-defined p1]",
    );
  });

  it("renders a selection, and marks when more than one may be chosen", () => {
    const index = buildParamIndex(
      catalogWithParams([
        { id: "one", select: { choice: ["a", "b"] } },
        {
          id: "many",
          select: { "how-many": "one-or-more", choice: ["a", "b"] },
        },
      ]),
    );
    expect(renderPlaceholders("{{ insert: param, one }}", index, at, [])).toBe(
      "[Selection: a; b]",
    );
    expect(renderPlaceholders("{{ insert: param, many }}", index, at, [])).toBe(
      "[Selection (one or more): a; b]",
    );
  });

  it("renders a placeholder nested inside a selection choice", () => {
    // 71 choices carry placeholders of their own at the pin, so this is the
    // common case rather than an edge one.
    const index = buildParamIndex(
      catalogWithParams([
        {
          id: "outer",
          select: { choice: ["after {{ insert: param, inner }} of it"] },
        },
        { id: "inner", label: "a duration" },
      ]),
    );
    expect(
      renderPlaceholders("{{ insert: param, outer }}", index, at, []),
    ).toBe(
      "[Selection: after [Assignment: organization-defined a duration] of it]",
    );
  });

  it("terminates on a self-referential parameter rather than recursing forever", () => {
    // Real data never approaches the depth cap; it exists so a malformed catalog
    // fails as output rather than as a stack overflow.
    const index = buildParamIndex(
      catalogWithParams([
        { id: "loop", select: { choice: ["{{ insert: param, loop }}"] } },
      ]),
    );
    const out = renderPlaceholders("{{ insert: param, loop }}", index, at, []);
    expect(out).not.toBeNull();
    expect(out).toContain("[Selection:");
    expect(out!.length).toBeLessThan(500);
  });

  it("leaves an unresolvable marker in place and logs it as unrendered", () => {
    // Left in place on purpose: a reader seeing raw markup knows something is
    // missing, where a silently dropped marker reads as complete prose.
    const log: Resolution[] = [];
    const index = buildParamIndex(catalogWithParams([]));
    const out = renderPlaceholders(
      "value is {{ insert: param, nope }}",
      index,
      at,
      log,
    );
    expect(out).toBe("value is {{ insert: param, nope }}");
    expect(log).toEqual([
      {
        controlId: "ac-1",
        partId: "ac-1_smt",
        paramId: "nope",
        resolvedFrom: null,
        rendered: null,
      },
    ]);
  });

  it("records where a parameter declared on another control resolved from", () => {
    const index = buildParamIndex(
      catalogWithParams([{ id: "p1", label: "x" }], "ac-2"),
    );
    const log: Resolution[] = [];
    renderPlaceholders("{{ insert: param, p1 }}", index, at, log);
    expect(log[0]?.resolvedFrom).toBe("ac-2");
  });

  it("leaves resolvedFrom null when the parameter is the control's own", () => {
    const index = buildParamIndex(
      catalogWithParams([{ id: "p1", label: "x" }]),
    );
    const log: Resolution[] = [];
    renderPlaceholders("{{ insert: param, p1 }}", index, at, log);
    expect(log[0]?.resolvedFrom).toBeNull();
  });

  it("logs one entry per marker in the prose", () => {
    const index = buildParamIndex(
      catalogWithParams([
        { id: "p1", label: "one" },
        { id: "p2", label: "two" },
      ]),
    );
    const log: Resolution[] = [];
    renderPlaceholders(
      "{{ insert: param, p1 }} and {{ insert: param, p2 }}",
      index,
      at,
      log,
    );
    expect(log.map((r) => r.paramId)).toEqual(["p1", "p2"]);
  });

  it("tolerates whitespace variation inside the marker", () => {
    const index = buildParamIndex(
      catalogWithParams([{ id: "p1", label: "x" }]),
    );
    expect(renderPlaceholders("{{insert:param,p1}}", index, at, [])).toBe(
      "[Assignment: organization-defined x]",
    );
  });
});
