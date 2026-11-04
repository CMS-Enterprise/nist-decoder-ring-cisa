/**
 * Integration test for DecoderRing's reflow ⨯ Clear-all wiring.
 *
 * DecoderRing owns the reflow ("collapse to matches") view state and passes
 * onClear={() => { clear(); setReflow(false); }} to FilterBar — so "Clear all" must
 * reset reflow, not just the URL filter. This test exercises that the reflow flag does
 * NOT survive a Clear all.
 *
 * Mocks:
 *  - next/navigation: opening a control is a router.push to its address; the spy
 *    records where.
 *  - ~/trpc/react: getBridgeData returns a tiny two-family dataset; searchControls
 *    (used by SearchTypeahead) returns no hits. Matches the per-call useQuery override
 *    pattern from ControlModal.default.test.tsx / SearchTypeahead.test.tsx.
 *  - react-zoom-pan-pinch: render-prop stub (same as LayerCakeVisualization.test.tsx).
 *  - ResizeObserver: jsdom lacks it; LayerCakeVisualization constructs one in an effect.
 *
 * URL-backed filter state goes through withNuqsTestingAdapter, like the other Bridge
 * tests, so toggling a facet from the FilterBar drives isActive.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

// ---------------------------------------------------------------------------
// tRPC mock — hoisted so vi.mock() runs before the component import.
// ---------------------------------------------------------------------------

let mockBridgeQuery: ReturnType<typeof vi.fn>;
let mockSearchQuery: ReturnType<typeof vi.fn>;
let mockControlByIdQuery: ReturnType<typeof vi.fn>;

vi.mock("~/trpc/react", () => ({
  api: {
    decoder: {
      getBridgeData: {
        get useQuery() {
          return mockBridgeQuery;
        },
      },
      searchControls: {
        get useQuery() {
          return mockSearchQuery;
        },
      },
      getControlById: {
        get useQuery() {
          return mockControlByIdQuery;
        },
      },
    },
  },
}));

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({
    children,
  }: {
    children: (api: { zoomIn: () => void; zoomOut: () => void }) => unknown;
  }) => <>{children({ zoomIn: () => undefined, zoomOut: () => undefined })}</>,
  TransformComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Import AFTER mocks are registered.
import DecoderRing from "../DecoderRing";

// jsdom has no ResizeObserver; LayerCakeVisualization instantiates one in an effect.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {
      /* no-op */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  };
});

// A minimal bridge dataset: two families, each with one control. One control is
// IDENTITY (matches the ?pillar=IDENTITY filter we drive), one is DATA-only.
const BRIDGE_DATA = {
  version: "5.2",
  families: [
    {
      id: "AC",
      name: "Access Control",
      controls: [
        {
          id: "AC-02",
          oscalId: "ac-2",
          name: "Account Management",
          status: "zero-trust-aligned",
          family: "AC",
          pillars: ["IDENTITY"],
          maturities: ["ADVANCED"],
          functions: [],
        },
      ],
    },
    {
      id: "SC",
      name: "System and Communications Protection",
      controls: [
        {
          id: "SC-08",
          oscalId: "sc-8",
          name: "Transmission Confidentiality",
          status: "compliance",
          family: "SC",
          pillars: ["DATA"],
          maturities: ["INITIAL"],
          functions: [],
        },
      ],
    },
  ],
};

function renderDecoderRing(searchParams = "?pillar=IDENTITY") {
  return render(<DecoderRing />, {
    wrapper: withNuqsTestingAdapter({ searchParams }),
  });
}

// Click + give nuqs's throttled URL-write queue a macrotask tick to flush.
async function clickAndFlush(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockBridgeQuery = vi.fn(() => ({
    data: BRIDGE_DATA,
    isLoading: false,
    error: null,
  }));
  mockSearchQuery = vi.fn(() => ({ data: { hits: [], matchingIds: [] } }));
  mockControlByIdQuery = vi.fn(() => ({ data: undefined, isLoading: false }));
});

describe("DecoderRing — export link", () => {
  it("opens the export page on the view's facets", () => {
    renderDecoderRing("?pillar=IDENTITY&q=account");
    const link = screen.getByRole("link", { name: "Export this view" });
    const params = new URLSearchParams(
      link.getAttribute("href")!.split("?")[1],
    );
    expect(link.getAttribute("href")!.startsWith("/export?")).toBe(true);
    expect(params.get("pillar")).toBe("IDENTITY");
    expect(params.get("q")).toBe("account");
  });

  it("offers the whole catalog when nothing narrows the view", () => {
    renderDecoderRing("");
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute(
      "href",
      "/export",
    );
  });
});

describe("DecoderRing — a withdrawn control opens from search when asked for", () => {
  it("links AC-13's path from the dropdown with withdrawn controls included", async () => {
    mockSearchQuery = vi.fn((input: { includeWithdrawn?: boolean }) => ({
      data: {
        hits: input.includeWithdrawn
          ? [
              {
                controlNumber: "AC-13",
                controlName: "Supervision and Review — Access Control",
                matchedIn: "id",
                withdrawn: true,
              },
            ]
          : [],
        matchingIds: [],
      },
    }));
    renderDecoderRing("");
    await clickAndFlush(
      screen.getByRole("checkbox", { name: "Search withdrawn controls" }),
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Search controls"), {
        target: { value: "AC-13" },
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const hit = await screen.findByText("AC-13");
    // The cake holds live controls only; a withdrawn one links to its own address
    // like any other, and the control route serves its withdrawn record.
    expect(hit.closest("a")?.getAttribute("href")).toMatch(
      /^\/control\/AC-13(\?|$)/,
    );
  });
});

describe("DecoderRing — load / error states", () => {
  it("shows the loading spinner while the bridge query is loading", () => {
    mockBridgeQuery = vi.fn(() => ({
      data: undefined,
      isLoading: true,
      error: null,
    }));
    renderDecoderRing("");
    expect(screen.getByText("Loading controls...")).toBeInTheDocument();
  });

  it("shows the error panel when the bridge query errors", () => {
    mockBridgeQuery = vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: { message: "boom" },
    }));
    renderDecoderRing("");
    expect(screen.getByText("Failed to load controls")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

// The open control used to be state here; it is now the address, and the modal is
// ControlModalRoute's (its tests cover rendering, closing and following the data).
describe("DecoderRing — a control is a link to its address", () => {
  it("links a chip on the cake to the control's path, with the current filters", () => {
    renderDecoderRing("?pillar=IDENTITY");

    expect(screen.getByRole("link", { name: /AC-02/ })).toHaveAttribute(
      "href",
      "/control/AC-02?pillar=IDENTITY",
    );
  });

  it("links a search hit to the control's path, with no query when no filter is set", async () => {
    mockSearchQuery = vi.fn(() => ({
      data: {
        hits: [
          {
            controlNumber: "AC-02",
            controlName: "Account Management",
            matchedIn: "id",
          },
        ],
        matchingIds: ["AC-02"],
      },
    }));

    renderDecoderRing("");

    // Type a >=2-char term and let the 250ms debounce open the dropdown.
    const input = screen.getByLabelText("Search controls");
    await act(async () => {
      fireEvent.change(input, { target: { value: "ac" } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // The dropdown hit text is the control name; the hit is the link around it.
    const hit = await screen.findByText("Account Management");

    // The typed search term is part of the filter state, so it travels too.
    expect(hit.closest("a")).toHaveAttribute("href", "/control/AC-02?q=ac");
  });

  it("renders no modal of its own", async () => {
    renderDecoderRing("");
    await clickAndFlush(screen.getByRole("link", { name: /AC-02/ }));
    expect(screen.queryByText("Copy Guidance Text")).not.toBeInTheDocument();
  });
});

describe("DecoderRing — reflow does not persist across Clear all", () => {
  it("resets reflow when Clear all is clicked", async () => {
    // Start with an active filter so the reflow toggle is surfaced.
    renderDecoderRing("?pillar=IDENTITY");

    // Turn reflow ON: the toggle flips to its "Show all" label.
    await clickAndFlush(
      screen.getByRole("button", { name: "Collapse to matches" }),
    );
    expect(
      screen.getByRole("button", { name: "Show all" }),
    ).toBeInTheDocument();

    // Clear all → onClear runs clear() + setReflow(false). Clearing empties the filter,
    // so isActive becomes false and the whole chips/reflow row disappears.
    await clickAndFlush(screen.getByRole("button", { name: "Clear all" }));
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();

    // Re-activate a filter: the reflow toggle returns in its OFF state ("Collapse to
    // matches"), proving the earlier reflow=true did not survive the Clear all.
    const pillar = screen.getByText("Pillar").closest("details") as HTMLElement;
    await clickAndFlush(within(pillar).getByLabelText("Identity"));
    expect(
      screen.getByRole("button", { name: "Collapse to matches" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
  });
});

describe("DecoderRing — reflow resets when the last chip is dismissed", () => {
  it("resets reflow when isActive drops to false via chip dismissal (not Clear all)", async () => {
    renderDecoderRing("?pillar=IDENTITY");

    // Turn reflow ON.
    await clickAndFlush(
      screen.getByRole("button", { name: "Collapse to matches" }),
    );
    expect(
      screen.getByRole("button", { name: "Show all" }),
    ).toBeInTheDocument();

    // Dismiss the lone pillar chip (NOT "Clear all") → the only filter is gone → isActive
    // false → the chips/reflow row disappears.
    await clickAndFlush(screen.getByRole("button", { name: /Identity/ }));
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();

    // Re-activate a filter: reflow comes back OFF ("Collapse to matches"), proving the
    // isActive→false effect reset it even though Clear all was never pressed.
    const pillar = screen.getByText("Pillar").closest("details") as HTMLElement;
    await clickAndFlush(within(pillar).getByLabelText("Identity"));
    expect(
      screen.getByRole("button", { name: "Collapse to matches" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show all" }),
    ).not.toBeInTheDocument();
  });
});

describe("DecoderRing header accessory", () => {
  it("renders what the page passes into the header", () => {
    render(
      <DecoderRing headerAccessory={<button type="button">Sign in</button>} />,
      {
        wrapper: withNuqsTestingAdapter({ searchParams: "" }),
      },
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
