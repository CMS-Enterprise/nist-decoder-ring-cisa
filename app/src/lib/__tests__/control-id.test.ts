import { describe, expect, it } from "vitest";
import {
  baseControlId,
  controlNumberToOscalId,
  isControlId,
  normalizeControlId,
  oscalIdToControlNumber,
  splitControlId,
} from "../control-id";

describe("oscalIdToControlNumber", () => {
  it.each([
    ["ac-2", "AC-02"],
    ["ac-17.1", "AC-17(01)"],
    ["sa-8.14", "SA-08(14)"],
    ["pm-12", "PM-12"],
    [" AU-2 ", "AU-02"],
  ])("%s → %s", (id, number) => {
    expect(oscalIdToControlNumber(id)).toBe(number);
  });

  it("returns null for a family, a resource or junk", () => {
    expect(oscalIdToControlNumber("pe")).toBeNull();
    expect(
      oscalIdToControlNumber("2956e175-3eb3-4a5a-95bb-4d7c1b2a9f00"),
    ).toBeNull();
    expect(oscalIdToControlNumber("ac-2_smt.a")).toBeNull();
  });
});

describe("controlNumberToOscalId", () => {
  it.each([
    ["AC-02", "ac-2"],
    ["AC-17(01)", "ac-17.1"],
    ["AC-02(10)", "ac-2.10"],
    ["PM-12", "pm-12"],
    [" sa-08(14) ", "sa-8.14"],
  ])("%s → %s", (number, id) => {
    expect(controlNumberToOscalId(number)).toBe(id);
  });

  it("returns null for a family code or junk", () => {
    expect(controlNumberToOscalId("SR")).toBeNull();
    expect(controlNumberToOscalId("AC-02a")).toBeNull();
    expect(controlNumberToOscalId("ac-2.1")).toBeNull();
  });

  it("is the inverse of oscalIdToControlNumber", () => {
    for (const id of ["ac-2", "ac-17.1", "sa-8.14", "si-2.7"]) {
      expect(controlNumberToOscalId(oscalIdToControlNumber(id)!)).toBe(id);
    }
  });
});

describe("isControlId and baseControlId", () => {
  it("tells controls from other anchors and finds the base", () => {
    expect(isControlId("ac-3")).toBe(true);
    expect(isControlId("ac-17.1")).toBe(true);
    expect(isControlId("pe")).toBe(false);
    expect(baseControlId("ac-17.1")).toBe("ac-17");
    expect(baseControlId("ac-17")).toBe("ac-17");
  });
});

describe("normalizeControlId", () => {
  it("resolves the spellings people type to the stored base form", () => {
    for (const typed of ["AC-02", "ac-2", "AC2", "ac 2", " Ac-02 ", "ac-002"])
      expect(normalizeControlId(typed)).toBe("AC-02");
  });

  it("resolves enhancement spellings, the OSCAL dot form included", () => {
    for (const typed of [
      "AC-02(01)",
      "ac-2(1)",
      "ac 2 (1)",
      "AC-2.1",
      "ac-2.01",
      "ac-02-1",
    ])
      expect(normalizeControlId(typed)).toBe("AC-02(01)");
  });

  it("keeps two-digit numbers", () => {
    expect(normalizeControlId("pm-32")).toBe("PM-32");
    expect(normalizeControlId("si-4.24")).toBe("SI-04(24)");
  });

  it("returns null for anything that is not a control ID", () => {
    for (const junk of [
      "",
      "   ",
      "AC",
      "A-02",
      "ACX-02",
      "AC-123",
      "AC-02(123)",
      "Your session has expired, call 555-0100",
      "<script>alert(1)</script>",
      "../../etc/passwd",
      "AC-02?enh=01",
      "a".repeat(500),
    ])
      expect(normalizeControlId(junk)).toBeNull();
  });

  it("rejects a path-length input without running the pattern over it", () => {
    // Uncapped, the pattern backtracks quadratically through a run of spaces: about two
    // seconds for this one. The cap turns it away before the pattern starts.
    const long = `AC-2${" ".repeat(60_000)}x`;
    const start = performance.now();
    expect(normalizeControlId(long)).toBeNull();
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("splitControlId", () => {
  it("splits an enhancement into its base and number", () => {
    expect(splitControlId("AC-02(01)")).toEqual({
      base: "AC-02",
      enhancement: "01",
    });
  });

  it("leaves a base ID whole", () => {
    expect(splitControlId("AC-02")).toEqual({
      base: "AC-02",
      enhancement: null,
    });
  });
});
