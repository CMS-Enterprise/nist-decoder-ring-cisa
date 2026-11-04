/**
 * Tests for the two gates that run before anything is written.
 *
 * The point of these is narrow: prove the failure path fires. A gate nobody has
 * watched fail is indistinguishable from one that passes everything, and this
 * pipeline exists partly because that exact thing happened — a generator that
 * produced nothing and exited 0.
 */

import { describe, expect, it } from "vitest";

import {
  assertExpectations,
  ExpectationError,
  formatExpectations,
  type Expectation,
} from "../expectations.js";
import { integrityExpectations, measureIntegrity } from "../integrity.js";
import type { ParsedControl, ParsedPart } from "../types.js";

const ok = (over: Partial<Expectation> = {}): Expectation => ({
  name: "live controls",
  actual: 1014,
  floor: 1000,
  ...over,
});

function makeControl(overrides: Partial<ParsedControl> = {}): ParsedControl {
  return {
    controlNumber: "AC-01",
    controlName: "Policy",
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
  oscalPartId: string,
  children: ParsedPart[] = [],
): ParsedPart {
  return {
    oscalPartId,
    name: "item",
    label: "a.",
    prose: null,
    sortOrder: 0,
    children,
  };
}

// ---------------------------------------------------------------------------

describe("assertExpectations", () => {
  it("passes when every count clears its floor", () => {
    expect(() => assertExpectations("nist", [ok()])).not.toThrow();
  });

  it("throws on the collapse to zero this gate exists for", () => {
    expect(() =>
      assertExpectations("nist", [ok({ actual: 0, floor: 1 })]),
    ).toThrow(ExpectationError);
  });

  it("throws on partial loss, not only on empty", () => {
    // A floor of 1 would pass 2 controls out of 1,014 as readily as 1,014.
    expect(() => assertExpectations("nist", [ok({ actual: 500 })])).toThrow(
      /got 500, expected at least 1000/,
    );
  });

  it("names every failure rather than only the first", () => {
    try {
      assertExpectations("nist", [
        ok({ name: "families", actual: 0, floor: 20 }),
        ok({ name: "live controls", actual: 3 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExpectationError);
      const e = err as ExpectationError;
      expect(e.failures).toHaveLength(2);
      expect(e.message).toContain("families");
      expect(e.message).toContain("live controls");
    }
  });

  it("says nothing was written, because that is the recovery the reader needs", () => {
    expect(() =>
      assertExpectations("nist", [ok({ actual: 0, floor: 1 })]),
    ).toThrow(/Nothing was written/);
  });

  it("refuses a zero floor that does not say why", () => {
    // A zero floor accepts an empty result, so it has to state why that is correct.
    expect(() =>
      assertExpectations("nist", [ok({ actual: 0, floor: 0 })]),
    ).toThrow(/no reason/);
  });

  it("refuses a whitespace-only justification", () => {
    expect(() =>
      assertExpectations("nist", [ok({ actual: 0, floor: 0, because: "   " })]),
    ).toThrow(/no reason/);
  });

  it("permits a justified zero floor", () => {
    expect(() =>
      assertExpectations("nist", [
        ok({ actual: 0, floor: 0, because: "the catalog assigns no values" }),
      ]),
    ).not.toThrow();
  });

  it.each([[NaN], [Infinity]])(
    "refuses a non-finite count, which would otherwise clear every bound (%s)",
    (actual) => {
      expect(() => assertExpectations("nist", [ok({ actual })])).toThrow(
        ExpectationError,
      );
    },
  );

  it("refuses a ceiling below its floor, which no value can satisfy", () => {
    expect(() =>
      assertExpectations("nist", [ok({ floor: 100, ceiling: 10 })]),
    ).toThrow(/unsatisfiable/);
  });

  it("enforces a ceiling, for counts whose failure is growth rather than collapse", () => {
    // The withdrawn count is the real case: its failure mode is the skip growing.
    const withCeiling = (actual: number) =>
      assertExpectations("nist", [
        {
          name: "withdrawn",
          actual,
          floor: 0,
          ceiling: 190,
          because: "held out of the seed",
        },
      ]);
    expect(() => withCeiling(182)).not.toThrow();
    expect(() => withCeiling(400)).toThrow(/between 0 and 190/);
  });
});

describe("formatExpectations", () => {
  it("renders passing and failing alike, so a reader sees what was checked", () => {
    const out = formatExpectations("nist", [
      ok(),
      ok({
        name: "withdrawn",
        actual: 182,
        floor: 0,
        ceiling: 190,
        because: "x",
      }),
    ]);
    expect(out).toContain("[nist]");
    expect(out).toContain("live controls");
    expect(out).toContain("1014");
    expect(out).toContain("floor 1000");
    expect(out).toContain("ceiling 190");
  });
});

// ---------------------------------------------------------------------------

describe("measureIntegrity", () => {
  it("finds nothing wrong with a well-formed set", () => {
    const m = measureIntegrity([
      makeControl(),
      makeControl({ controlNumber: "AC-02", oscalId: "ac-2" }),
    ]);
    expect(m.duplicateControlNumbers).toEqual([]);
    expect(m.unresolvedParents).toEqual([]);
    expect(m.duplicatePartIds).toEqual([]);
  });

  it("catches two rows claiming one control number", () => {
    // Would violate the (controlNumber, catalog) unique key at insert time.
    const m = measureIntegrity([
      makeControl({ oscalId: "ac-1" }),
      makeControl({ oscalId: "ac-1-again" }),
    ]);
    expect(m.duplicateControlNumbers).toEqual(["AC-01"]);
  });

  it("catches an enhancement whose parent is not being written", () => {
    // Would get a null parent and drop out of the hierarchy silently.
    const m = measureIntegrity([
      makeControl({
        controlNumber: "AC-02(01)",
        oscalId: "ac-2.1",
        parentOscalId: "ac-2",
      }),
    ]);
    expect(m.unresolvedParents).toEqual(["AC-02(01)"]);
  });

  it("catches a part id emitted twice, including across controls and depths", () => {
    const m = measureIntegrity([
      makeControl({ statementParts: [makePart("dupe", [makePart("nested")])] }),
      makeControl({
        controlNumber: "AC-02",
        oscalId: "ac-2",
        statementParts: [makePart("dupe")],
      }),
    ]);
    expect(m.duplicatePartIds).toEqual(["dupe"]);
  });

  it("counts controls with no statement without treating it as a fault", () => {
    expect(measureIntegrity([makeControl()]).controlsWithoutStatement).toBe(1);
  });
});

describe("integrityExpectations", () => {
  it("gates each invariant at exactly zero", () => {
    const exps = integrityExpectations(measureIntegrity([makeControl()]));
    expect(exps).toHaveLength(3);
    for (const e of exps) {
      expect(e.floor).toBe(0);
      expect(e.ceiling).toBe(0);
      expect(e.because?.trim()).toBeTruthy();
    }
    expect(() => assertExpectations("integrity", exps)).not.toThrow();
  });

  it("names the offenders, because a count sends you looking and a name does not", () => {
    const m = measureIntegrity([
      makeControl({ oscalId: "a" }),
      makeControl({ oscalId: "b" }),
    ]);
    const exps = integrityExpectations(m);
    expect(exps[0]?.because).toContain("AC-01");
    expect(() => assertExpectations("integrity", exps)).toThrow(
      ExpectationError,
    );
  });
});
