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
import type { ComponentProps } from "react";
import type * as NextLink from "next/link";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

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
    expect(screen.getByRole("option", { name: /AC-02/ })).toHaveAttribute(
      "href",
      "/control/AC-02?pillar=IDENTITY",
    );
    expect(screen.getByRole("option", { name: /AC-03/ })).toHaveAttribute(
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
    const link = screen.getByRole("option", { name: /AC-02/ });

    // A cancelled mouse-down keeps focus in the input, so its onBlur doesn't close the
    // dropdown before the click lands.
    expect(fireEvent.mouseDown(link)).toBe(false);
    expect(input).toHaveFocus();
    expect(link).toBeInTheDocument();

    // A click navigates (the link's own behaviour) and closes the dropdown.
    fireEvent.click(link);
    expect(screen.queryByText("AC-02")).not.toBeInTheDocument();
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "keeps the dropdown open on a click with %s held",
    async (modifier) => {
      // Link leaves a modified click to the browser, which opens the control elsewhere
      // and leaves this page as it was, so the list stays for the next result.
      renderTypeahead();
      await typeAndSettle("ac");

      await waitFor(() => {
        expect(screen.getByText("AC-02")).toBeInTheDocument();
      });
      // jsdom cannot open a tab, so it would load the address in place; the document
      // cancels that after Link and the component have seen the click.
      const cancelPageLoad = (e: Event) => e.preventDefault();
      document.addEventListener("click", cancelPageLoad);
      try {
        fireEvent.click(screen.getByRole("option", { name: /AC-02/ }), {
          [modifier]: true,
        });
      } finally {
        document.removeEventListener("click", cancelPageLoad);
      }
      expect(screen.getByText("AC-02")).toBeInTheDocument();
      expect(screen.getByText("AC-03")).toBeInTheDocument();
    },
  );

  it("turns prefetch off on every result", async () => {
    // With prefetch on, each result would ask the server for its control while the
    // reader is still typing.
    renderTypeahead();
    await typeAndSettle("ac");

    await waitFor(() => {
      expect(screen.getByText("AC-02")).toBeInTheDocument();
    });
    for (const name of [/AC-02/, /AC-03/]) {
      expect(screen.getByRole("option", { name })).toHaveAttribute(
        "data-prefetch",
        "false",
      );
    }
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

describe("SearchTypeahead under a Zero Trust filter", () => {
  const controls = [
    {
      id: "AC-02",
      name: "Account Management",
      status: "zt-via-enhancements",
      family: "AC",
      zeroTrust: [],
      enhancements: [
        {
          id: "AC-02(01)",
          name: "Automated System Account Management",
          zeroTrust: [
            { pillar: "IDENTITY", maturity: "ADVANCED", designation: "KEY" },
          ],
        },
        {
          id: "AC-02(03)",
          name: "Disable Accounts",
          zeroTrust: [
            { pillar: "DATA", maturity: "OPTIMAL", designation: "INFORMATIVE" },
          ],
        },
      ],
    },
  ];

  beforeEach(() => {
    mockUseQuery = vi.fn(() => ({
      data: { hits: HITS, matchingIds: HITS.map((h) => h.controlNumber) },
    }));
  });

  it("lists each matching enhancement after its base, linked to its own tab", async () => {
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?designation=KEY" }),
    });
    await typeAndSettle("ac");

    const link = await screen.findByRole("option", {
      name: "AC-02(01) Automated System Account Management, enhancement, matches filters",
    });
    expect(link).toHaveAttribute("href", "/control/AC-02(01)?pillar=IDENTITY");
    expect(screen.queryByText("AC-02(03)")).toBeNull();
    const ids = screen
      .getAllByRole("option")
      .map((a) => a.querySelector(".font-semibold")?.textContent);
    expect(ids).toEqual(["AC-02", "AC-02(01)", "AC-03"]);
  });

  it("lists at most 25 enhancements", async () => {
    const many = [
      {
        ...controls[0]!,
        enhancements: Array.from({ length: 30 }, (_, i) => ({
          id: `AC-02(${String(i + 1).padStart(2, "0")})`,
          name: `Enhancement ${i + 1}`,
          zeroTrust: [
            { pillar: "IDENTITY", maturity: "ADVANCED", designation: "KEY" },
          ],
        })),
      },
    ];
    render(<SearchTypeahead hrefFor={hrefFor} controls={many} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await typeAndSettle("ac");
    await screen.findByText("AC-02(01)");
    expect(screen.getAllByText(/^enhancement, matches filters$/)).toHaveLength(
      25,
    );
  });

  it("keeps a listed base's enhancements within the cap", async () => {
    const row = {
      pillar: "IDENTITY",
      maturity: "ADVANCED",
      designation: "KEY",
    };
    // AU-02 is no hit, but 30 of its enhancements match "audit" by name, ahead of AC-02's.
    const crowded = [
      {
        id: "AU-02",
        name: "Event Logging",
        status: "zt-via-enhancements",
        family: "AU",
        zeroTrust: [],
        enhancements: Array.from({ length: 30 }, (_, i) => ({
          id: `AU-02(${String(i + 1).padStart(2, "0")})`,
          name: `Audit ${i + 1}`,
          zeroTrust: [row],
        })),
      },
      {
        ...controls[0]!,
        enhancements: [{ id: "AC-02(01)", name: "One", zeroTrust: [row] }],
      },
    ];
    render(<SearchTypeahead hrefFor={hrefFor} controls={crowded} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await typeAndSettle("audit");
    expect(await screen.findByText("AC-02(01)")).toBeInTheDocument();
    expect(screen.getAllByText(/^enhancement, matches filters$/)).toHaveLength(
      25,
    );
  });

  it("lists no enhancement before the search answers", async () => {
    mockUseQuery = vi.fn(() => ({ data: undefined }));
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await typeAndSettle("AC-02(01)");
    await screen.findByText(/No controls match/);
    expect(screen.queryByText("AC-02(01)")).toBeNull();
  });

  it("lists no enhancements without one", async () => {
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "" }),
    });
    await typeAndSettle("ac");
    await screen.findByText("AC-02");
    expect(screen.queryByText("AC-02(01)")).toBeNull();
  });

  it("shows a matching enhancement when the search has no base hit", async () => {
    mockUseQuery = vi.fn(() => ({ data: { hits: [], matchingIds: [] } }));
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await typeAndSettle("AC-02(01)");
    expect(await screen.findByText("AC-02(01)")).toBeInTheDocument();
    expect(screen.queryByText(/No controls match/)).toBeNull();
    // Its base isn't listed, so it isn't drawn as if under another control.
    expect(screen.getByRole("option")).toHaveClass("pl-3");
  });

  it("lists no enhancement for a withdrawn result, which the diagram does not hold", async () => {
    mockUseQuery = vi.fn(
      (input: { q: string; includeWithdrawn?: boolean }) => ({
        data: {
          hits: input.includeWithdrawn
            ? [
                {
                  controlNumber: "AC-13",
                  controlName: "Supervision and Review",
                  matchedIn: "id",
                  withdrawn: true,
                },
              ]
            : [],
          matchingIds: [],
        },
      }),
    );
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Search withdrawn controls" }),
    );
    await typeAndSettle("AC-13");
    expect(await screen.findByText("AC-13")).toHaveClass("line-through");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByText("enhancement, matches filters")).toBeNull();
  });

  it("indents an enhancement under its listed base", async () => {
    render(<SearchTypeahead hrefFor={hrefFor} controls={controls} />, {
      wrapper: withNuqsTestingAdapter({ searchParams: "?pillar=IDENTITY" }),
    });
    await typeAndSettle("ac");
    const option = await screen.findByRole("option", { name: /^AC-02\(01\)/ });
    expect(option).toHaveClass("pl-6");
  });
});

describe("SearchTypeahead as a combobox", () => {
  beforeEach(() => {
    mockUseQuery = vi.fn(() => ({
      data: { hits: HITS, matchingIds: HITS.map((h) => h.controlNumber) },
    }));
  });

  it("names its list and says whether it is open", async () => {
    renderTypeahead();
    const box = screen.getByRole("combobox", { name: "Search controls" });
    expect(box).toHaveAttribute("aria-expanded", "false");
    await typeAndSettle("ac");
    await screen.findByRole("listbox", { name: "Search results" });
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
  });

  it("marks results with the arrow keys, wrapping at each end", async () => {
    renderTypeahead();
    const box = await typeAndSettle("ac");
    await screen.findByRole("listbox");
    const [first, second] = screen.getAllByRole("option");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", first!.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", second!.id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", first!.id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveAttribute("aria-activedescendant", second!.id);
  });

  it("opens the marked result on Enter", async () => {
    renderTypeahead();
    const box = await typeAndSettle("ac");
    await screen.findByRole("listbox");
    const clicked = vi.fn((e: Event) => e.preventDefault());
    screen.getAllByRole("option")[1]!.addEventListener("click", clicked);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("leaves the arrow keys and Enter to an input method while it composes", async () => {
    renderTypeahead();
    const box = await typeAndSettle("ac");
    await screen.findByRole("listbox");
    const clicked = vi.fn((e: Event) => e.preventDefault());
    screen.getAllByRole("option")[0]!.addEventListener("click", clicked);
    fireEvent.keyDown(box, { key: "ArrowDown", isComposing: true });
    expect(box).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(clicked).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    renderTypeahead();
    const box = await typeAndSettle("ac");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open while focus moves within it, and closes once focus leaves", async () => {
    renderTypeahead();
    const box = await typeAndSettle("ac");
    await screen.findByRole("listbox");
    fireEvent.blur(box, { relatedTarget: screen.getAllByRole("option")[0] });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.blur(box, { relatedTarget: document.body });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the results out of the tab order", async () => {
    renderTypeahead();
    await typeAndSettle("ac");
    await screen.findByRole("listbox");
    for (const option of screen.getAllByRole("option"))
      expect(option).toHaveAttribute("tabindex", "-1");
  });
});
