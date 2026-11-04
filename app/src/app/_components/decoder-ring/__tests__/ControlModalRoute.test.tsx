/**
 * ControlModalRoute: the modal for the control the address names.
 *
 * Mocks:
 *  - next/navigation: closing is a router.push to "/" with the filters; the spy
 *    records where.
 *  - ~/trpc/react: getBridgeData returns a one-control dataset, getControlById a
 *    minimal loaded detail so the modal shell renders (pattern from DecoderRing.test.tsx).
 *
 * The filters come from the address through withNuqsTestingAdapter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

let mockBridgeQuery: ReturnType<typeof vi.fn>;
let mockControlByIdQuery: ReturnType<typeof vi.fn>;

vi.mock("~/trpc/react", () => ({
  api: {
    decoder: {
      getBridgeData: {
        get useQuery() {
          return mockBridgeQuery;
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

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Import AFTER mocks are registered.
import ControlModalRoute from "../ControlModalRoute";
import InterceptedControlNotFound from "~/app/@modal/(.)control/[id]/not-found";
import InterceptedControlError from "~/app/@modal/(.)control/[id]/error";
import InterceptedControlLoading from "~/app/@modal/(.)control/[id]/loading";
import ControlError from "~/app/(cake)/control/[id]/error";
import ControlNotFound from "~/app/(cake)/control/[id]/not-found";

const AC_02 = {
  id: "AC-02",
  oscalId: "ac-2",
  name: "Account Management",
  status: "zero-trust-aligned",
  family: "AC",
  pillars: ["IDENTITY"],
  maturities: ["ADVANCED"],
  functions: [],
};

const BRIDGE_DATA = {
  version: "NIST SP 800-53 Rev 5",
  families: [{ id: "AC", name: "Access Control", controls: [AC_02] }],
};

const DETAIL = {
  id: "AC-02",
  name: "Account Management",
  description: "",
  baselines: [],
  discussion: null,
  reviewFrequency: null,
  assessmentFrequency: null,
  priority: null,
  status: "zero-trust-aligned",
  parts: [],
  ztLinks: [],
  nistLinks: [],
  ztMapping: null,
  enhancements: [],
};

/** A withdrawn control. The cake lists live controls only, so BRIDGE_DATA leaves it out. */
function withdrawnDetail(
  id: string,
  name: string,
  successors: Array<{ controlNumber: string; family: boolean; part?: string }>,
) {
  return {
    ...DETAIL,
    id,
    name,
    status: "compliance",
    catalogStatus: "withdrawn",
    lineage: {
      successors: successors.map((s) => ({ ...s, kind: "incorporated-into" })),
      incorporates: [],
      addedIn: null,
    },
  };
}

function renderRoute(id = "AC-02", searchParams = "?pillar=IDENTITY") {
  return render(<ControlModalRoute id={id} />, {
    wrapper: withNuqsTestingAdapter({ searchParams }),
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockBridgeQuery = vi.fn(() => ({ data: BRIDGE_DATA }));
  mockControlByIdQuery = vi.fn(() => ({ data: DETAIL, isLoading: false }));
});

describe("ControlModalRoute", () => {
  it("renders the modal for the control the address names", () => {
    renderRoute();
    expect(screen.getByText("Copy Guidance Text")).toBeInTheDocument();
    expect(screen.getAllByText("Account Management").length).toBeGreaterThan(0);
  });

  it("starts the modal from the detail the server fetched", () => {
    render(<ControlModalRoute id="AC-02" detail={DETAIL as never} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "" }),
    });
    expect(mockControlByIdQuery).toHaveBeenCalledWith(
      { controlId: "AC-02" },
      { initialData: DETAIL },
    );
  });

  it("opens a control the cake doesn't list, a withdrawn one, from the detail the server fetched", () => {
    const ac13 = withdrawnDetail("AC-13", "Supervision and Review", [
      { controlNumber: "AC-02", family: false },
    ]);
    mockControlByIdQuery = vi.fn(() => ({ data: ac13, isLoading: false }));
    render(<ControlModalRoute id="AC-13" detail={ac13 as never} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "AC-13",
    );
    expect(screen.getByTestId("withdrawn-notice")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "This control isn't on the diagram",
      }),
    ).not.toBeInTheDocument();
  });

  it("follows a withdrawn control's successor to its address, with the filters", async () => {
    const ac13 = withdrawnDetail("AC-13", "Supervision and Review", [
      { controlNumber: "AC-02", family: false },
    ]);
    mockControlByIdQuery = vi.fn(() => ({ data: ac13, isLoading: false }));
    render(<ControlModalRoute id="AC-13" detail={ac13 as never} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("withdrawn-notice")).getByRole("button", {
          name: "AC-02",
        }),
      );
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/control/AC-02?pillar=IDENTITY");
  });

  it("lands on the successor's item in another control, in the same push", async () => {
    // Remounted for the new id, the modal could only keep the item through the address.
    const ac13 = withdrawnDetail("AC-13", "Supervision and Review", [
      { controlNumber: "AC-02", family: false, part: "ac-2_smt.k" },
    ]);
    mockControlByIdQuery = vi.fn(() => ({ data: ac13, isLoading: false }));
    render(<ControlModalRoute id="AC-13" detail={ac13 as never} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("withdrawn-notice")).getByRole("button", {
          name: "AC-02k",
        }),
      );
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      "/control/AC-02?pillar=IDENTITY&item=k",
    );
  });

  it("pushes the cake filtered to a successor that is a whole family", async () => {
    const sa12 = withdrawnDetail("SA-12", "Supply Chain Protection", [
      { controlNumber: "SR", family: true },
    ]);
    mockControlByIdQuery = vi.fn(() => ({ data: sa12, isLoading: false }));
    render(<ControlModalRoute id="SA-12" detail={sa12 as never} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("withdrawn-notice")).getByRole("button", {
          name: "SR",
        }),
      );
    });
    // A push, so Back returns to the withdrawn control; the filters it had are kept.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const [href] = mockPush.mock.calls[0]! as [string];
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("family")).toBe("SR");
    expect(url.searchParams.get("pillar")).toBe("IDENTITY");
  });

  it("says so when the cake does not list the control, rather than showing nothing", async () => {
    renderRoute("ZZ-01");
    expect(
      screen.getByRole("dialog", { name: "This control isn't on the diagram" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Copy Guidance Text")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
  });

  it("closes once per Escape on that dialog, not once per listener", async () => {
    renderRoute("ZZ-01");
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    // The route and the dialog it renders used to listen separately, so one press
    // pushed twice and only the router's dedupe hid it.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
  });

  it("renders nothing while the bridge data is still loading", () => {
    mockBridgeQuery = vi.fn(() => ({ data: undefined }));
    const { container } = renderRoute();
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores Escape while the bridge data is still loading, with nothing on screen", async () => {
    mockBridgeQuery = vi.fn(() => ({ data: undefined }));
    renderRoute();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("closes to the cake with the current filters, as a push", async () => {
    renderRoute();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
  });

  it("closes to a bare / when no filter is set", async () => {
    renderRoute("AC-02", "");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("closes on Escape the same way", async () => {
    renderRoute();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
    // Once: a second listener on the modal's path would push twice.
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("stops listening for Escape once no modal is open", async () => {
    const { unmount } = renderRoute();
    unmount();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("re-resolves the open control when the bridge query returns new objects", () => {
    // The regression this pins. Selection used to be held as the control object itself, captured from whatever the query had returned at click time. A refetch replaces every object in the dataset, and a held copy keeps pointing at the old one — so an open modal would go on rendering data the rest of the page had already replaced.
    //
    // `staleTime: Infinity` reads like protection and is not: invalidation overrides staleTime rather than respecting it, so a single `invalidateQueries` on this key is enough. Nothing invalidates today, which is exactly why this needs a test rather than a comment — the change that introduces one will be about something else entirely.
    mockControlByIdQuery = vi.fn(() => ({ data: undefined, isLoading: false }));
    const { rerender } = renderRoute();
    expect(screen.getAllByText("Account Management").length).toBeGreaterThan(0);

    // The refetch: same control, same identifier, new objects and a corrected name.
    mockBridgeQuery = vi.fn(() => ({
      data: {
        ...BRIDGE_DATA,
        families: [
          {
            ...BRIDGE_DATA.families[0]!,
            controls: [{ ...AC_02, name: "Account Management (revised)" }],
          },
        ],
      },
    }));
    rerender(<ControlModalRoute id="AC-02" />);

    // Follows the new data rather than the copy taken at open time.
    expect(
      screen.getAllByText("Account Management (revised)").length,
    ).toBeGreaterThan(0);
  });
});

describe("an id that is not a control", () => {
  it.each([
    ["the @modal slot", InterceptedControlNotFound],
    ["the direct-load page", ControlNotFound],
  ])(
    "%s shows a dialog over the cake that closes back to it with the filters",
    async (_, Boundary) => {
      render(<Boundary />, {
        wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
      });
      expect(
        screen.getByRole("dialog", { name: "No control by that ID" }),
      ).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Back to all controls" }),
        );
      });
      expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
    },
  );
});

describe("a control that failed to load", () => {
  it.each([
    ["the @modal slot", InterceptedControlError],
    ["the direct-load page", ControlError],
  ])(
    "%s shows a dialog that retries, or closes back to the cake",
    async (_, Boundary) => {
      const retry = vi.fn();
      render(<Boundary error={new Error("db down")} retry={retry} />, {
        wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
      });
      const dialog = screen.getByRole("dialog", {
        name: "This control didn't load",
      });
      // The error's own message never reaches the page.
      expect(dialog).not.toHaveTextContent("db down");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Back to all controls" }),
        );
      });
      expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
    },
  );
});

describe("the @modal slot while an open is pending", () => {
  it("shows the modal's frame at once, and closes back to the cake", async () => {
    render(<InterceptedControlLoading />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    expect(
      screen.getByRole("dialog", { name: "Loading control" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading control");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/?pillar=IDENTITY");
  });
});
