import { describe, expect, it } from "vitest";

import type { Overlay, OverlayTuple } from "../lib/overlay";
import { TUPLES_HEADER, tupleRows, tupleTable } from "../lib/report";

const t = (
  controlId: string,
  pillar: string,
  fn: string,
  maturity: string,
): OverlayTuple => ({
  controlId,
  pillar,
  function: fn,
  maturity,
  cisaRows: [7, 9],
  designations: ["Key", "Supporting"],
  ifApplicable: [false, true],
});

const access = t("AC-02", "IDENTITY", "Access Management", "TRADITIONAL");
const segment = t("AC-02", "NETWORKS", "Traffic Segmentation", "ADVANCED");
const gone = t("SC-07", "NETWORKS", "Traffic Segmentation", "INITIAL");

const overlay: Overlay = {
  mappings: [
    {
      controlId: "AC-02",
      ctrlId: "ctrl_ac-02_r520",
      ztId: "zt_ac-02_r520",
      pillars: ["IDENTITY", "NETWORKS"],
      function: "Access Management",
      maturity: "TRADITIONAL",
      tuples: [access, segment],
    },
  ],
  dropped: [
    {
      drop: {
        ...gone,
        reason: "decided out of scope",
        decidedBy: "owner",
        decidedOn: "2026-10-21",
      },
      was: gone,
    },
  ],
};
const groups = new Set(["IDENTITY|Access Management"]);

describe("tupleTable", () => {
  const rows = tupleTable(overlay, groups);

  it("lists every kept and dropped tuple, by control", () => {
    expect(rows.map((r) => [r.tuple.controlId, r.outcome])).toEqual([
      ["AC-02", "kept"],
      ["AC-02", "kept"],
      ["SC-07", "dropped"],
    ]);
    expect(rows[2]!.dropReason).toBe("decided out of scope");
  });

  it("marks the representative and whether each tuple resolves", () => {
    expect(rows.map((r) => [r.representative, r.resolves])).toEqual([
      [true, true],
      [false, false],
      [false, false],
    ]);
  });
});

describe("tupleRows", () => {
  it("writes one CSV row per tuple, in the header's order", () => {
    const [first] = tupleRows(overlay, groups);
    expect(first).toHaveLength(TUPLES_HEADER.length);
    expect(first).toEqual([
      "AC-02",
      "IDENTITY",
      "Access Management",
      "TRADITIONAL",
      "kept",
      "yes",
      "resolves",
      "7;9",
      "Key;Supporting",
      "no;yes",
      "",
    ]);
  });
});
