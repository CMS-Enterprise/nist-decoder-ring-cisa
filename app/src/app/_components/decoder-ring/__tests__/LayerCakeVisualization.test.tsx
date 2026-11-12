/**
 * Tests for the Bridge layer-cake LayerCakeVisualization filter behavior.
 *
 * When the filter is active, families with zero matching controls collapse (are not
 * rendered) and the header badge reads "Showing {matched} of {total} controls"; when
 * inactive the badge reads "{total} controls" and every family renders. When nothing
 * matches under an active filter, the empty state ("No controls match the current
 * filter.") shows.
 *
 * react-zoom-pan-pinch is mocked: TransformWrapper is a render-prop component whose
 * children is a function called with { zoomIn, zoomOut }, and it keeps its props so a
 * test can call the pan callbacks the library would; TransformComponent just renders its
 * children. jsdom lacks ResizeObserver, which the component constructs, so
 * a no-op stub is installed.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The render-prop children get { zoomIn, zoomOut } spies, captured here so a test can
// assert the zoom-control buttons invoke them. forwardRef is honoured so the component's
// transformRef is populated (with a state.scale + setTransform), letting fitContent run
// its geometry math instead of bailing on a null ref.
const zoomInSpy = vi.fn();
const zoomOutSpy = vi.fn();
const setTransformSpy = vi.fn();
// The latest props TransformWrapper was rendered with, for the pan callbacks.
const wrapperProps = vi.hoisted((): { current: Record<string, unknown> } => ({
  current: {},
}));

vi.mock("react-zoom-pan-pinch", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    TransformWrapper: forwardRef(
      (
        props: {
          children: (api: {
            zoomIn: () => void;
            zoomOut: () => void;
          }) => unknown;
        },
        ref: React.Ref<unknown>,
      ) => {
        const { children } = props;
        wrapperProps.current = props;
        useImperativeHandle(ref, () => ({
          state: { scale: 1 },
          setTransform: setTransformSpy,
        }));
        return <>{children({ zoomIn: zoomInSpy, zoomOut: zoomOutSpy })}</>;
      },
    ),
    // Rendered as a real element, not a fragment: the component measures against
    // `content.parentElement` because the library puts its contentStyle padding and its
    // transform on the same div. A fragment would leave that parent as some unrelated
    // ancestor and the geometry assertions would be testing the wrong element.
    TransformComponent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="transform-content">{children}</div>
    ),
  };
});

import LayerCakeVisualization from "../LayerCakeVisualization";
import type { NistControl, ControlFamily } from "../LayerCakeVisualization";
import type { FilterQuery } from "../filterPredicate";

// jsdom has no ResizeObserver; the component instantiates one in an effect. The stub
// keeps each callback so a test can fire a resize, which is the only way to observe that
// a deliberate recentre survives one.
const resizeCallbacks: ResizeObserverCallback[] = [];
function fireResize() {
  for (const cb of resizeCallbacks) cb([], {} as ResizeObserver);
}
beforeAll(() => {
  global.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
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

// The address each chip links to; DecoderRing builds the real one with controlHref.
const hrefFor = (id: string) => `/control/${id}`;

const EMPTY_QUERY: FilterQuery = {
  pillar: [],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "",
};

const IDENTITY_QUERY: FilterQuery = {
  pillar: ["IDENTITY"],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "",
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

// Family AC: one IDENTITY control (matches IDENTITY_QUERY).
const acFamily: ControlFamily = {
  id: "AC",
  name: "Access Control",
  controls: [control({ id: "AC-02", pillars: ["IDENTITY"] })],
};

// Family SC: one DATA-only control (no match under IDENTITY_QUERY).
const scFamily: ControlFamily = {
  id: "SC",
  name: "System and Communications Protection",
  controls: [
    control({
      id: "SC-08",
      name: "Transmission Confidentiality",
      pillars: ["DATA"],
      maturities: ["INITIAL"],
    }),
  ],
};

function familyHeader(id: string): HTMLElement | null {
  // Family header shows the family id as visible text.
  return screen.queryByText(id);
}

describe("LayerCakeVisualization — filter collapse + badge", () => {
  it("collapses zero-match families and keeps matched ones when active", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={IDENTITY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    // AC matches (IDENTITY control) → its column renders.
    expect(familyHeader("AC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^AC-02,/ })).toBeInTheDocument();

    // SC has no IDENTITY control → collapsed (not in the DOM).
    expect(familyHeader("SC")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^SC-08,/ }),
    ).not.toBeInTheDocument();
  });

  it("renders every family when the filter is inactive", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={IDENTITY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    expect(familyHeader("AC")).toBeInTheDocument();
    expect(familyHeader("SC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^AC-02,/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^SC-08,/ })).toBeInTheDocument();
  });

  it('badge reads "Showing N of M controls" when active', () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={IDENTITY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    // 1 match (AC-02) out of 2 total controls.
    expect(screen.getByText("Showing 1 of 2 controls")).toBeInTheDocument();
  });

  it('badge reads "{total} controls" when inactive', () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    expect(screen.getByText("2 controls")).toBeInTheDocument();
  });

  it("shows the empty state when an active filter matches nothing", () => {
    render(
      <LayerCakeVisualization
        families={[scFamily]} // only a DATA control; IDENTITY filter matches none
        query={IDENTITY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    expect(
      screen.getByText("No controls match the current filter."),
    ).toBeInTheDocument();
    // No family column shows: they stay laid out behind the message, hidden and inert.
    expect(familyHeader("SC")?.closest("[aria-hidden=true]")).toHaveAttribute(
      "inert",
    );
    // Badge still reflects 0 of total.
    expect(screen.getByText("Showing 0 of 1 controls")).toBeInTheDocument();
  });

  it("does not show the empty state when at least one family matches", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={IDENTITY_QUERY}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    expect(
      screen.queryByText("No controls match the current filter."),
    ).not.toBeInTheDocument();
  });

  it("keeps matched families and the count banner with reflow on", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={IDENTITY_QUERY}
        isActive={true}
        reflow={true}
        hrefFor={hrefFor}
      />,
    );

    // Matched family still renders; zero-match family is still collapsed.
    expect(familyHeader("AC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^AC-02,/ })).toBeInTheDocument();
    expect(familyHeader("SC")).not.toBeInTheDocument();

    // Reflow drops non-matching controls inside matched families too.
    expect(
      screen.queryByRole("link", { name: /^SC-08,/ }),
    ).not.toBeInTheDocument();

    // The count banner is computed from matches, independent of reflow.
    expect(screen.getByText("Showing 1 of 2 controls")).toBeInTheDocument();
  });
});

describe("LayerCakeVisualization — legend", () => {
  it("names each state with the glyph its chips carry", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "●ZT Aligned",
      "◆ZT Aligned + Enhancements",
      "▲ZT Enhancements",
      "○Not in CISA's mapping",
    ]);
  });
});

describe("LayerCakeVisualization — a pan that ends on a chip", () => {
  // The chip moves with the pointer during a pan, so the release lands on the chip
  // pressed and the browser fires a click on its link. The library reports the pan
  // through its callbacks, which these call with the events it would pass; the release
  // is the window's mouseup.
  function renderCake() {
    render(
      <LayerCakeVisualization
        families={[acFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    return screen.getByRole("link", { name: /^AC-02,/ });
  }

  type Callback = (ref: unknown, e: unknown) => void;
  const callback = (name: string) => wrapperProps.current[name] as Callback;
  const at = (x: number, y: number, isTrusted = true) => ({
    clientX: x,
    clientY: y,
    isTrusted,
  });
  // A mouse pan from the first point through the rest, released at the last.
  function pan(...points: Array<[number, number]>) {
    const [first, ...rest] = points;
    callback("onPanningStart")({}, at(...first!));
    for (const point of rest) callback("onPanning")({}, at(...point));
    fireEvent.mouseUp(window);
  }
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("cancels the click a pan ends with, so the link isn't followed", () => {
    const chip = renderCake();
    pan([100, 100], [140, 120], [180, 140]);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(false);
  });

  it("lets a click through when the pointer stayed within the slop", () => {
    const chip = renderCake();
    pan([100, 100], [102, 101]);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("cancels the click after a pan that came back to where it started", () => {
    const chip = renderCake();
    pan([100, 100], [200, 100], [101, 100]);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(false);
  });

  it("cancels a middle button's auxclick after a pan", () => {
    // A middle-button release on a link opens it in a new tab through auxclick.
    const chip = renderCake();
    pan([100, 100], [180, 140]);
    const auxclick = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    expect(fireEvent(chip, auxclick)).toBe(false);
  });

  it("lets a later click through after a pan released outside the canvas", async () => {
    // Released outside, the pan produces no click on a chip, and nothing waits for one.
    const chip = renderCake();
    pan([100, 100], [600, 400]);
    await nextTick();
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("lets a press's click through after a pan whose release was lost", () => {
    // The window lost focus mid-pan and the button was let go elsewhere, so no mouseup
    // came and a moved pan is left behind. The next press replaces it before its own
    // release, so that press's click goes through.
    const chip = renderCake();
    callback("onPanningStart")({}, at(100, 100));
    callback("onPanning")({}, at(180, 140));
    callback("onPanningStart")({}, at(300, 300));
    fireEvent.mouseUp(window);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("cancels only the one click a pan ends with", () => {
    const chip = renderCake();
    pan([100, 100], [180, 140]);
    fireEvent.click(chip, { detail: 1 });
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("ignores a touch pan, which produces no click to cancel", () => {
    // A finger's pan is not followed by a click, so it arms nothing for a later one.
    // The event carries coordinates of its own as well as its touches, so only the
    // guard's check for a touch keeps it from counting.
    const chip = renderCake();
    const touch = (x: number, y: number) => ({
      touches: [{ clientX: x, clientY: y }],
      clientX: x,
      clientY: y,
      isTrusted: true,
    });
    callback("onPanningStart")({}, touch(100, 100));
    callback("onPanning")({}, touch(180, 140));
    fireEvent.mouseUp(window);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("ignores the pans the library reports that are not the reader's", () => {
    // panBy reports a synthetic event, and each inertia frame after a release an
    // empty object. Neither is a trusted event, so neither starts or moves a pan.
    const chip = renderCake();
    callback("onPanningStart")({}, at(0, 0, false));
    callback("onPanning")({}, at(180, 140, false));
    fireEvent.mouseUp(window);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);

    // A synthetic start during the reader's pan does not start it over.
    callback("onPanningStart")({}, at(100, 100));
    callback("onPanning")({}, at(180, 140));
    callback("onPanningStart")({}, at(0, 0, false));
    fireEvent.mouseUp(window);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(false);

    // Nor does a synthetic or empty report count as the reader's pointer travelling.
    callback("onPanningStart")({}, at(100, 100));
    callback("onPanning")({}, at(0, 0, false));
    callback("onPanning")({}, {});
    fireEvent.mouseUp(window);
    expect(fireEvent.click(chip, { detail: 1 })).toBe(true);
  });

  it("opens a focused chip on Enter after a pan", async () => {
    const user = userEvent.setup();
    const chip = renderCake();
    pan([100, 100], [180, 140]);
    await nextTick();

    // Record whether the link's click survived the canvas, then stop jsdom loading the
    // address in place of the page.
    const followed: boolean[] = [];
    const record = (e: Event) => {
      followed.push(!e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener("click", record);
    try {
      chip.focus();
      await user.keyboard("{Enter}");
    } finally {
      document.removeEventListener("click", record);
    }
    expect(followed).toEqual([true]);
  });
});

describe("LayerCakeVisualization — count banner + zoom controls", () => {
  it("marks the count banner as an aria-live polite region", () => {
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    const banner = screen.getByText("2 controls");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("invokes the zoom + fit handlers from the control buttons", () => {
    zoomInSpy.mockClear();
    zoomOutSpy.mockClear();
    setTransformSpy.mockClear();

    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    fireEvent.click(screen.getByTitle("Zoom in"));
    expect(zoomInSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Zoom out"));
    expect(zoomOutSpy).toHaveBeenCalledTimes(1);

    // The recenter control centres the smallest family at a fixed readable scale and
    // pins the header row near the top, rather than fitting the whole diagram. Fitting
    // constrains on height, so the tallest family drives everything too small to read,
    // and it centres vertically, landing in the dead space below the short columns.
    //
    // jsdom gives every element a zero rect, which would make the geometry vacuous — x
    // computes to 0 whatever the formula says. Stub distinct rects so the arithmetic is
    // exercised, and assert the computed x rather than only the constants.
    const containerRect = { left: 0, top: 0, width: 1000, height: 600 };
    const originRect = { left: -100, top: -50, width: 2000, height: 3000 };
    const nodeRect = { left: 300, top: 150, width: 200, height: 400 };
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const el = this as HTMLElement;
        if (el.id?.startsWith("family-")) return nodeRect as DOMRect;
        if (el.dataset?.testid === "transform-content")
          return originRect as DOMRect;
        return containerRect as DOMRect;
      });

    // try/finally: a failed assertion must not leak the stubbed geometry into every
    // test that runs after this one.
    try {
      fireEvent.click(
        screen.getByTitle("Center the middle family, snap to top"),
      );
      expect(setTransformSpy).toHaveBeenCalledTimes(1);
      const call = setTransformSpy.mock.calls[0] as [
        number,
        number,
        number,
        number,
      ];
      const [x, y, scale] = call;

      // Recomputed independently. The mocked wrapper reports scale 1, so natural units
      // and rendered pixels coincide and the expected values stay readable.
      const nodeCentreX = nodeRect.left - originRect.left + nodeRect.width / 2;
      const nodeTop = nodeRect.top - originRect.top;
      expect(x).toBeCloseTo(containerRect.width / 2 - nodeCentreX * scale, 5);
      // y derives from the header's own offset. A regression that pins it to the bare
      // constant (y === 24) fails here, which is what let the padding bug through before.
      expect(y).toBeCloseTo(24 - nodeTop * scale, 5);
      expect(scale).toBeGreaterThan(0.5);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("keeps a deliberate recentre when the window resizes", () => {
    // A resize has no opinion about framing. It used to re-run the whole-diagram fit,
    // so opening devtools after pressing the reset control threw the view away.
    setTransformSpy.mockClear();
    resizeCallbacks.length = 0;

    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={EMPTY_QUERY}
        isActive={false}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );

    fireEvent.click(screen.getByTitle("Center the middle family, snap to top"));
    const afterClick = setTransformSpy.mock.calls.at(-1) as number[];
    expect(afterClick[2]).toBeCloseTo(0.8, 5);

    setTransformSpy.mockClear();
    fireResize();

    // Still the recentre scale, not a fit recomputed from the container.
    const afterResize = setTransformSpy.mock.calls.at(-1) as number[];
    expect(afterResize).toBeDefined();
    expect(afterResize[2]).toBeCloseTo(0.8, 5);
  });

  it("keeps the reader's zoom when a filtered cake re-renders", () => {
    // Under a filter the visible families are a new array each render. The resize
    // observer used to be re-created with them, and a new observer reports its starting
    // size, which re-fit the diagram: opening or closing a control (a URL change, so a
    // re-render) threw the reader's zoom and pan away.
    resizeCallbacks.length = 0;
    const props = {
      families: [acFamily, scFamily],
      isActive: true,
      reflow: false,
      hrefFor,
    };
    const { rerender } = render(
      <LayerCakeVisualization {...props} query={IDENTITY_QUERY} />,
    );
    const observers = resizeCallbacks.length;
    expect(observers).toBeGreaterThan(0);

    rerender(
      <LayerCakeVisualization {...props} query={{ ...IDENTITY_QUERY }} />,
    );
    expect(resizeCallbacks).toHaveLength(observers);
  });

  it("keeps the canvas, and the reader's view, through the empty state", async () => {
    // Unmounted for the empty state, the canvas came back as a new TransformWrapper at
    // its initial scale in the corner, then jumped when a fit caught up with it.
    const base = {
      families: [scFamily],
      reflow: false,
      hrefFor,
    };
    const { rerender } = render(
      <LayerCakeVisualization {...base} query={EMPTY_QUERY} isActive={false} />,
    );
    // Let the mount fit run first, so any later call is one this test caused.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const canvas = screen.getByTestId("transform-content");
    setTransformSpy.mockClear();

    rerender(
      <LayerCakeVisualization
        {...base}
        query={IDENTITY_QUERY}
        isActive={true}
      />,
    );
    expect(
      screen.getByText("No controls match the current filter."),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Zoom in")).not.toBeInTheDocument();
    expect(canvas.isConnected).toBe(true);

    rerender(
      <LayerCakeVisualization {...base} query={EMPTY_QUERY} isActive={false} />,
    );
    expect(screen.getByTestId("transform-content")).toBe(canvas);
    expect(
      screen.queryByText("No controls match the current filter."),
    ).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(setTransformSpy).not.toHaveBeenCalled();
  });

  it("holds the families last shown through the empty state, not every family", async () => {
    // Laid out hidden, every family made content bigger than the subset the reader left,
    // and the library clamped the view to it, so the subset came back somewhere else.
    const NO_MATCH: FilterQuery = { ...EMPTY_QUERY, q: "no control has this" };
    const base = { families: [acFamily, scFamily], reflow: false, hrefFor };
    const { rerender } = render(
      <LayerCakeVisualization
        {...base}
        query={IDENTITY_QUERY}
        isActive={true}
      />,
    );
    expect(familyHeader("AC")).toBeInTheDocument();
    expect(familyHeader("SC")).not.toBeInTheDocument();

    rerender(
      <LayerCakeVisualization {...base} query={NO_MATCH} isActive={true} />,
    );
    expect(
      screen.getByText("No controls match the current filter."),
    ).toBeInTheDocument();
    const hidden = screen.getByTestId("transform-content");
    expect(within(hidden).queryByText("AC")).toBeInTheDocument();
    expect(within(hidden).queryByText("SC")).not.toBeInTheDocument();
  });

  it("lays every family out behind an empty state with nothing shown before it", () => {
    // A link that matches nothing has no earlier families to hold.
    render(
      <LayerCakeVisualization
        families={[acFamily, scFamily]}
        query={{ ...EMPTY_QUERY, q: "no control has this" }}
        isActive={true}
        reflow={false}
        hrefFor={hrefFor}
      />,
    );
    const hidden = screen.getByTestId("transform-content");
    expect(within(hidden).queryByText("AC")).toBeInTheDocument();
    expect(within(hidden).queryByText("SC")).toBeInTheDocument();
  });

  it("animates a recenter + zoom when reflow toggles (collapse / show all)", async () => {
    setTransformSpy.mockClear();
    const base = {
      families: [acFamily, scFamily],
      query: IDENTITY_QUERY,
      isActive: true,
      hrefFor,
    };
    const { rerender } = render(
      <LayerCakeVisualization {...base} reflow={false} />,
    );
    // Toggling reflow re-fits the (now smaller / larger) content with a 300ms animation;
    // the mount fit is instant (animationMs 0), so a call with 300 proves the reflow path.
    rerender(<LayerCakeVisualization {...base} reflow={true} />);
    await waitFor(() => {
      const animated = setTransformSpy.mock.calls.some((c) => c[3] === 300);
      expect(animated).toBe(true);
    });
  });

  it("re-fits when the matched set changes while collapsed (reflow on)", async () => {
    const family: ControlFamily = {
      id: "AC",
      name: "Access Control",
      controls: [
        control({
          id: "AC-02",
          name: "Account Management",
          pillars: ["IDENTITY"],
        }),
        control({
          id: "AC-03",
          name: "Access Enforcement",
          pillars: ["IDENTITY"],
        }),
      ],
    };
    const base = {
      families: [family],
      isActive: true,
      reflow: true,
      hrefFor,
    };
    const { rerender } = render(
      <LayerCakeVisualization {...base} query={IDENTITY_QUERY} />,
    );
    setTransformSpy.mockClear();
    // Narrow from 2 matches to 1 while collapsed → matched set shrinks → animated re-fit.
    rerender(
      <LayerCakeVisualization
        {...base}
        query={{ ...IDENTITY_QUERY, q: "account" }}
      />,
    );
    await waitFor(() => {
      expect(setTransformSpy.mock.calls.some((c) => c[3] === 300)).toBe(true);
    });
  });
});
