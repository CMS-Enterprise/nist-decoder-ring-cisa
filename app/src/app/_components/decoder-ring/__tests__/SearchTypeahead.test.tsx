/**
 * Tests for SearchTypeahead — the "narrow + jump" search box.
 *
 * The component does double duty: it writes a 250ms-debounced term to the URL `q`
 * (via useDecoderQuery, which is URL-backed → every render is wrapped in
 * withNuqsTestingAdapter, the same pattern as FilterBar.test.tsx) AND it queries
 * decoder.searchControls to render a direct-navigation dropdown. The tRPC client is
 * mocked via vi.mock("~/trpc/react") with a getter exposing a module-level useQuery
 * mock, matching ControlModal.default.test.tsx.
 *
 * The debounce is a real 250ms setTimeout, so we use real timers + waitFor (polling)
 * to let it settle — fake timers would fight nuqs's async URL-write throttle queue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

// ---------------------------------------------------------------------------
// tRPC mock — hoisted so vi.mock() runs before the component import.
// ---------------------------------------------------------------------------

// Re-read on each call so per-test overrides are picked up.
let mockUseQuery: ReturnType<typeof vi.fn>;

vi.mock("~/trpc/react", () => ({
  api: {
    decoder: {
      searchControls: {
        get useQuery() {
          return mockUseQuery;
        },
      },
    },
  },
}));

// Import AFTER the mock is registered.
import SearchTypeahead from "../SearchTypeahead";
import { useDecoderQuery } from "../useDecoderQuery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Hit = { controlNumber: string; controlName: string; matchedIn: string };

const HITS: Hit[] = [
  {
    controlNumber: "AC-02",
    controlName: "Account Management",
    matchedIn: "id",
  },
  {
    controlNumber: "AC-03",
    controlName: "Access Enforcement",
    matchedIn: "name",
  },
];

// The address each result links to; DecoderRing builds the real one with controlHref.
const hrefFor = (id: string) => `/control/${id}?pillar=IDENTITY`;

// Render SearchTypeahead inside the nuqs testing adapter.
function renderTypeahead(props: { searchParams?: string } = {}) {
  const { searchParams = "" } = props;
  return render(<SearchTypeahead hrefFor={hrefFor} />, {
    wrapper: withNuqsTestingAdapter({ searchParams }),
  });
}

// Type into the search box and let the 250ms debounce settle (real timers).
async function typeAndSettle(value: string) {
  const input = screen.getByLabelText("Search controls");
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
  return input;
}

// A sibling control that clears the URL q via useDecoderQuery, standing in for the
// external clearers (FilterBar's "Clear all" / the search chip ×) so the sync effect's
// external-change branch can be exercised against a real shared URL store.
function ClearQButton() {
  const { setQuery } = useDecoderQuery();
  return (
    <button type="button" onClick={() => void setQuery({ q: "" })}>
      external clear
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SearchTypeahead without hrefFor", () => {
  it("narrows by its term but neither queries nor shows a dropdown", async () => {
    mockUseQuery = vi.fn(() => ({
      data: { hits: HITS, matchingIds: HITS.map((h) => h.controlNumber) },
    }));
    render(<SearchTypeahead />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "" }),
    });
    await typeAndSettle("ac");
    await waitFor(() =>
      expect(mockUseQuery).toHaveBeenLastCalledWith(
        { q: "ac" },
        { enabled: false },
      ),
    );
    expect(screen.queryByText("AC-02")).toBeNull();
  });
});

describe("SearchTypeahead", () => {
  beforeEach(() => {
    // Default: the query returns the canned hits regardless of args. Gating of the
    // dropdown is the component's own debounced.length >= 2 check, not the mock.
    mockUseQuery = vi.fn(() => ({
      data: { hits: HITS, matchingIds: HITS.map((h) => h.controlNumber) },
    }));
  });

  it("renders the search input", () => {
    renderTypeahead();
    expect(screen.getByLabelText("Search controls")).toBeInTheDocument();
  });

  it("shows the result dropdown after typing a >=2-char term", async () => {
    renderTypeahead();
    await typeAndSettle("ac");

    // The 250ms debounce must elapse before debounced.length >= 2 opens the dropdown.
    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    expect(screen.getByText("Account Management")).toBeInTheDocument();
    expect(screen.getByText("AC-03")).toBeInTheDocument();
  });

  it("links each result to its control's address", async () => {
    renderTypeahead();
    await typeAndSettle("ac");

    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /AC-02/ })).toHaveAttribute(
      "href",
      "/control/AC-02?pillar=IDENTITY",
    );
    expect(screen.getByRole("link", { name: /AC-03/ })).toHaveAttribute(
      "href",
      "/control/AC-03?pillar=IDENTITY",
    );
  });

  it("keeps focus in the box on mouse-down and closes the dropdown on the click", async () => {
    renderTypeahead();
    const input = await typeAndSettle("ac");
    input.focus();

    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    const link = screen.getByRole("link", { name: /AC-02/ });

    // A cancelled mouse-down keeps focus in the input, so its onBlur doesn't close the
    // dropdown before the click lands.
    expect(fireEvent.mouseDown(link)).toBe(false);
    expect(input).toHaveFocus();
    expect(link).toBeInTheDocument();

    // A click navigates (the link's own behaviour) and closes the dropdown.
    fireEvent.click(link);
    expect(screen.queryByText("AC-02")).not.toBeInTheDocument();
  });

  it("does not show a dropdown for a <2-char term", async () => {
    renderTypeahead();
    await typeAndSettle("a");

    // Give the debounce time to settle, then assert nothing rendered.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText("AC-02")).not.toBeInTheDocument();
    expect(screen.queryByText("Account Management")).not.toBeInTheDocument();
  });

  it("renders the empty-state message when the query returns no hits", async () => {
    mockUseQuery = vi.fn(() => ({ data: { hits: [], matchingIds: [] } }));
    renderTypeahead();
    await typeAndSettle("zz");

    await waitFor(() => {
      expect(screen.getByText(/No controls match/)).toBeInTheDocument();
    });
  });

  it("searches current controls only until withdrawn ones are asked for", async () => {
    mockUseQuery = vi.fn(
      (input: { q: string; includeWithdrawn?: boolean }) => ({
        data: {
          hits: input.includeWithdrawn
            ? [
                ...HITS,
                {
                  controlNumber: "AC-13",
                  controlName: "Supervision and Review",
                  matchedIn: "id",
                  withdrawn: true,
                },
              ]
            : HITS,
          matchingIds: HITS.map((h) => h.controlNumber),
        },
      }),
    );
    renderTypeahead();
    const toggle = screen.getByRole("checkbox", {
      name: "Search withdrawn controls",
    });
    expect(toggle).not.toBeChecked();
    await typeAndSettle("ac");
    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    // The default request carries no flag, so it is the one the diagram reads.
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      { q: "ac" },
      expect.anything(),
    );
    expect(screen.queryByText("AC-13")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(mockUseQuery).toHaveBeenLastCalledWith(
      { q: "ac", includeWithdrawn: true },
      expect.anything(),
    );
    const withdrawn = screen.getByText("AC-13");
    expect(withdrawn).toHaveClass("line-through");
    expect(screen.getByText("withdrawn")).toBeInTheDocument();
    expect(withdrawn.closest("a")).toHaveAttribute("href", hrefFor("AC-13"));
  });

  it("labels each hit by how it matched", async () => {
    renderTypeahead();
    await typeAndSettle("ac");

    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    // MATCH_LABELS maps the raw matchedIn token to a human label.
    expect(screen.getByText("control number")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
  });

  it("initializes the input from the URL q", () => {
    // The input seeds its text from query.q (useState(query.q)), so a deep-linked
    // ?q=audit pre-fills the box without any typing.
    renderTypeahead({ searchParams: "?q=audit" });
    expect(screen.getByLabelText("Search controls")).toHaveValue("audit");
  });

  it("reflects an external q clear back into the input", async () => {
    // Render the typeahead alongside a sibling that clears q via the same URL store.
    // The sync effect must notice the external q change (q !== lastPushed) and reset
    // the input text, without clobbering in-flight typing.
    //
    // hasMemory makes the adapter keep each write, as a browser URL does. Without it
    // the adapter keeps answering ?q=audit, and nuqs 2.9+ re-reads that during render:
    // the clear is undone, the sync effect sees "audit" again, and the two writes
    // alternate forever. That loop belongs to the stand-in, not to the component.
    render(
      <>
        <SearchTypeahead hrefFor={hrefFor} />
        <ClearQButton />
      </>,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?q=audit",
          hasMemory: true,
        }),
      },
    );

    const input = screen.getByLabelText("Search controls");
    expect(input).toHaveValue("audit");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "external clear" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });
});
