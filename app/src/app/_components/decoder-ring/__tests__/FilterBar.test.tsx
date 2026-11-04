/**
 * Tests for the Bridge FilterBar (the facet dropdowns + active-filter chips + reflow
 * toggle). FilterBar reads/writes the URL-backed filter state via useDecoderQuery, so
 * every render is wrapped in withNuqsTestingAdapter — the same pattern as
 * useDecoderQuery.test.tsx. State-updating interactions go through act() because nuqs
 * commits URL writes asynchronously, and the onUrlUpdate spy reports the resulting
 * query string.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";

import FilterBar from "../FilterBar";
import { product } from "~/config/product";

const FAMILIES = [
  { id: "AC", name: "Access Control" },
  { id: "AU", name: "Audit and Accountability" },
];

// Render FilterBar inside the nuqs testing adapter, returning the onUrlUpdate spy so a
// test can assert what got written to the URL. onClear is the parent-supplied "Clear
// all" handler (the bar no longer clears state itself — see DecoderRing).
function renderFilterBar(
  props: {
    reflow?: boolean;
    onToggleReflow?: () => void;
    onClear?: () => void;
    searchParams?: string;
  } = {},
) {
  const {
    reflow = false,
    onToggleReflow = vi.fn(),
    onClear = vi.fn(),
    searchParams = "",
  } = props;
  const onUrlUpdate = vi.fn();
  const utils = render(
    <FilterBar
      families={FAMILIES}
      reflow={reflow}
      onToggleReflow={onToggleReflow}
      onClear={onClear}
    />,
    { wrapper: withNuqsTestingAdapter({ searchParams, onUrlUpdate }) },
  );
  return { ...utils, onUrlUpdate, onToggleReflow, onClear };
}

// The facet dropdowns are <details> elements whose <summary> shows the facet label.
// Return the disclosure container so option checkboxes can be queried within it.
function facetSection(label: string): HTMLElement {
  const summary = screen.getByText(label);
  return summary.closest("details") as HTMLElement;
}

function lastQueryString(onUrlUpdate: ReturnType<typeof vi.fn>): string {
  const event = onUrlUpdate.mock.calls.at(-1)?.[0] as
    UrlUpdateEvent | undefined;
  return event?.queryString ?? "";
}

// nuqs commits URL writes through a throttled queue, so a click must be wrapped in act
// and given a macrotask tick for the queue to flush before the spy is asserted.
async function clickAndFlush(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("FilterBar — without a diagram", () => {
  it("offers no collapse toggle when it is not given one", () => {
    render(<FilterBar families={FAMILIES} onClear={vi.fn()} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?family=AC" }),
    });
    expect(screen.getByText("Clear all")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse to matches" }),
    ).toBeNull();
  });
});

describe("FilterBar — facet dropdowns", () => {
  it("renders all six facet dropdowns", () => {
    renderFilterBar();
    for (const label of [
      "Pillar",
      "Maturity",
      "ZT Designation",
      "Baseline",
      "Status",
      "Family",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("gives every facet the same shape: its options and nothing under them", () => {
    renderFilterBar();
    for (const label of [
      "Pillar",
      "Maturity",
      "ZT Designation",
      "Baseline",
      "Status",
      "Family",
    ]) {
      const panel = facetSection(label).querySelector("summary")!
        .nextElementSibling as HTMLElement;
      for (const child of Array.from(panel.children)) {
        expect(child.tagName).toBe("LABEL");
      }
    }
  });

  it("says on the Baseline button how a control matches, and nothing on the others", () => {
    renderFilterBar();
    const summaryOf = (label: string) =>
      facetSection(label).querySelector("summary")!;
    expect(summaryOf("Baseline").getAttribute("title")).toBe(
      product.baselineFacetHint,
    );
    for (const label of [
      "Pillar",
      "Maturity",
      "ZT Designation",
      "Status",
      "Family",
    ]) {
      expect(summaryOf(label).hasAttribute("title")).toBe(false);
    }
  });

  it("sizes each open panel to its own button, so open panels sit side by side", () => {
    renderFilterBar();
    for (const label of [
      "Pillar",
      "Maturity",
      "ZT Designation",
      "Baseline",
      "Status",
      "Family",
    ]) {
      const details = facetSection(label);
      expect(details.className).toMatch(/\bw-\d+\b/);
      const panel = details.querySelector("summary")!
        .nextElementSibling as HTMLElement;
      expect(panel.className).toContain("inset-x-0");
      expect(panel.className).not.toMatch(/\bw-\d+\b/);
    }
  });

  it("renders pillar option checkboxes", () => {
    renderFilterBar();
    const pillar = facetSection("Pillar");
    // The pillar facet exposes a checkbox per pillar CISA's mapping uses (5 of
    // them); no standalone Cross-Cutting option.
    expect(within(pillar).getByLabelText("Identity")).toBeInTheDocument();
    expect(within(pillar).getByLabelText("Data")).toBeInTheDocument();
    expect(within(pillar).queryByLabelText("Cross-Cutting")).toBeNull();
    expect(within(pillar).getAllByRole("checkbox")).toHaveLength(5);
  });

  it("renders maturity option checkboxes", () => {
    renderFilterBar();
    const maturity = facetSection("Maturity");
    expect(within(maturity).getByLabelText("Advanced")).toBeInTheDocument();
    expect(within(maturity).getAllByRole("checkbox")).toHaveLength(4);
  });

  it("offers CISA's three designations, writing them to the URL", async () => {
    const { onUrlUpdate } = renderFilterBar();
    const designation = facetSection("ZT Designation");
    expect(within(designation).getAllByRole("checkbox")).toHaveLength(3);
    expect(
      within(designation).getByLabelText("Supporting"),
    ).toBeInTheDocument();
    await clickAndFlush(within(designation).getByLabelText("Key"));
    await clickAndFlush(within(designation).getByLabelText("Informative"));
    expect(decodeURIComponent(lastQueryString(onUrlUpdate))).toContain(
      "designation=KEY,INFORMATIVE",
    );
  });

  it("offers each catalog baseline and 'In no baseline', writing them to the URL", async () => {
    const { onUrlUpdate } = renderFilterBar();
    const baseline = facetSection("Baseline");
    expect(within(baseline).getAllByRole("checkbox")).toHaveLength(5);
    expect(within(baseline).getByLabelText("Privacy")).toBeInTheDocument();
    await clickAndFlush(within(baseline).getByLabelText("Moderate"));
    expect(lastQueryString(onUrlUpdate)).toContain("baseline=MODERATE");
    await clickAndFlush(within(baseline).getByLabelText("In no baseline"));
    expect(decodeURIComponent(lastQueryString(onUrlUpdate))).toContain(
      "baseline=MODERATE,NONE",
    );
  });

  it("renders status option checkboxes", () => {
    renderFilterBar();
    const status = facetSection("Status");
    expect(within(status).getByLabelText("ZT Aligned")).toBeInTheDocument();
    expect(
      within(status).getByLabelText("ZT Aligned + Enhancements"),
    ).toBeInTheDocument();
    expect(within(status).getAllByRole("checkbox")).toHaveLength(4);
  });

  it("lists the passed families by name in the Family dropdown", () => {
    renderFilterBar();
    const familyFacet = facetSection("Family");
    expect(
      within(familyFacet).getByLabelText("Access Control"),
    ).toBeInTheDocument();
    expect(
      within(familyFacet).getByLabelText("Audit and Accountability"),
    ).toBeInTheDocument();
    expect(within(familyFacet).getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("FilterBar — toggling a facet writes to the URL", () => {
  it("writes the pillar value when its checkbox is toggled", async () => {
    const { onUrlUpdate } = renderFilterBar();
    const pillar = facetSection("Pillar");
    await clickAndFlush(within(pillar).getByLabelText("Identity"));
    expect(onUrlUpdate).toHaveBeenCalled();
    expect(lastQueryString(onUrlUpdate)).toContain("pillar=IDENTITY");
  });

  it("writes the selected family code when its checkbox is toggled", async () => {
    const { onUrlUpdate } = renderFilterBar();
    const familyFacet = facetSection("Family");
    await clickAndFlush(within(familyFacet).getByLabelText("Access Control"));
    expect(lastQueryString(onUrlUpdate)).toContain("family=AC");
  });
});

describe("FilterBar — active filter state", () => {
  it("renders chips, Clear all, and the reflow button when a filter is active", () => {
    renderFilterBar({ searchParams: "?pillar=IDENTITY" });

    // Active-filter chip for the selected pillar (uses the display label).
    expect(
      screen.getByRole("button", { name: /Identity/ }),
    ).toBeInTheDocument();
    // Clear all control.
    expect(
      screen.getByRole("button", { name: "Clear all" }),
    ).toBeInTheDocument();
    // Reflow toggle, labeled for the OFF state.
    expect(
      screen.getByRole("button", { name: "Collapse to matches" }),
    ).toBeInTheDocument();
  });

  it("names each chip's facet, so a status and a baseline never read as one list", () => {
    renderFilterBar({ searchParams: "?status=compliance&baseline=NONE" });
    expect(
      screen.getByRole("button", {
        name: `Status: ${product.baselineChipLabel}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${product.baselineFacetLabel}: ${product.baselineFacetNone}`,
      }),
    ).toBeInTheDocument();
  });

  it("labels the reflow button 'Show all' when reflow is on", () => {
    renderFilterBar({ searchParams: "?pillar=IDENTITY", reflow: true });
    expect(
      screen.getByRole("button", { name: "Show all" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse to matches" }),
    ).not.toBeInTheDocument();
  });

  it("calls onToggleReflow when the reflow button is clicked", () => {
    const onToggleReflow = vi.fn();
    renderFilterBar({ searchParams: "?pillar=IDENTITY", onToggleReflow });
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse to matches" }),
    );
    expect(onToggleReflow).toHaveBeenCalledTimes(1);
  });

  it("calls the onClear prop when Clear all is clicked", () => {
    // "Clear all" no longer clears the URL itself — it delegates to the parent's
    // onClear, which clears the URL AND resets the reflow view (see DecoderRing).
    const onClear = vi.fn();
    renderFilterBar({ searchParams: "?pillar=IDENTITY&q=account", onClear });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("FilterBar — search-term chip", () => {
  it("renders the active q term as a clickable chip", () => {
    renderFilterBar({ searchParams: "?q=foo" });
    // The chip shows the quoted term and is dismissable (a <button>).
    expect(screen.getByRole("button", { name: /foo/ })).toBeInTheDocument();
  });

  it("removes q from the URL when the q chip is clicked", async () => {
    const { onUrlUpdate } = renderFilterBar({ searchParams: "?q=foo" });
    await clickAndFlush(screen.getByRole("button", { name: /foo/ }));
    expect(onUrlUpdate).toHaveBeenCalled();
    // Clicking the chip writes { q: "" }, which clearOnDefault drops from the URL.
    expect(lastQueryString(onUrlUpdate)).not.toContain("foo");
  });
});

describe("FilterBar — Escape closes an open facet dropdown", () => {
  it("removes the open attribute from an open <details> on Escape", () => {
    renderFilterBar();
    const pillar = facetSection("Pillar");
    // Open the disclosure as a user click would.
    pillar.setAttribute("open", "");
    expect(pillar.hasAttribute("open")).toBe(true);

    // The capture-phase document keydown handler closes any open facet dropdown.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pillar.hasAttribute("open")).toBe(false);
  });
});

describe("FilterBar — outside click closes an open facet dropdown", () => {
  it("closes an open <details> on a pointer-down outside the bar", () => {
    renderFilterBar();
    const pillar = facetSection("Pillar");
    pillar.setAttribute("open", "");
    expect(pillar.hasAttribute("open")).toBe(true);

    // A mousedown anywhere outside barRef closes any open facet dropdown.
    fireEvent.mouseDown(document.body);
    expect(pillar.hasAttribute("open")).toBe(false);
  });

  it("leaves an open dropdown alone on a pointer-down inside the bar", () => {
    renderFilterBar();
    const pillar = facetSection("Pillar");
    pillar.setAttribute("open", "");

    // A mousedown on another element inside the bar must not close it.
    fireEvent.mouseDown(screen.getByText("Maturity"));
    expect(pillar.hasAttribute("open")).toBe(true);
  });
});

describe("FilterBar — inactive filter state", () => {
  it("hides the chips row and the reflow button when no filter is active", () => {
    renderFilterBar({ searchParams: "" });
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse to matches" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
  });
});
