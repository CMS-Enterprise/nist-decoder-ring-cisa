/**
 * Tests for the default-exported ControlModal component (the modal shell).
 *
 * Tests the component that calls api.decoder.getControlById.useQuery — the trpc client
 * is mocked via vi.mock so no real HTTP requests are made. Each test controls the
 * { data, isLoading } return value through the mock's per-call behaviour.
 *
 * Coverage targets (lines 597-903 of ControlModal.tsx):
 *  - Loading skeleton
 *  - Fully-loaded base control with ZT mapping + parts + metadata + discussion
 *  - Compliance (no-ZT) base control: left-pane compliance note, right-pane no-ZT panel
 *  - Base-no-ZT but enhancements-have-ZT: the teal "ZT alignment available" banner
 *  - Enhancement tabs: clicking changes active detail
 *  - The tab in the address: ?enh opens a tab, a click pushes it, a repeat adds nothing
 *  - Copy-to-clipboard: success path (navigator.clipboard available)
 *  - Copy-to-clipboard: fallback path (navigator.clipboard unavailable)
 *  - Modal close button
 *  - Fallback pre-load (detailData not yet available, control carries ztMapping)
 *  - nistVersion prop rendering
 *  - enhancementLabel helper (extracted via rendered button text)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as rtlRender,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from "@testing-library/react";
import {
  withNuqsTestingAdapter,
  type OnUrlUpdateFunction,
} from "nuqs/adapters/testing";
import type { NistControl } from "../LayerCakeVisualization";
import type { ControlDetail, PartNode } from "../ControlModal";

// ---------------------------------------------------------------------------
// tRPC mock — must be hoisted so vi.mock() runs before imports
// ---------------------------------------------------------------------------

// The useQuery mock function is declared up here so tests can override it.
let mockUseQuery: ReturnType<typeof vi.fn>;

vi.mock("~/trpc/react", () => {
  // Re-read the module-level mock function each call so test overrides are picked up.
  return {
    api: {
      decoder: {
        getControlById: {
          get useQuery() {
            return mockUseQuery;
          },
        },
      },
    },
  };
});

// Import AFTER mocks are registered
import ControlModal, { WithdrawnZTPane } from "../ControlModal";
import { product } from "~/config/product";
import { controlNumberToOscalId } from "~/lib/control-id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The open tab is the address's `?enh`, so the modal renders under a nuqs adapter. With
 * memory, a tab click updates the address the next render reads, as in the browser.
 */
function render(
  ui: React.ReactElement,
  {
    searchParams = "",
    onUrlUpdate,
  }: { searchParams?: string; onUrlUpdate?: OnUrlUpdateFunction } = {},
) {
  return rtlRender(ui, {
    wrapper: withNuqsTestingAdapter({
      searchParams,
      hasMemory: true,
      onUrlUpdate,
    }),
  });
}

function makePart(overrides: Partial<PartNode> = {}): PartNode {
  return {
    id: "part-a",
    oscalPartId: "ac-2_smt.a",
    label: "a",
    name: "item",
    prose: "Manage information system accounts.",
    sortOrder: 0,
    ztCovered: false,
    parameters: [],
    children: [],
    ...overrides,
  };
}

type ZtMapping = NonNullable<ControlDetail["ztMapping"]>;

const baseZt: ZtMapping = {
  pillar: "IDENTITY",
  function: "Identity Management",
  maturity: "ADVANCED",
  guidance: "Centralize identity with a modern IdP.",
  affinities: [
    {
      pillar: "IDENTITY",
      function: "Identity Management",
      maturity: "ADVANCED",
      guidance: "Centralize identity with a modern IdP.",
    },
  ],
};

function makeDetail(overrides: Partial<ControlDetail> = {}): ControlDetail {
  return {
    id: "AC-02",
    name: "Account Management",
    description: "",
    baselines: [],
    discussion: null,
    reviewFrequency: null,
    assessmentFrequency: null,
    status: "zero-trust-aligned",
    parts: [makePart()],
    ztLinks: [],
    nistLinks: [],
    ztMapping: baseZt,
    ...overrides,
  };
}

/** Minimal NistControl as passed in from the layer cake */
function makeControl(overrides: Partial<NistControl> = {}): NistControl {
  return {
    id: "AC-02",
    oscalId: "ac-2",
    name: "Account Management",
    status: "zero-trust-aligned",
    family: "AC",
    pillars: ["IDENTITY"],
    maturities: ["ADVANCED"],
    functions: ["Identity Management"],
    ztMapping: {
      pillar: "IDENTITY",
      function: "Identity Management",
      maturity: "ADVANCED",
      guidance: "Centralize identity with a modern IdP.",
    },
    ...overrides,
  };
}

/** Full query response shape (ControlDetail + enhancements) */
function makeQueryResponse(
  detail: Partial<ControlDetail> = {},
  enhancements: ControlDetail[] = [],
) {
  return { ...makeDetail(detail), enhancements };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default: loading state
  mockUseQuery = vi.fn().mockReturnValue({ data: undefined, isLoading: true });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

describe("ControlModal — loading skeleton", () => {
  it("renders the skeleton pulse elements while isLoading=true", () => {
    mockUseQuery = vi
      .fn()
      .mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // The loading skeleton uses animate-pulse divs
    const pulseEls = container.querySelectorAll(".animate-pulse");
    expect(pulseEls.length).toBeGreaterThan(0);
  });

  it("shows the control ID and name from the prop while loading", () => {
    mockUseQuery = vi
      .fn()
      .mockReturnValue({ data: undefined, isLoading: true });
    render(
      <ControlModal
        control={makeControl({
          id: "AU-05",
          name: "Response to Audit Failures",
        })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("AU-05")).toBeInTheDocument();
    expect(screen.getByText("Response to Audit Failures")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fully loaded base control with ZT mapping
// ---------------------------------------------------------------------------

describe("ControlModal — fully loaded base control (ZT-mapped)", () => {
  it("renders both panes once data arrives", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // Left pane: catalog label
    expect(screen.getByText("Control")).toBeInTheDocument();
    // Right pane: ZT heading
    expect(
      screen.getByText("Zero Trust Security Function"),
    ).toBeInTheDocument();
  });

  it("renders the part prose from the loaded detail", () => {
    const part = makePart({ prose: "Manage accounts per policy." });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ parts: [part] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Manage accounts per policy.")).toBeInTheDocument();
  });

  it("renders the control's own baselines through the full modal, in one spelling", () => {
    // The gap this closes: every other fixture here hardcodes `baselines: []`, so the row
    // added with the control-level array was never exercised with real data through the
    // composed modal — only the prose-decoration seam got that treatment.
    //
    // The two surfaces disagree at source. A control's array is free text the catalog
    // publishes ("Low", "Privacy"); a parameter value carries the Prisma enum ("LOW",
    // "PRIVACY"). Both reach the same neutral renderer, so rendered verbatim one control shows
    // "Low" beside "LOW" for the same concept. Asserted at the composition level because
    // that is where the two meet — the renderer is correct about either one alone.
    const part: PartNode = {
      id: "p-baseline",
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
          values: [{ baselines: ["LOW", "TAILORED"], value: "30 days" }],
        },
      ],
      children: [],
    };
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        baselines: ["Low", "Moderate", "High", "Privacy"],
        parts: [part],
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );

    // The control-level row renders every baseline the control belongs to.
    for (const token of ["Moderate", "High", "Privacy"]) {
      expect(screen.getAllByText(token).length).toBeGreaterThan(0);
    }
    // "Low" appears from the control array and "LOW" from the parameter enum; both must
    // land on the same spelling rather than two.
    expect(screen.getAllByText("Low").length).toBe(2);
    expect(screen.queryByText("LOW")).not.toBeInTheDocument();
    // A token the UI was never taught stays as published; expanding it would be
    // putting words in the catalog's mouth.
    expect(screen.getByText("TAILORED")).toBeInTheDocument();
  });

  it("composes this product's slots, which decorate nothing, through the full modal", () => {
    // The renderer holds no vocabulary of its own and takes its decoration check from
    // the product; this product supplies none, so
    // badge-bearing prose stays a plain span all the way through the modal rather than
    // reaching ProseBlock. Asserted end to end because that is where a reinstated direct
    // import of the badge module would show up — the seam can be correct in isolation and
    // still be bypassed at the composition point.
    const badged = "\u{1F13B}: 30 days";
    const part = makePart({ prose: badged });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ parts: [part] }),
      isLoading: false,
    });
    const { container } = render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector("p.pt-0\\.5")).toBeNull();
    expect(screen.getByText(badged).tagName).toBe("SPAN");
  });

  it("renders ZT guidance text in the right pane", () => {
    // When affinities are present the component renders from affinities, not the top-level
    // guidance field; provide matching text in both so the test is unambiguous.
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        ztMapping: {
          ...baseZt,
          guidance: "Use IdP federation.",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "Use IdP federation.",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Use IdP federation.")).toBeInTheDocument();
  });

  it("renders the nistVersion badge", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("NIST SP 800-53 Rev 5")).toBeInTheDocument();
  });

  it("falls back to the product's catalog label when nistVersion is not provided", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />);
    expect(screen.getByText("NIST SP 800-53")).toBeInTheDocument();
  });

  it("renders the Source Framework label", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Source Framework")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Discussion renders in left pane
// ---------------------------------------------------------------------------

describe("ControlModal — discussion section", () => {
  it("shows the discussion block when the detail has discussion text", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        discussion: "Catalog-specific interpretation here.",
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Discussion")).toBeInTheDocument();
    expect(
      screen.getByText("Catalog-specific interpretation here."),
    ).toBeInTheDocument();
  });

  it("omits the discussion block when discussion is null", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ discussion: null }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Discussion")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assessment procedures render in left pane
// ---------------------------------------------------------------------------

describe("ControlModal — assessment procedures section", () => {
  it("lists determination statements and splits each method into its items", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        assessment: {
          objectives: [
            {
              id: "obj_ac-02a.01_r520",
              identifier: "DS-AC-02a.[01]",
              text: "account types allowed for use within the system are defined and documented;",
              partId: "part_ac-2_smt.a_r520",
            },
            {
              id: "obj_ac-02b_r520",
              identifier: "DS-AC-02b.",
              text: "account managers are assigned;",
              partId: "part_ac-2_smt.b_r520",
            },
          ],
          methods: [
            {
              method: "EXAMINE",
              text: "[SELECT FROM: Access control policy; account records].",
            },
            { method: "INTERVIEW", text: "[SELECT FROM: Account managers]." },
            {
              method: "TEST",
              text: "[SELECT FROM: Account management mechanisms].",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Assessment Procedures")).toBeInTheDocument();
    expect(screen.getByText("AC-02a.[01]")).toBeInTheDocument();
    expect(
      screen.getByText("account managers are assigned;"),
    ).toBeInTheDocument();
    expect(screen.getByText("Examine")).toBeInTheDocument();
    expect(screen.getByText("Access control policy")).toBeInTheDocument();
    expect(screen.getByText("account records")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.queryByText(/is available for this control/)).toBeNull();
  });

  it("names the absent kind when the publication provides no method of that kind", () => {
    // 108 controls have no test, two have no interview, one has no examine, and none have nothing — so the empty state is per kind. A blanket "no assessment information" would never fire and would misdescribe the rest of the pane.
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        assessment: {
          objectives: [],
          methods: [
            {
              method: "EXAMINE",
              text: "[SELECT FROM: Access control policy].",
            },
            { method: "INTERVIEW", text: "[SELECT FROM: Account managers]." },
            { method: "TEST", text: null },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // The heading still renders, so the reader sees which kind is absent.
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(
      screen.getByText("No test method is available for this control."),
    ).toBeInTheDocument();
    // The populated kinds are unaffected.
    expect(screen.getByText("Access control policy")).toBeInTheDocument();
    expect(screen.getByText("Account managers")).toBeInTheDocument();
  });

  it("shows method text as is when it is not in the SELECT FROM shape", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        assessment: {
          objectives: [],
          methods: [
            {
              method: "INTERVIEW",
              text: "Organizational personnel with access control responsibilities",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Organizational personnel with access control responsibilities",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Determination Statements")).toBeNull();
  });

  it("omits the section when the control carries no procedures", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ assessment: { objectives: [], methods: [] } }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Assessment Procedures")).toBeNull();
  });

  it("omits the section on the pre-load fallback, which carries no assessment field", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ assessment: undefined }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Assessment Procedures")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Frequency metadata
// ---------------------------------------------------------------------------

describe("ControlModal — frequency metadata", () => {
  it("renders review and assessment frequency when present", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        reviewFrequency: "Annually",
        assessmentFrequency: "Quarterly",
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Annually")).toBeInTheDocument();
    expect(screen.getByText("Quarterly")).toBeInTheDocument();
  });

  it("omits the metadata strip when both frequencies are null", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        reviewFrequency: null,
        assessmentFrequency: null,
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Review:")).toBeNull();
    expect(screen.queryByText("Assessment:")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ZT enriched subcontrol legend
// ---------------------------------------------------------------------------

describe("ControlModal — ZT enriched subcontrol legend", () => {
  it("shows the legend when any part has ztCovered=true", () => {
    const coveredPart = makePart({ ztCovered: true });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ parts: [coveredPart] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("ZT enriched subcontrol")).toBeInTheDocument();
  });

  it("omits the legend when no parts are ZT covered", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ parts: [makePart({ ztCovered: false })] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("ZT enriched subcontrol")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Compliance (no-ZT) control
// ---------------------------------------------------------------------------

describe("ControlModal — compliance (no ZT mapping)", () => {
  it("shows 'No Zero Trust Mapping' in the right pane when the control has no ZT mapping", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ ztMapping: undefined, status: "compliance" }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "compliance", ztMapping: undefined })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No Zero Trust Mapping")).toBeInTheDocument();
  });

  it("says the Zero Trust mapping does not cover the control, in both panes, giving no reason", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ ztMapping: undefined, status: "compliance" }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "compliance", ztMapping: undefined })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // The control pane and the Zero Trust pane name the mapping's source and give no
    // reason it leaves the control out.
    expect(
      screen.getAllByText(
        "CISA's Zero Trust control mapping does not map this control.",
      ),
    ).toHaveLength(2);
    expect(screen.queryByText(/procedural/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Enhancement tabs
// ---------------------------------------------------------------------------

describe("ControlModal — enhancement tabs", () => {
  const enhA: ControlDetail = makeDetail({
    id: "AC-02(01)",
    name: "Automated System Account Management",
    ztMapping: {
      ...baseZt,
      guidance: "Enhancement 01 guidance.",
      affinities: [{ ...baseZt, guidance: "Enhancement 01 guidance." }],
    },
  });
  const enhB: ControlDetail = makeDetail({
    id: "AC-02(03)",
    name: "Disable Accounts",
    ztMapping: undefined,
    status: "compliance",
  });

  it("renders 'Base' tab plus one tab per enhancement", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [enhA, enhB]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "zt-via-enhancements" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Base( |,|$)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^\(01\)( |,|$)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^\(03\)( |,|$)/ }),
    ).toBeInTheDocument();
  });

  it("colors tabs by ZT alignment — ZT enhancement teal, non-ZT tan, base blue (never purple)", () => {
    // Base detail has a ZT mapping (makeDetail default); enhA is ZT-mapped, enhB is not.
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [enhA, enhB]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({})}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // Base tab is active (amber) on mount; the enhancement tabs are inactive and
    // show their status color.
    const ztEnhTab = screen.getByRole("button", { name: /^\(01\)( |,|$)/ });
    const nonZtEnhTab = screen.getByRole("button", { name: /^\(03\)( |,|$)/ });
    expect(ztEnhTab).toHaveClass("bg-zt"); // ZT enhancement
    expect(nonZtEnhTab).toHaveClass("ring-highlight-edge"); // non-ZT enhancement
    // Mapping is marked in text as well as color, and named in full.
    expect(ztEnhTab).toHaveAccessibleName("(01) ZT, Zero Trust mapped");
    expect(ztEnhTab).toHaveTextContent("ZT");
    expect(nonZtEnhTab).toHaveAccessibleName("(03)");
    expect(nonZtEnhTab).not.toHaveTextContent("ZT");
    // The open tab is pressed, which a reader gets without seeing its color.
    expect(
      screen.getByRole("button", { name: /^Base( |,|$)/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(ztEnhTab).toHaveAttribute("aria-pressed", "false");
    // Activate an enhancement so the base tab goes inactive and shows its color.
    fireEvent.click(ztEnhTab);
    const base = screen.getByRole("button", { name: /^Base( |,|$)/ });
    expect(base).toHaveClass("bg-accent"); // base is ZT-mapped
    // The "both" bridge state never leaks violet into the modal.
    for (const tab of [base, ztEnhTab, nonZtEnhTab]) {
      expect(tab.className).not.toMatch(/violet/);
    }
  });

  it("colors the base tab tan when the base has no ZT mapping", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(
        { ztMapping: undefined, status: "zt-via-enhancements" },
        [enhA],
      ),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "zt-via-enhancements" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // Deactivate the base tab (activate the enhancement) to read its inactive color.
    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    expect(screen.getByRole("button", { name: /^Base( |,|$)/ })).toHaveClass(
      "ring-highlight-edge",
    );
  });

  it("shows the enhancement detail after clicking its tab", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [enhA]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "zt-via-enhancements" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    const tab = screen.getByRole("button", { name: /^\(01\)( |,|$)/ });
    fireEvent.click(tab);
    expect(screen.getByText("Enhancement 01 guidance.")).toBeInTheDocument();
    expect(screen.getByText("AC-02(01)")).toBeInTheDocument();
  });

  it("returns to base view after clicking the Base tab", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [enhA]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "zt-via-enhancements" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // Click enhancement tab first
    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    // Then return to base
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    // Base control heading is visible again
    expect(screen.getByText("AC-02")).toBeInTheDocument();
  });

  describe("a discussion cross-reference to this control's own tabs", () => {
    // The reader's chosen tab used to win over every later cross-reference, so
    // a link to the open control did nothing once any tab had been clicked.
    const enh = makeDetail({
      id: "AC-02(01)",
      name: "Automated Account Management",
      discussion: "Builds on [AC-2](#ac-2) and relates to [SC-8](#sc-8).",
    });
    const base = {
      discussion: "See [AC-2(1)](#ac-2.1) for the automated form.",
    };

    it("selects the enhancement's tab even after a reader chose a tab", () => {
      mockUseQuery = vi.fn().mockReturnValue({
        data: makeQueryResponse(base, [enh]),
        isLoading: false,
      });
      const open = vi.fn();
      render(
        <ControlModal
          control={makeControl({ status: "zt-via-enhancements" })}
          nistVersion="NIST SP 800-53 Rev 5"
          onClose={vi.fn()}
          onOpenControl={open}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
      fireEvent.click(screen.getByRole("button", { name: "AC-2(1)" }));
      expect(screen.getByText("AC-02(01)")).toBeInTheDocument();
      expect(open).not.toHaveBeenCalled();
    });

    it("returns to the base tab from an enhancement's link back to its base", () => {
      mockUseQuery = vi.fn().mockReturnValue({
        data: makeQueryResponse(base, [enh]),
        isLoading: false,
      });
      const open = vi.fn();
      render(
        <ControlModal
          control={makeControl({ status: "zt-via-enhancements" })}
          nistVersion="NIST SP 800-53 Rev 5"
          onClose={vi.fn()}
          onOpenControl={open}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
      expect(screen.getByText("AC-02(01)")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "AC-2" }));
      expect(screen.queryByText("AC-02(01)")).not.toBeInTheDocument();
      expect(screen.getByText("AC-02")).toBeInTheDocument();
      expect(open).not.toHaveBeenCalled();
    });

    it("still hands a cross-reference to another control to the parent", () => {
      mockUseQuery = vi.fn().mockReturnValue({
        data: makeQueryResponse(base, [enh]),
        isLoading: false,
      });
      const open = vi.fn();
      render(
        <ControlModal
          control={makeControl({ status: "zt-via-enhancements" })}
          nistVersion="NIST SP 800-53 Rev 5"
          onClose={vi.fn()}
          onOpenControl={open}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
      fireEvent.click(screen.getByRole("button", { name: "SC-8" }));
      expect(open).toHaveBeenCalledWith("SC-08");
    });
  });
});

// ---------------------------------------------------------------------------
// The tab in the address (?enh)
// ---------------------------------------------------------------------------

describe("ControlModal — the tab in the address (?enh)", () => {
  const enhA = makeDetail({
    id: "AC-02(01)",
    name: "Automated System Account Management",
  });
  const enhB = makeDetail({ id: "AC-02(03)", name: "Disable Accounts" });

  beforeEach(() => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [enhA, enhB]),
      isLoading: false,
    });
  });

  const heading = () => screen.getByRole("heading", { level: 2 });

  /** Let nuqs flush what it queued, so a check for no update means none was sent. */
  const settle = () =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

  it("opens on the tab ?enh names", () => {
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?enh=03",
    });
    expect(heading()).toHaveTextContent("AC-02(03)");
    expect(
      screen.getByRole("button", { name: /^\(03\)( |,|$)/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("pushes each tab change, and Base takes ?enh off", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?pillar=DATA",
      onUrlUpdate,
    });

    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const toTab = onUrlUpdate.mock.calls[0]![0];
    expect(toTab.queryString).toBe("?pillar=DATA&enh=01");
    expect(toTab.options.history).toBe("push");
    expect(heading()).toHaveTextContent("AC-02(01)");

    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(2));
    expect(onUrlUpdate.mock.calls[1]![0].queryString).toBe("?pillar=DATA");
    expect(heading()).toHaveTextContent("AC-02");
  });

  it("adds nothing when the tab clicked is the one already open", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?enh=01",
      onUrlUpdate,
    });
    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    await settle();
    expect(onUrlUpdate).not.toHaveBeenCalled();

    // Once on Base, Base again adds nothing either.
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    await settle();
    expect(onUrlUpdate).toHaveBeenCalledTimes(1);
  });

  it("adds nothing for Base under an ?enh the control doesn't have", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?enh=99",
      onUrlUpdate,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    await settle();
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["names no enhancement of the control", "?enh=99"],
    ["is not a number", "?enh=x"],
    ["has too many digits", "?enh=123"],
  ])("shows the base tab for an ?enh that %s", (_, searchParams) => {
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams,
    });
    expect(heading()).toHaveTextContent(/^AC-02$/);
    expect(
      screen.getByRole("button", { name: /^Base( |,|$)/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("zero-pads a one-digit ?enh, as the server does", () => {
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?enh=1",
    });
    expect(heading()).toHaveTextContent("AC-02(01)");
  });

  it("copies the enhancement a deep link opens on", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />, {
      searchParams: "?enh=03",
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Copy Guidance Text/i }),
      );
    });
    const copied = String(writeTextMock.mock.calls[0]![0]);
    expect(copied).toContain("AC-02(03)");
    expect(copied).toContain("Disable Accounts");
  });
});

// ---------------------------------------------------------------------------
// Teal "ZT alignment available in enhancements" banner
// ---------------------------------------------------------------------------

describe("ControlModal — ZT-via-enhancements banner", () => {
  const ztEnh: ControlDetail = makeDetail({
    id: "AC-02(01)",
    name: "Automated Account Management",
    ztMapping: { ...baseZt, guidance: "Enh 01 ZT guidance." },
  });

  it("shows the teal banner when base has no ZT mapping but an enhancement does", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(
        { ztMapping: undefined, status: "zt-via-enhancements" },
        [ztEnh],
      ),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({
          status: "zt-via-enhancements",
          ztMapping: undefined,
        })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("ZT alignment available in enhancements"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("— select a tab marked ZT below"),
    ).toBeInTheDocument();
  });

  it("hides the teal banner after clicking an enhancement tab", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(
        { ztMapping: undefined, status: "zt-via-enhancements" },
        [ztEnh],
      ),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({
          status: "zt-via-enhancements",
          ztMapping: undefined,
        })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    expect(
      screen.queryByText("ZT alignment available in enhancements"),
    ).toBeNull();
  });

  it("does NOT show the banner when base has its own ZT mapping", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ ztMapping: baseZt }, [ztEnh]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("ZT alignment available in enhancements"),
    ).toBeNull();
  });

  it("does NOT show the banner when all enhancements have no ZT mapping", () => {
    const noZtEnh: ControlDetail = makeDetail({
      id: "AC-02(03)",
      ztMapping: undefined,
      status: "compliance",
    });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(
        { ztMapping: undefined, status: "zt-via-enhancements" },
        [noZtEnh],
      ),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({
          status: "zt-via-enhancements",
          ztMapping: undefined,
        })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("ZT alignment available in enhancements"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Close button
// ---------------------------------------------------------------------------

describe("ControlModal — close button", () => {
  it("calls onClose when the X button is clicked", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });
    const onClose = vi.fn();
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={onClose}
      />,
    );
    // The X button has an SVG inside; click by role (generic button)
    const buttons = screen.getAllByRole("button");
    // The close button is the first button in the right pane (top-right corner)
    // It's distinct from the Copy button — find by containing an svg with no text
    const closeBtn = buttons.find(
      (b) => !b.textContent?.trim() || b.textContent?.trim() === "",
    );
    // Fallback: the very last rendered button is "Copy Guidance Text"; the X button
    // is positioned before it. Just fire on the first button that has no visible label.
    expect(onClose).not.toHaveBeenCalled();
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });
});

describe("ControlModal — export menu", () => {
  it("exports the control shown, and offers its enhancements on a base", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [makeDetail({ id: "AC-02(01)" })]),
      isLoading: false,
    });
    const control = makeControl();
    render(
      <ControlModal
        control={control}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "More options…" })).toHaveAttribute(
      "href",
      `/export?pick=${encodeURIComponent(control.id)}`,
    );
    expect(
      screen.getByRole("button", { name: /Download spreadsheet/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Include its enhancements")).toBeChecked();
  });

  it("keeps one tab's failed download off the next tab", async () => {
    // Each tab gets its own export menu, so a failure on the base doesn't follow the
    // reader to an enhancement.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ error: "Base export failed." }, { status: 500 }),
        ),
      ),
    );
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({}, [makeDetail({ id: "AC-02(01)" })]),
      isLoading: false,
    });
    render(<ControlModal control={makeControl()} onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Download spreadsheet/ }),
      );
    });
    await waitFor(() =>
      expect(screen.getAllByText("Base export failed.").length).toBeGreaterThan(
        0,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    expect(screen.queryByText("Base export failed.")).toBeNull();
  });

  it("offers a base's enhancements only when it has live ones, as the export brings", () => {
    const renderWith = (status: "live" | "withdrawn") => {
      mockUseQuery = vi.fn().mockReturnValue({
        data: makeQueryResponse({}, [
          makeDetail({ id: "AC-02(10)", catalogStatus: status }),
        ]),
        isLoading: false,
      });
      return render(
        <ControlModal
          control={makeControl()}
          nistVersion="NIST SP 800-53 Rev 5"
          onClose={vi.fn()}
        />,
      );
    };
    const live = renderWith("live");
    expect(
      screen.getByLabelText("Include its enhancements"),
    ).toBeInTheDocument();
    live.unmount();
    renderWith("withdrawn");
    expect(screen.queryByLabelText("Include its enhancements")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Copy to clipboard — success path
// ---------------------------------------------------------------------------

describe("ControlModal — copy to clipboard (success path)", () => {
  it("shows 'Copied to Clipboard' after clicking the copy button", async () => {
    // Mock navigator.clipboard.writeText
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });

    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: /Copy Guidance Text/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Copied to Clipboard")).toBeInTheDocument();
    });

    expect(writeTextMock).toHaveBeenCalledOnce();
  });

  it("includes discussion and reference links in the copied text", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        discussion: "supplementary interpretation for copy.",
        ztLinks: [
          {
            label: "ZT Policy Doc",
            url: "https://docs.example.gov/zt-policy",
            domain: "NIST",
          },
        ],
        nistLinks: [
          { label: "NIST SP 800-53", url: "https://nist.gov/800-53" },
        ],
      }),
      isLoading: false,
    });

    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: /Copy Guidance Text/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledOnce();
    });
    const copied = writeTextMock.mock.calls[0]?.[0] as string;
    expect(copied).toContain(
      "Discussion: supplementary interpretation for copy.",
    );
    expect(copied).toContain("References:");
    expect(copied).toContain(
      "ZT Policy Doc: https://docs.example.gov/zt-policy",
    );
    expect(copied).toContain("NIST SP 800-53: https://nist.gov/800-53");
  });
});

// ---------------------------------------------------------------------------
// Copy to clipboard — fallback path (no navigator.clipboard)
// ---------------------------------------------------------------------------

describe("ControlModal — copy to clipboard (fallback path)", () => {
  it("falls back to execCommand when navigator.clipboard is unavailable", async () => {
    // Remove clipboard API to force fallback
    const origClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // Mock execCommand
    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(),
      isLoading: false,
    });

    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: /Copy Guidance Text/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith("copy");
    });

    // Restore clipboard
    if (origClipboard) {
      Object.defineProperty(navigator, "clipboard", origClipboard);
    }
  });
});

// ---------------------------------------------------------------------------
// Pre-load fallback: detailData not yet available, but control.ztMapping present
// ---------------------------------------------------------------------------

describe("ControlModal — pre-load fallback (no detailData yet)", () => {
  it("renders the ZT pane from control.ztMapping while detail loads", () => {
    // Simulate state where query returned undefined (no data, no loading) — the
    // loading=false + data=undefined branch shows the fallback ZT pane
    mockUseQuery = vi
      .fn()
      .mockReturnValue({ data: undefined, isLoading: false });

    render(
      <ControlModal
        control={makeControl({
          ztMapping: {
            pillar: "NETWORKS",
            function: "Network Segmentation",
            maturity: "INITIAL",
            guidance: "Pre-load ZT guidance from control prop.",
          },
        })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Pre-load ZT guidance from control prop."),
    ).toBeInTheDocument();
    // Left pane shows "Loading control details..." text
    expect(screen.getByText("Loading control details...")).toBeInTheDocument();
  });

  it("shows 'No Zero Trust Mapping' fallback when control has no ztMapping and data is absent", () => {
    mockUseQuery = vi
      .fn()
      .mockReturnValue({ data: undefined, isLoading: false });

    render(
      <ControlModal
        control={makeControl({ status: "compliance", ztMapping: undefined })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No Zero Trust Mapping")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StatementContent fallback: no parts
// ---------------------------------------------------------------------------

describe("ControlModal — no statement available", () => {
  it("renders the 'No statement available' message when parts is empty", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ parts: [] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No statement available.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Control-level reference links (ReferenceLinks) in full modal context
// ---------------------------------------------------------------------------

describe("ControlModal — control-level reference links", () => {
  it("renders 'References' in the left pane when the control has nistLinks", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        nistLinks: [
          {
            label: "NIST SP 800-63",
            url: "https://nist.gov/800-63",
          },
        ],
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    // Left pane renders the control's own links under a "References" header
    expect(
      screen.getByRole("link", { name: /NIST SP 800-63/ }),
    ).toHaveAttribute("href", "https://nist.gov/800-63");
  });

  it("renders ZT 'References' in the right pane when the control has ztLinks", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        ztLinks: [
          {
            label: "ZT Policy Doc",
            url: "https://docs.example.gov/zt-policy",
            domain: "NIST",
          },
        ],
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /ZT Policy Doc/ })).toHaveAttribute(
      "href",
      "https://docs.example.gov/zt-policy",
    );
  });

  it("left pane shows the product's empty-links message when nistLinks is empty", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ nistLinks: [], ztLinks: [] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("No reference links available"),
    ).toBeInTheDocument();
  });

  it("right pane shows the product's Zero Trust empty message when ztLinks is empty", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ nistLinks: [], ztLinks: [] }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(product.noZtLinksMessage)).toBeInTheDocument();
  });

  it("explains each pane's references separately, each with its own retrieval date", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: {
        ...makeQueryResponse({ nistLinks: [], ztLinks: [] }),
        referenceProvenance: {
          name: "catalog references",
          checkedOn: "2026-09-30",
          description: null,
        },
        ztReferenceProvenance: {
          name: "zero trust references",
          checkedOn: "2026-10-01",
          description: null,
        },
      },
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(product.ztReferencesInfoLabel).not.toBe(product.referencesInfoLabel);
    expect(
      screen.getByLabelText(product.referencesInfoLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(product.ztReferencesInfoLabel),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Links verified against their sites on 2026-09-30."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Links verified against their sites on 2026-10-01."),
    ).toBeInTheDocument();
  });

  it("renders control-level links in left pane even when ztMapping is absent (not ZT-gated)", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        status: "compliance",
        ztMapping: undefined,
        nistLinks: [
          {
            label: "Example Cloud Guide",
            url: "https://example.gov/guide",
          },
        ],
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ status: "compliance", ztMapping: undefined })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Example Cloud Guide/ }),
    ).toHaveAttribute("href", "https://example.gov/guide");
  });
});

// ---------------------------------------------------------------------------
// Multi-tuple ZT affinities in full modal context
// ---------------------------------------------------------------------------

describe("ControlModal — multi-tuple ZT affinities", () => {
  it("renders the ZT Coverage summary and multiple guidance blocks for multi-tuple controls", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        ztMapping: {
          ...baseZt,
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
              guidance: "Identity guidance text.",
            },
            {
              pillar: "DATA",
              function: "Data Encryption",
              maturity: "OPTIMAL",
              guidance: "Data guidance text.",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("ZT Coverage")).toBeInTheDocument();
    expect(screen.getByText("Identity guidance text.")).toBeInTheDocument();
    expect(screen.getByText("Data guidance text.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CROSS_CUTTING pillar rendering (underscore → hyphen via formatPillar)
// ---------------------------------------------------------------------------

describe("ControlModal — CROSS_CUTTING pillar display", () => {
  it("renders CROSS_CUTTING with a hyphen (not underscore)", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        ztMapping: {
          ...baseZt,
          pillar: "CROSS_CUTTING",
          affinities: [
            {
              pillar: "CROSS_CUTTING",
              function: "Strategy",
              maturity: "ADVANCED",
              guidance: "Cross-cutting guidance.",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("CROSS-CUTTING")).toBeInTheDocument();
  });

  it("renders APPLICATIONS as 'APPLICATIONS AND WORKLOADS'", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({
        ztMapping: {
          ...baseZt,
          pillar: "APPLICATIONS",
          affinities: [
            {
              pillar: "APPLICATIONS",
              function: "Application Access",
              maturity: "OPTIMAL",
              guidance: "App guidance.",
            },
          ],
        },
      }),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("APPLICATIONS AND WORKLOADS")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Baselines and frequency rows
// ---------------------------------------------------------------------------

describe("ControlModal — baselines and frequency rows", () => {
  const freq = (
    part: string | null,
    before: string,
    parameter = "organization-defined frequency",
  ) => ({
    part,
    before,
    parameter,
    after: "",
  });
  const renderModal = (
    detail: Partial<ControlDetail>,
    enhancements: ControlDetail[] = [],
  ) => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(detail, enhancements),
      isLoading: false,
    });
    // The modal finds a tab by the control's own id, so the chip names the control the
    // detail does.
    const id = detail.id ?? "AC-02";
    render(
      <ControlModal
        control={makeControl({ id, oscalId: controlNumberToOscalId(id)! })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
  };

  it("shows every catalog baseline, the applicable ones marked", () => {
    renderModal({ baselines: ["Low", "Moderate", "High"] });
    for (const b of product.catalogBaselines) {
      const chip = screen.getByText(b, { selector: "span[data-applies]" });
      expect(chip).toHaveAttribute(
        "data-applies",
        b === "Privacy" ? "false" : "true",
      );
    }
  });

  it("marks an organization-defined frequency and lists it on request", () => {
    renderModal({
      frequency: { nist: [freq("(j)", "Review accounts for compliance")] },
    });
    const chip = screen.getByRole("button", {
      name: product.frequencyOrgDefinedChip,
    });
    expect(
      screen.queryByText("organization-defined frequency"),
    ).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("(j)")).toBeInTheDocument();
    expect(
      screen.getByText("organization-defined frequency"),
    ).toBeInTheDocument();
  });

  it("points the frequency toggle at its list, and sets punctuation after the frequency without a space", () => {
    renderModal({
      frequency: {
        nist: [
          {
            ...freq(null, "Provide feedback to the following personnel"),
            after: ": organization-defined personnel",
          },
        ],
      },
    });
    const chip = screen.getByRole("button", {
      name: product.frequencyOrgDefinedChip,
    });
    fireEvent.click(chip);
    const list = document.getElementById(chip.getAttribute("aria-controls")!);
    expect(list).not.toBeNull();
    expect(list!.textContent).toContain(
      "organization-defined frequency: organization-defined personnel",
    );
  });

  it("says so when the control asks for no frequency", () => {
    renderModal({ frequency: { nist: [] } });
    expect(screen.getByText(product.frequencyNoneChip)).toHaveAttribute(
      "data-applies",
      "false",
    );
  });

  it("shows the base's frequency on an enhancement with none of its own", () => {
    const enh = makeDetail({
      id: "CA-02(01)",
      name: "Independent Assessors",
      frequency: { nist: [] },
    });
    renderModal(
      {
        id: "CA-02",
        frequency: {
          nist: [
            freq(
              "(d)",
              "Assess the controls",
              "organization-defined assessment frequency",
            ),
          ],
        },
      },
      [enh],
    );
    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    const chip = screen.getByRole("button", {
      name: `${product.frequencyInheritsChip} CA-02`,
    });
    fireEvent.click(chip);
    expect(
      screen.getByText("organization-defined assessment frequency"),
    ).toBeInTheDocument();
    // Each inherited line names its source, so it cannot be mistaken for the enhancement's own.
    expect(screen.getByText("CA-02(d)")).toBeInTheDocument();
  });

  it("starts the frequency list closed again on another tab", () => {
    const enh = makeDetail({
      id: "CA-02(02)",
      name: "Specialized Assessments",
      frequency: {
        nist: [freq(null, "Include as part of control assessments")],
      },
    });
    renderModal(
      {
        id: "CA-02",
        frequency: { nist: [freq("(d)", "Assess the controls")] },
      },
      [enh],
    );
    fireEvent.click(
      screen.getByRole("button", { name: product.frequencyOrgDefinedChip }),
    );
    expect(screen.getByText("(d)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^\(02\)( |,|$)/ }));
    expect(
      screen.getByRole("button", { name: product.frequencyOrgDefinedChip }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("uses an enhancement's own frequency when it has one", () => {
    const enh = makeDetail({
      id: "CA-02(02)",
      name: "Specialized Assessments",
      frequency: {
        nist: [
          freq(
            null,
            "Include as part of control assessments",
            "organization-defined specialized assessment frequency",
          ),
        ],
      },
    });
    renderModal(
      {
        id: "CA-02",
        frequency: { nist: [freq("(d)", "Assess the controls")] },
      },
      [enh],
    );
    fireEvent.click(screen.getByRole("button", { name: /^\(02\)( |,|$)/ }));
    expect(
      screen.queryByRole("button", {
        name: new RegExp(product.frequencyInheritsChip),
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: product.frequencyOrgDefinedChip }),
    );
    expect(
      screen.getByText("organization-defined specialized assessment frequency"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// An enhancement's references: its own first, then its base's
// ---------------------------------------------------------------------------

describe("ControlModal — enhancement references inherit the base's", () => {
  const baseLinks = [
    {
      label: "SP 800-63",
      url: "https://example.gov/sp800-63",
      citation: "NIST SP 800-63",
    },
    {
      label: "FIPS 201",
      url: "https://example.gov/fips201",
      citation: "FIPS 201",
    },
  ];
  // The reference links, without the export menu's "More options…".
  const referenceLinks = () =>
    screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("https://"));
  const renderOn = (enhLinks: ControlDetail["nistLinks"]) => {
    const enh = makeDetail({
      id: "IA-13(03)",
      name: "Token Management",
      nistLinks: enhLinks,
    });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ id: "IA-13", nistLinks: baseLinks }, [enh]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ id: "IA-13" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
  };

  it("reopens a site's container on each tab, so a container closed on one cannot hide the next tab's chip", () => {
    renderOn([{ label: "SP 800-63B", url: "https://example.gov/sp800-63b" }]);
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    const container = () =>
      screen.getByRole("link", { name: /SP 800-63B/ }).closest("details")!;
    expect(container()).toHaveAttribute("open");
    container().open = false;
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    expect(container()).toHaveAttribute("open");
  });

  it("explains how an enhancement's list is built only on an enhancement's tab", () => {
    renderOn([]);
    expect(
      screen.queryByText(product.referencesInfoBody.enhancement),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    expect(
      screen.getByText(product.referencesInfoBody.enhancement),
    ).toBeInTheDocument();
  });

  it("lists the enhancement's own references first, chipped, then the base's, each once", () => {
    renderOn([
      {
        label: "SP 800-63B",
        url: "https://example.gov/sp800-63b",
        citation: "NIST SP 800-63B",
      },
      {
        label: "FIPS 201",
        url: "https://example.gov/fips201",
        citation: "FIPS 201",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    const links = referenceLinks().map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "https://example.gov/sp800-63b",
      "https://example.gov/fips201",
      "https://example.gov/sp800-63",
    ]);
    expect(screen.getAllByText(product.enhancementSpecificChip)).toHaveLength(
      2,
    );
  });

  it("puts the chip beside the title, leaving the citation line as every entry has it", () => {
    renderOn([
      {
        label: "SP 800-63B",
        url: "https://example.gov/sp800-63b",
        citation: "NIST SP 800-63B",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    const chip = screen.getByText(product.enhancementSpecificChip);
    expect(chip.parentElement).toContainElement(screen.getByText("SP 800-63B"));
    expect(screen.getByText("NIST SP 800-63B")).toHaveTextContent(
      /^NIST SP 800-63B$/,
    );
  });

  it("shows the base's references, unchipped, on an enhancement that cites none", () => {
    renderOn([]);
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    expect(referenceLinks()).toHaveLength(2);
    expect(
      screen.queryByText(product.enhancementSpecificChip),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(product.noControlLinksMessage),
    ).not.toBeInTheDocument();
  });

  it("leaves the base tab's list as it was", () => {
    renderOn([{ label: "SP 800-63B", url: "https://example.gov/sp800-63b" }]);
    expect(referenceLinks()).toHaveLength(2);
    expect(
      screen.queryByText(product.enhancementSpecificChip),
    ).not.toBeInTheDocument();
  });

  it("marks the enhancement's own references in the copied text", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    renderOn([{ label: "SP 800-63B", url: "https://example.gov/sp800-63b" }]);
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Copy Guidance Text/i }),
      );
    });
    const text = writeTextMock.mock.calls[0]![0] as string;
    expect(text).toContain(
      `SP 800-63B (${product.enhancementSpecificChip.toLowerCase()}): https://example.gov/sp800-63b`,
    );
    expect(text).toContain("SP 800-63: https://example.gov/sp800-63");
  });
});

// ---------------------------------------------------------------------------
// The Zero Trust pane builds an enhancement's list the same way
// ---------------------------------------------------------------------------

describe("ControlModal — Zero Trust references on an enhancement's tab", () => {
  const baseZt = [
    {
      label: "Zero Trust Maturity Model",
      url: "https://example.gov/ztmm",
      domain: "FEDERAL",
      citation: "CISA ZTMM v2.0",
    },
  ];
  const enhZt = [
    {
      label: "Memo M-22-09",
      url: "https://example.gov/m-22-09",
      domain: "FEDERAL",
      citation: "OMB M-22-09",
    },
  ];
  const renderZt = () => {
    const enh = makeDetail({
      id: "IA-13(03)",
      name: "Token Management",
      ztLinks: enhZt,
      ztMapping: {
        pillar: "IDENTITY",
        function: "Authentication",
        maturity: "ADVANCED",
        guidance: "",
      },
    });
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse({ id: "IA-13", ztLinks: baseZt }, [enh]),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ id: "IA-13" })}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
      />,
    );
  };

  it("lists the enhancement's own first, chipped beside the title, then the base's", () => {
    renderZt();
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    const own = screen.getByRole("link", { name: /Memo M-22-09/ });
    const inherited = screen.getByRole("link", {
      name: /Zero Trust Maturity Model/,
    });
    expect(
      own.compareDocumentPosition(inherited) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(own).toHaveTextContent(product.enhancementSpecificChip);
    expect(inherited).not.toHaveTextContent(product.enhancementSpecificChip);
  });

  it("explains how the list is built only on an enhancement's tab", () => {
    renderZt();
    expect(
      screen.queryByText(product.ztReferencesInfoBody.enhancement),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^\(03\)( |,|$)/ }));
    expect(
      screen.getByText(product.ztReferencesInfoBody.enhancement),
    ).toBeInTheDocument();
  });

  it("leaves the base tab's list unchipped", () => {
    renderZt();
    expect(
      screen.getByRole("link", { name: /Zero Trust Maturity Model/ }),
    ).not.toHaveTextContent(product.enhancementSpecificChip);
  });
});

// ---------------------------------------------------------------------------
// Withdrawn controls and lineage
// ---------------------------------------------------------------------------

describe("ControlModal — withdrawn controls and lineage", () => {
  const live = makeDetail({
    id: "AC-02(01)",
    name: "Automated System Account Management",
    catalogStatus: "live",
    lineage: { successors: [], incorporates: [], addedIn: null },
  });
  const withdrawnEnh = makeDetail({
    id: "AC-02(10)",
    name: "Shared and Group Account Credential Change",
    catalogStatus: "withdrawn",
    status: "compliance",
    ztMapping: undefined,
    parts: [],
    baselines: [],
    lineage: {
      successors: [
        {
          controlNumber: "AC-02",
          kind: "incorporated-into",
          family: false,
          part: "ac-2_smt.k",
          ztPillars: ["IDENTITY", "DATA"],
        },
      ],
      incorporates: [],
      addedIn: null,
    },
  });
  const base = {
    catalogStatus: "live" as const,
    baselines: ["Low"],
    parts: [
      makePart(),
      makePart({
        id: "part-k",
        oscalPartId: "ac-2_smt.k",
        label: "k.",
        prose: "Change shared authenticators when a member leaves.",
      }),
    ],
    lineage: {
      successors: [],
      incorporates: [
        {
          controlNumber: "AC-02(10)",
          kind: "incorporated-into" as const,
          part: "ac-2_smt.k",
        },
        { controlNumber: "AC-13", kind: "incorporated-into" as const },
      ],
      addedIn: null,
    },
  };

  const renderModal = (
    open = vi.fn(),
    enhancements: ControlDetail[] = [live, withdrawnEnh],
    address: { searchParams?: string; onUrlUpdate?: OnUrlUpdateFunction } = {},
  ) => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(base, enhancements),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl()}
        nistVersion="NIST SP 800-53 Rev 5"
        onClose={vi.fn()}
        onOpenControl={open}
      />,
      address,
    );
    return open;
  };
  const highlighted = () => document.querySelector("[data-focused]");
  const showWithdrawn = () =>
    fireEvent.click(screen.getByRole("button", { name: "1 withdrawn" }));
  const openWithdrawnTab = () => {
    showWithdrawn();
    fireEvent.click(screen.getByRole("button", { name: "(10), withdrawn" }));
  };

  it("keeps withdrawn enhancement tabs behind a toggle, and marks them when shown", () => {
    renderModal();
    const toggle = screen.getByRole("button", { name: "1 withdrawn" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "(10), withdrawn" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/tabs are withdrawn enhancements/),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    const tab = screen.getByRole("button", { name: "(10), withdrawn" });
    expect(tab).toHaveClass("line-through");
    expect(tab).toHaveAttribute("title", "Withdrawn");
    expect(
      screen.getByRole("button", { name: /^\(01\)( |,|$)/ }),
    ).not.toHaveClass("line-through");
    expect(
      screen.getByText(/tabs are withdrawn enhancements/),
    ).toBeInTheDocument();

    const hide = screen.getByRole("button", { name: "Hide withdrawn" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(
      screen.queryByRole("button", { name: "(10), withdrawn" }),
    ).not.toBeInTheDocument();
  });

  it("shows only Base and the toggle when every enhancement is withdrawn", () => {
    renderModal(vi.fn(), [withdrawnEnh]);
    const strip = screen.getByRole("button", {
      name: /^Base( |,|$)/,
    }).parentElement!;
    expect(
      within(strip)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Base ZT, Zero Trust mapped", "1 withdrawn"]);
  });

  it("returns to the base when withdrawn tabs are hidden from one of them", () => {
    renderModal();
    openWithdrawnTab();
    expect(screen.getByTestId("withdrawn-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide withdrawn" }));
    expect(screen.queryByTestId("withdrawn-notice")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "AC-02",
    );
  });

  it("shows where a withdrawn enhancement went in place of its statement, and points the Zero Trust pane there", () => {
    renderModal();
    openWithdrawnTab();
    expect(screen.getByTestId("withdrawn-notice")).toHaveTextContent(
      "Incorporated into AC-02k.",
    );
    // The header chip and the notice's label.
    expect(screen.getAllByText("Withdrawn")).toHaveLength(2);
    const pane = screen.getByTestId("withdrawn-zt-pane");
    expect(pane).toHaveTextContent("Its Zero Trust guidance is on:");
    expect(pane).toHaveTextContent("AC-02k IDENTITY, DATA");
    // No statement box, baselines row, compliance note or reference list for a control
    // the catalog no longer carries.
    expect(
      screen.queryByText("No statement available."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(`${product.baselinesLabel}:`),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/does not have a direct Zero Trust/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(product.noControlLinksMessage),
    ).not.toBeInTheDocument();
  });

  it("lands on the successor's item, highlighted, from the notice and from the Zero Trust pane", () => {
    const open = renderModal();
    for (const where of ["withdrawn-notice", "withdrawn-zt-pane"]) {
      openWithdrawnTab();
      fireEvent.click(
        within(screen.getByTestId(where)).getByRole("button", {
          name: "AC-02k",
        }),
      );
      expect(screen.queryByTestId("withdrawn-notice")).not.toBeInTheDocument();
      const item = screen
        .getByText("Change shared authenticators when a member leaves.")
        .closest("[data-focused]");
      expect(item).not.toBeNull();
      expect(item).toHaveClass("ring-2");
      // A tab the reader picks clears the highlight.
      fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
      expect(document.querySelector("[data-focused]")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Hide withdrawn" }));
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("writes the successor's tab and item in one push, and a tab the reader picks takes the item off", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    renderModal(vi.fn(), undefined, {
      searchParams: "?pillar=DATA",
      onUrlUpdate,
    });
    openWithdrawnTab();
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    expect(onUrlUpdate.mock.calls[0]![0].queryString).toBe(
      "?pillar=DATA&enh=10",
    );

    fireEvent.click(
      within(screen.getByTestId("withdrawn-notice")).getByRole("button", {
        name: "AC-02k",
      }),
    );
    // Base and the item together: Back returns to the withdrawn tab in one step.
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(2));
    const toItem = onUrlUpdate.mock.calls[1]![0];
    expect(toItem.queryString).toBe("?pillar=DATA&item=k");
    expect(toItem.options.history).toBe("push");
    expect(highlighted()).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^\(01\)( |,|$)/ }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(3));
    expect(onUrlUpdate.mock.calls[2]![0].queryString).toBe(
      "?pillar=DATA&enh=01",
    );
    expect(highlighted()).toBeNull();
  });

  it("highlights the item the address names, as a reload or a shared link does", () => {
    renderModal(vi.fn(), undefined, { searchParams: "?item=k" });
    const item = highlighted();
    expect(item).toHaveTextContent(
      "Change shared authenticators when a member leaves.",
    );
    expect(item).toHaveClass("ring-2");
  });

  it.each(["K", "k.", "a..1", "<b>", "abc", ""])(
    "highlights nothing for ?item=%s, which isn't an item's path",
    (value) => {
      renderModal(vi.fn(), undefined, { searchParams: `?item=${value}` });
      expect(highlighted()).toBeNull();
    },
  );

  it("highlights nothing for an item the statement doesn't have", () => {
    renderModal(vi.fn(), undefined, { searchParams: "?item=z" });
    expect(highlighted()).toBeNull();
  });

  it("passes the item up with a successor in another control", () => {
    const elsewhere = makeDetail({
      ...withdrawnEnh,
      lineage: {
        successors: [
          {
            controlNumber: "AC-03",
            kind: "incorporated-into",
            family: false,
            part: "ac-3_smt.b",
            ztPillars: [],
          },
        ],
        incorporates: [],
        addedIn: null,
      },
    });
    const open = renderModal(vi.fn(), [live, elsewhere]);
    openWithdrawnTab();
    fireEvent.click(
      within(screen.getByTestId("withdrawn-notice")).getByRole("button", {
        name: "AC-03b",
      }),
    );
    expect(open).toHaveBeenCalledWith("AC-03", "b");
  });

  it("lists the withdrawn controls a live control took in, opening its own on a tab and others through the parent", () => {
    const open = renderModal();
    expect(screen.getByTestId("incorporated-controls")).toHaveTextContent(
      "Incorporated here: AC-02(10) (item k) and AC-13",
    );
    fireEvent.click(screen.getByRole("button", { name: "AC-02(10)" }));
    // The tab it lands on shows even though the withdrawn tabs are collapsed.
    expect(screen.getByTestId("withdrawn-notice")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Base( |,|$)/ }));
    fireEvent.click(screen.getByRole("button", { name: "AC-13" }));
    expect(open).toHaveBeenCalledWith("AC-13");
  });

  it("marks a control and an enhancement tab new in the release that added them", () => {
    mockUseQuery = vi.fn().mockReturnValue({
      data: makeQueryResponse(
        {
          id: "SA-15",
          lineage: { successors: [], incorporates: [], addedIn: null },
        },
        [
          makeDetail({
            id: "SA-15(13)",
            lineage: {
              successors: [],
              incorporates: [],
              addedIn: { release: "5.2.0", sinceRelease: "5.1.1+u4" },
            },
          }),
        ],
      ),
      isLoading: false,
    });
    render(
      <ControlModal
        control={makeControl({ id: "SA-15", oscalId: "sa-15" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("New in 5.2.0")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "(13) ZT new, Zero Trust mapped, new in 5.2.0",
      }),
    );
    expect(screen.getByText("New in 5.2.0")).toBeInTheDocument();
  });

  it("states the withdrawal in the copied text", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
    renderModal();
    openWithdrawnTab();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Copy Guidance Text/i }),
      );
    });
    const copied = writeTextMock.mock.calls[0]![0] as string;
    expect(copied).toContain("Control: AC-02(10)");
    expect(copied).toContain("Status: Withdrawn, incorporated into AC-02k");
  });
});

describe("WithdrawnZTPane", () => {
  const successor = (
    controlNumber: string,
    ztPillars: string[] | null,
    family = false,
  ) => ({
    controlNumber,
    kind: "incorporated-into" as const,
    family,
    part: null,
    ztPillars,
  });

  it("names only the successors that carry a mapping, and opens them", () => {
    const open = vi.fn();
    render(
      <WithdrawnZTPane
        lineage={{
          successors: [
            successor("AC-02", ["IDENTITY"]),
            successor("AU-06", null),
          ],
          incorporates: [],
          addedIn: null,
        }}
        onOpenControl={open}
      />,
    );
    expect(screen.queryByText("AU-06")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AC-02" }));
    expect(open).toHaveBeenCalledWith("ac-2");
  });

  it("says when no successor carries a mapping either", () => {
    render(
      <WithdrawnZTPane
        lineage={{
          successors: [successor("AU-06", null), successor("SR", null, true)],
          incorporates: [],
          addedIn: null,
        }}
      />,
    );
    expect(
      screen.getByText(/neither do the controls that took its content/),
    ).toBeInTheDocument();
  });

  it("says only that it carries none when no successor is recorded", () => {
    render(<WithdrawnZTPane lineage={null} />);
    expect(
      screen.getByText("A withdrawn control carries none."),
    ).toBeInTheDocument();
  });
});
