import { describe, expect, it } from "vitest";
import { product, STANDARD } from "../product";
import { CATALOG_VOCABULARY } from "../catalog-vocabulary";

describe("the product", () => {
  it("is Standard, and only Standard, on this line", () => {
    // There is no second product to select: one line, one product, no env var.
    expect(product).toBe(STANDARD);
  });

  it("carries no catalog vocabulary in any slot", () => {
    // The point of this file: a public product other agencies build on ships none.
    const values: string[] = Object.values(product).flatMap(
      (v: string | Record<string, string>) =>
        typeof v === "string" ? [v] : Object.values(v),
    );
    for (const v of values) {
      expect(v).not.toMatch(CATALOG_VOCABULARY);
    }
  });

  it("says a control the mapping leaves out is not in CISA's mapping, and gives no reason", () => {
    // Standard takes in what CISA publishes and writes no mapping of its own, so the copy
    // names the source and claims nothing the source does not say.
    expect(product.baselineChipLabel).toBe("Not in CISA's mapping");
    expect(product.ztUnmappedMessage).toBe(
      "CISA's Zero Trust control mapping does not map this control.",
    );
    for (const v of [product.baselineChipLabel, product.ztUnmappedMessage]) {
      expect(v).not.toMatch(/procedural|not yet/i);
    }
  });

  it("fills every slot", () => {
    // A missing slot renders the literal "undefined" on the page rather than failing.
    const entries = Object.entries(product) as Array<
      [string, string | Record<string, string>]
    >;
    for (const [k, v] of entries) {
      expect(v, `${k} is empty`).toBeTruthy();
      if (typeof v !== "string") {
        for (const [kk, vv] of Object.entries(v)) {
          expect(vv, `${k}.${kk} is empty`).toBeTruthy();
        }
      }
    }
  });
});
