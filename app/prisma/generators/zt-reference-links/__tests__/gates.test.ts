import { describe, expect, it } from "vitest";
import { assertExpectations } from "../../catalog/expectations.js";
import type { LiveResultRow } from "../../reference-links/lib/live-results.js";
import {
  resolveReferences,
  seedRows,
  type OverrideRow,
} from "../../reference-links/lib/resolve.js";
import { ztReferenceExpectations, ZT_FLOORS } from "../lib/gates.js";
import {
  parseSources,
  SOURCES_HEADER,
  sourceIssues,
  toReferences,
  toResources,
} from "../lib/sources.js";

const PDF = "https://www.cisa.gov/files/ztmm.pdf";
const PAGE = "https://www.cisa.gov/zero-trust-maturity-model";
const LIVE = new Set(["AC-02", "IA-02"]);
const table = [
  SOURCES_HEADER.join(","),
  `AC-02,${PDF},Model,Cite.,1`,
  `AC-02,${PAGE},Page,,2`,
  `IA-02,${PDF},Model,Cite.,1`,
].join("\n");

function live(
  url: string,
  linkClass: LiveResultRow["linkClass"] = "reachable",
  status = 200,
): LiveResultRow {
  return {
    url,
    status,
    finalUrl: url,
    contentType: url.endsWith(".pdf") ? "application/pdf" : "text/html",
    linkClass,
    error: null,
    checkedOn: "2026-09-30",
  };
}

function gatesFor(opts: {
  liveRows?: LiveResultRow[];
  overrides?: OverrideRow[];
  text?: string;
  floors?: { rows: number; controls: number };
}) {
  const rows = parseSources(opts.text ?? table);
  const resources = toResources(rows);
  const references = toReferences(rows);
  const liveRows = opts.liveRows ?? [live(PDF), live(PAGE)];
  const overrides = opts.overrides ?? [];
  const resolved = resolveReferences(
    resources,
    references,
    liveRows,
    overrides,
  );
  return ztReferenceExpectations({
    rows,
    resources,
    references,
    issues: sourceIssues(rows, LIVE),
    resolved,
    overrides,
    liveRows,
    seeded: seedRows(resolved, references),
    floors: opts.floors ?? { rows: 3, controls: 2 },
  });
}

const failing = (gates: ReturnType<typeof gatesFor>) =>
  gates
    .filter(
      (g) =>
        g.actual < g.floor || (g.ceiling !== undefined && g.actual > g.ceiling),
    )
    .map((g) => g.name);

describe("ztReferenceExpectations", () => {
  it("passes a well-authored, fully probed table", () => {
    const gates = gatesFor({});
    expect(failing(gates)).toEqual([]);
    expect(() => assertExpectations("zt reference links", gates)).not.toThrow();
  });

  it("declares its floors at the current authoring", () => {
    expect(ZT_FLOORS.rows).toBeGreaterThan(0);
    expect(ZT_FLOORS.controls).toBeGreaterThan(0);
  });

  it("fails when an authored URL has no live result, and says to run the retrieval", () => {
    const gates = gatesFor({ liveRows: [live(PDF)] });
    expect(failing(gates)).toContain("authored URLs without a live result");
    expect(
      gates.find((g) => g.name === "authored URLs without a live result")
        ?.because,
    ).toMatch(/make zt-reference-links-retrieve/);
  });

  it("fails when a document is gone rather than holding it out", () => {
    const gates = gatesFor({ liveRows: [live(PDF), live(PAGE, "gone", 404)] });
    expect(failing(gates)).toEqual(
      expect.arrayContaining([
        "documents not seeded",
        "seeded reference links",
      ]),
    );
  });

  it("fails on a stale override and on a dead replacement", () => {
    const gates = gatesFor({
      overrides: [
        {
          sourceUrl: "https://www.cisa.gov/never-authored",
          replacementUrl: "https://www.cisa.gov/new",
          reason: "moved",
          verifiedOn: "2026-09-30",
        },
      ],
      liveRows: [
        live(PDF),
        live(PAGE),
        live("https://www.cisa.gov/new", "gone", 404),
      ],
    });
    expect(failing(gates)).toEqual(
      expect.arrayContaining([
        "overrides whose source is not an authored URL",
        "override replacements gone or unreachable",
      ]),
    );
  });

  it("fails when two authored documents resolve to one seeded URL, and passes when the anchor is kept", () => {
    // Both page anchors of one PDF redirect to a new path. The resolver carries
    // each anchor onto the target, so the two stay two; a resolver that did not
    // would collapse them, and this gate is what would notice.
    const anchored = [
      SOURCES_HEADER.join(","),
      `AC-02,${PDF}#page=14,Model,,1`,
      `AC-02,${PDF}#page=27,Model,,2`,
    ].join("\n");
    const moved = "https://www.cisa.gov/files/ztmm-v2.pdf";
    const kept = gatesFor({
      text: anchored,
      liveRows: [
        live(`${PDF}#page=14`, "reachable", 200),
        live(`${PDF}#page=27`, "reachable", 200),
      ].map((l) => ({ ...l, finalUrl: moved })),
      floors: { rows: 2, controls: 1 },
    });
    expect(failing(kept)).toEqual([]);
    expect(
      kept.find(
        (g) => g.name === "authored documents resolving to one seeded URL",
      )!.actual,
    ).toBe(0);
    // Simulate the collapse by seeding both at the bare target.
    const rows = parseSources(anchored);
    const resources = toResources(rows);
    const references = toReferences(rows);
    const collapsed = ztReferenceExpectations({
      rows,
      resources,
      references,
      issues: sourceIssues(rows, LIVE),
      resolved: [],
      overrides: [],
      liveRows: [live(`${PDF}#page=14`), live(`${PDF}#page=27`)],
      seeded: references.map((ref) => ({
        controlNumber: ref.controlNumber,
        resourceUuid: ref.resourceUuid,
        title: "Model",
        url: moved,
        description: null,
        resolvedUrl: moved,
        contentType: null,
        displayOrder: ref.order,
      })),
      floors: { rows: 2, controls: 1 },
    });
    expect(failing(collapsed)).toContain(
      "authored documents resolving to one seeded URL",
    );
  });

  it("fails on a control the catalog does not carry", () => {
    const gates = gatesFor({
      text: [SOURCES_HEADER.join(","), `ZZ-99,${PDF},Model,,1`].join("\n"),
      floors: { rows: 1, controls: 1 },
    });
    expect(failing(gates)).toContain(
      "rows naming a control not live in the catalog",
    );
  });
});
