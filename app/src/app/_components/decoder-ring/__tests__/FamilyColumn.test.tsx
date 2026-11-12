/**
 * Tests for the Bridge layer-cake FamilyColumn visual behavior (filter-aware).
 *
 * When the filter is active, a control that does NOT pass matchesQuery dims in place
 * (opacity-30 grayscale) while the family keeps its height + frozen position; matching
 * controls stay vivid. When the filter is inactive, nothing dims. Every control
 * (matching or dimmed) is a link to its address.
 */
import type { ComponentProps } from "react";
import type * as NextLink from "next/link";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The real Link, with its prefetch prop echoed onto the <a> as data-prefetch: prefetch
// only runs in a production build, so jsdom gives no other way to see it.
vi.mock("next/link", async (importOriginal) => {
  const { createElement } = await import("react");
  const { default: Link } = await importOriginal<typeof NextLink>();
  return {
    default: (props: ComponentProps<typeof Link>) =>
      createElement(Link, {
        ...props,
        "data-prefetch": String(props.prefetch),
      } as ComponentProps<typeof Link>),
  };
});

import FamilyColumn, { ZT_STATES } from "../FamilyColumn";
import type { NistControl, ControlFamily } from "../LayerCakeVisualization";
import type { FilterQuery } from "../filterPredicate";

// The address each chip links to; DecoderRing builds the real one with controlHref.
const hrefFor = (id: string) => `/control/${id}`;

// The empty query: no facet constrains, no search text. matchesQuery is always true.
const EMPTY_QUERY: FilterQuery = {
  pillar: [],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "",
};

// A populated query that selects the IDENTITY pillar AND the text "account".
const IDENTITY_ACCOUNT_QUERY: FilterQuery = {
  pillar: ["IDENTITY"],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "account",
};

function control(overrides: Partial<NistControl> = {}): NistControl {
  return {
    id: "AC-02",
    oscalId: "ac-2",
    name: "Account Management",
    status: "zero-trust-aligned",
    family: "AC",
    pillars: ["IDENTITY"],
    maturities: ["ADVANCED"],
    functions: [],
    ...overrides,
  };
}

function family(controls: NistControl[]): ControlFamily {
  return { id: "AC", name: "Access Control", controls };
}

// A chip's accessible name is its id, then its Zero Trust state ("AC-02, ZT Aligned").
function controlLink(id: string): HTMLElement {
  const escaped = id.replace(/[()]/g, "\\$&");
  return screen.getByRole("link", { name: new RegExp(`^${escaped},`) });
}

describe("FamilyColumn — filter-aware dimming", () => {
  it("dims non-matching controls in place and leaves matches vivid when active", () => {
    const matching = control({
      id: "AC-02",
      name: "Account Management",
      pillars: ["IDENTITY"],
    });
    // Wrong pillar AND wrong name → fails the populated query.
    const nonMatching = control({
      id: "SC-08",
      name: "Transmission Confidentiality",
      pillars: ["DATA"],
    });

    render(
      <FamilyColumn
        family={family([matching, nonMatching])}
        query={IDENTITY_ACCOUNT_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    const matchEl = controlLink("AC-02");
    const dimmedEl = controlLink("SC-08");

    expect(dimmedEl).toHaveClass("opacity-30");
    expect(dimmedEl).toHaveClass("grayscale");
    expect(matchEl).not.toHaveClass("opacity-30");
    expect(matchEl).not.toHaveClass("grayscale");
  });

  it("dims nothing when the filter is inactive, even with a populated query", () => {
    const a = control({ id: "AC-02", pillars: ["IDENTITY"] });
    const b = control({
      id: "SC-08",
      name: "Transmission Confidentiality",
      pillars: ["DATA"],
    });

    render(
      <FamilyColumn
        family={family([a, b])}
        query={IDENTITY_ACCOUNT_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    for (const id of ["AC-02", "SC-08"]) {
      const el = controlLink(id);
      expect(el).not.toHaveClass("opacity-30");
      expect(el).not.toHaveClass("grayscale");
    }
  });

  it("dims nothing when active with the empty query (everything matches)", () => {
    const a = control({ id: "AC-02" });
    const b = control({ id: "AC-03", name: "Access Enforcement" });

    render(
      <FamilyColumn
        family={family([a, b])}
        query={EMPTY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    for (const id of ["AC-02", "AC-03"]) {
      const el = controlLink(id);
      expect(el).not.toHaveClass("opacity-30");
      expect(el).not.toHaveClass("grayscale");
    }
  });

  it("links each chip to its control's address", () => {
    render(
      <FamilyColumn
        family={family([control({ id: "AC-02" }), control({ id: "AC-03" })])}
        query={EMPTY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={(id) => `/control/${id}?pillar=IDENTITY`}
      />,
    );

    expect(controlLink("AC-02")).toHaveAttribute(
      "href",
      "/control/AC-02?pillar=IDENTITY",
    );
    expect(controlLink("AC-03")).toHaveAttribute(
      "href",
      "/control/AC-03?pillar=IDENTITY",
    );
  });

  it("turns prefetch off on every chip", () => {
    // In a production build a chip with prefetch on asks the server for its control as
    // soon as it is on screen, which is several hundred requests when the cake loads.
    render(
      <FamilyColumn
        family={family([control({ id: "AC-02" }), control({ id: "AC-03" })])}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    for (const id of ["AC-02", "AC-03"]) {
      expect(controlLink(id)).toHaveAttribute("data-prefetch", "false");
    }
  });

  it("links a dimmed (non-matching) chip too", () => {
    const nonMatching = control({
      id: "SC-08",
      name: "Transmission Confidentiality",
      pillars: ["DATA"],
    });

    render(
      <FamilyColumn
        family={family([nonMatching])}
        query={IDENTITY_ACCOUNT_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    const el = controlLink("SC-08");
    expect(el).toHaveClass("opacity-30"); // confirm it is the dimmed one
    expect(el).toHaveAttribute("href", "/control/SC-08");
  });

  it("keeps a press-and-drag on a chip for panning, not for dragging the link", () => {
    render(
      <FamilyColumn
        family={family([control({ id: "AC-02" })])}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    const el = controlLink("AC-02");
    expect(el).toHaveAttribute("draggable", "false");
    // Firefox drags a link regardless of draggable; the drag start is cancelled.
    expect(fireEvent.dragStart(el)).toBe(false);
  });

  it("renders the empty-controls placeholder for a family with no controls", () => {
    render(
      <FamilyColumn
        family={family([])}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    expect(screen.getByText("No controls")).toBeInTheDocument();
  });
});

describe("FamilyColumn — family header", () => {
  // The header used to render `name.split(" ")[0]` plus a literal ellipsis, held at
  // opacity-0 until hover. "Incident Response" read as "Incident..." and only on
  // mouseover, which is what made the full name look unavailable.

  it("shows the family code and the complete name together", () => {
    render(
      <FamilyColumn
        family={{ id: "IR", name: "Incident Response", controls: [] }}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    expect(screen.getByText("IR")).toBeInTheDocument();
    expect(screen.getByText("Incident Response")).toBeInTheDocument();
  });

  it("does not abbreviate the longest family name in either catalog", () => {
    // PT is the worst case at 63 characters. If the header
    // ever re-acquires a truncation this is the name that exposes it.
    const longest =
      "Personally Identifiable Information Processing and Transparency";
    render(
      <FamilyColumn
        family={{ id: "PT", name: longest, controls: [] }}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    expect(screen.getByText(longest)).toBeInTheDocument();
  });

  it("renders no ellipsis and no first-word stub", () => {
    render(
      <FamilyColumn
        family={{
          id: "SC",
          name: "System and Communications Protection",
          controls: [],
        }}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    expect(screen.queryByText(/System\.\.\./)).not.toBeInTheDocument();
    expect(screen.queryByText("System...")).not.toBeInTheDocument();
  });

  it("keeps the name visible without hover", () => {
    // The regression this guards is a CSS one: the name was present in the DOM all along
    // and invisible until :hover, so asserting presence alone would have passed against
    // the old markup. Assert the opacity utility is gone from the element's classes.
    const { container } = render(
      <FamilyColumn
        family={{ id: "AU", name: "Audit and Accountability", controls: [] }}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    const label = screen.getByText("Audit and Accountability");
    expect(label.className).not.toMatch(/opacity-0/);
    expect(container.innerHTML).not.toMatch(/group-hover:opacity-100/);
  });
});

describe("FamilyColumn — reflow (collapse to matches)", () => {
  it("removes non-matching controls from the DOM when active + reflow", () => {
    const matching = control({
      id: "AC-02",
      name: "Account Management",
      pillars: ["IDENTITY"],
    });
    const nonMatching = control({
      id: "SC-08",
      name: "Transmission Confidentiality",
      pillars: ["DATA"],
    });

    render(
      <FamilyColumn
        family={family([matching, nonMatching])}
        query={IDENTITY_ACCOUNT_QUERY}
        isActive={true}
        reflow={true}
        hrefFor={hrefFor}
      />,
    );

    // The non-matching control is gone entirely (not merely dimmed).
    expect(
      screen.queryByRole("link", { name: "SC-08" }),
    ).not.toBeInTheDocument();

    // The matching control still renders and is not dimmed.
    const matchEl = controlLink("AC-02");
    expect(matchEl).toBeInTheDocument();
    expect(matchEl).not.toHaveClass("opacity-30");
    expect(matchEl).not.toHaveClass("grayscale");
  });
});

describe("FamilyColumn — chip per ZT alignment state", () => {
  // Each state has its own color token and its own glyph, and the chip's name says it,
  // so the state is never shown by color alone.
  it.each([
    ["zero-trust-aligned", "bg-state-aligned", "●", "AC-02, ZT Aligned"],
    [
      "zt-aligned-with-enhancements",
      "bg-state-aligned-enh",
      "◆",
      "AC-02, ZT Aligned + Enhancements",
    ],
    ["zt-via-enhancements", "bg-state-enh", "▲", "AC-02, ZT Enhancements"],
    ["compliance", "bg-state-none", "○", "AC-02, Not in CISA's mapping"],
  ] as const)(
    "renders %s with %s, the %s glyph, and its state in the name",
    (status, bgClass, glyph, name) => {
      render(
        <FamilyColumn
          family={family([control({ id: "AC-02", status })])}
          query={EMPTY_QUERY}
          isActive={false}
          reflow={false}
          hrefFor={hrefFor}
        />,
      );
      const chip = screen.getByRole("link", { name });
      expect(chip).toHaveClass(bgClass);
      expect(chip).toHaveTextContent(`${glyph}AC-02`);
    },
  );

  it("gives every state a different glyph and color", () => {
    expect(new Set(ZT_STATES.map((s) => s.glyph)).size).toBe(ZT_STATES.length);
    const fills = ZT_STATES.map((s) => /bg-state-[a-z-]+/.exec(s.chip)?.[0]);
    expect(new Set(fills).size).toBe(ZT_STATES.length);
  });
});
