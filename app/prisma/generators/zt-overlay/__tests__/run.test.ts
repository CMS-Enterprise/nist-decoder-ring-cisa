import { describe, expect, it, vi } from "vitest";

import { controlsDroppedWhole, runGenerator } from "../lib/run";

// A buildOverlay that loses one control the drop list does not account for, switched on
// for the one test that needs it: the defect the mapped-controls floor exists to stop.
const loseOne = vi.hoisted(() => ({ on: false }));
vi.mock("../lib/overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/overlay")>();
  return {
    ...actual,
    buildOverlay: (...args: Parameters<typeof actual.buildOverlay>) => {
      const overlay = actual.buildOverlay(...args);
      return loseOne.on
        ? { ...overlay, mappings: overlay.mappings.slice(1) }
        : overlay;
    },
  };
});

const t = (controlId: string, fn: string, maturity = "TRADITIONAL") => ({
  controlId,
  pillar: "IDENTITY",
  function: fn,
  maturity,
});

describe("controlsDroppedWhole", () => {
  const cisa = [
    t("AC-02", "Access Management"),
    t("AC-02", "Access Management", "INITIAL"),
    t("SC-07", "Traffic Segmentation"),
  ];

  it("counts a control only when every tuple CISA gives it is dropped", () => {
    expect(controlsDroppedWhole(cisa, [])).toBe(0);
    expect(controlsDroppedWhole(cisa, [t("AC-02", "Access Management")])).toBe(
      0,
    );
    expect(
      controlsDroppedWhole(cisa, [
        t("AC-02", "Access Management"),
        t("AC-02", "Access Management", "INITIAL"),
      ]),
    ).toBe(1);
  });
});

describe("runGenerator's mapped-controls floor", () => {
  it("passes the committed inputs", () => {
    expect(() => runGenerator()).not.toThrow();
  });

  it("stops a run whose output loses a control the drop list does not account for", () => {
    loseOne.on = true;
    try {
      expect(() => runGenerator()).toThrow(
        /mapped controls: got \d+, expected at least \d+/,
      );
    } finally {
      loseOne.on = false;
    }
  });
});
