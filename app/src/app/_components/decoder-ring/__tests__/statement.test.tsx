/**
 * The renderer with no slots filled.
 *
 * This is the product boundary seen from the other side: what a catalog that supplies
 * nothing actually gets. The interesting case is the baseline badge, where "supply
 * nothing" must not mean "render nothing" — the data says which baseline a value belongs
 * to, so dropping it would put a value on screen with its baseline invisible, which is
 * the same pixels as a rendering bug.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StructuredStatement, type PartNode } from "../statement";

function paramPart(baselines: string[]): PartNode {
  return {
    id: "p1",
    oscalPartId: "ac-2_smt.e",
    label: "e",
    name: "item",
    prose: "Assignment: [organization-defined time period].",
    sortOrder: 0,
    ztCovered: false,
    parameters: [
      {
        id: "param-1",
        label: "AC-02e.",
        position: 0,
        values: [{ baselines, value: "30 days" }],
      },
    ],
    children: [],
  };
}

describe("StructuredStatement with no product slots", () => {
  it("still says which baseline a value belongs to, in one canonical spelling", () => {
    // Filling no slot must not mean rendering nothing — the data says which baseline a
    // value belongs to. It also must not mean rendering whichever spelling the column
    // happened to use: a parameter carries the enum ("LOW") and a control's own array
    // carries the catalog's text ("Low"), and both reach this renderer.
    render(<StructuredStatement parts={[paramPart(["LOW", "MODERATE"])]} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.queryByText("LOW")).not.toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });

  it("canonicalises both spellings of the same baseline to one", () => {
    // The bug this pins: rendered verbatim, a control carrying a control-level "Low" and
    // a parameter-level "LOW" showed two spellings of one concept in a single pane.
    render(<StructuredStatement parts={[paramPart(["LOW"])]} />);
    const enumSpelling = screen.getAllByText("Low");
    render(<StructuredStatement parts={[paramPart(["Low"])]} />);
    expect(screen.getAllByText("Low").length).toBeGreaterThan(
      enumSpelling.length,
    );
  });

  it("carries no product's abbreviations", () => {
    render(
      <StructuredStatement
        parts={[paramPart(["LOW", "MODERATE", "HIGH", "PRIVACY"])]}
      />,
    );
    // One-letter badges are one catalog's convention and must not appear unless supplied.
    for (const abbrev of ["L", "M", "H", "P"]) {
      expect(screen.queryByText(abbrev)).not.toBeInTheDocument();
    }
  });

  it("renders an unknown token rather than dropping it", () => {
    // A catalog with levels nobody has taught the UI about still renders honestly.
    render(<StructuredStatement parts={[paramPart(["QUANTUM"])]} />);
    expect(screen.getByText("QUANTUM")).toBeInTheDocument();
  });

  it("treats prose as undecorated, so a single line stays a bare span", () => {
    const part: PartNode = {
      id: "p2",
      oscalPartId: "ac-1_smt.a",
      label: "a",
      name: "item",
      prose: "A single line of prose.",
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [],
    };
    render(<StructuredStatement parts={[part]} />);
    // The decorated path wraps prose in <p> inside a ProseBlock; the simple path is a
    // bare <span>. Asserting the tag is what distinguishes the two.
    expect(screen.getByText("A single line of prose.").tagName).toBe("SPAN");
  });

  it("punctuates a part marker through the catalog-aware helper, not a hard-coded period", () => {
    // `part-label.test.ts` covers the helper; this covers the wiring, which is the half
    // that broke. A renderer appending "." itself reads another catalog's bare "a" correctly and turns
    // NIST's already-punctuated "a." into "a..", and no assertion anywhere caught that
    // until this one — the helper's own suite passes whether the renderer calls it or not.
    const labelled = (label: string): PartNode => ({
      id: `p-${label}`,
      oscalPartId: `ac-1_smt.${label}`,
      label,
      name: "item",
      prose: `Prose for ${label}.`,
      sortOrder: 0,
      ztCovered: false,
      parameters: [],
      children: [],
    });
    render(
      <StructuredStatement
        parts={[labelled("a"), labelled("b."), labelled("(c)")]}
      />,
    );
    expect(screen.getByText("a.")).toBeInTheDocument();
    expect(screen.getByText("b.")).toBeInTheDocument();
    expect(screen.getByText("(c)")).toBeInTheDocument();
    expect(screen.queryByText("b..")).not.toBeInTheDocument();
    expect(screen.queryByText("(c).")).not.toBeInTheDocument();
  });
});
