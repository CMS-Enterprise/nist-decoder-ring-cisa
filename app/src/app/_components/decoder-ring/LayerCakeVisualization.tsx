"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useEffectEvent,
  useState,
} from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import FamilyColumn, { ZT_STATES } from "./FamilyColumn";
import { matchesQuery, type FilterQuery } from "./filterPredicate";
import { product } from "~/config/product";

/**
 * The identifier a selection is held by.
 *
 * `oscalId` is the stable one: it names the control in the OSCAL catalog and survives the display number being re-spelled or re-padded.
 *
 * The column is nullable, so this falls back to the display number rather than returning null and making callers handle a case the catalog does not currently produce. Total by construction, which is what lets the caller treat it as a key.
 */
export function controlKey(
  control: Pick<NistControl, "id" | "oscalId">,
): string {
  return control.oscalId ?? control.id;
}

export interface NistControl {
  id: string;
  /** The OSCAL identifier. Nullable at the column, so callers go through `controlKey`. */
  oscalId: string | null;
  name: string;
  status:
    | "compliance"
    | "zero-trust-aligned"
    | "zt-aligned-with-enhancements"
    | "zt-via-enhancements";
  family: string;
  pillars: string[];
  maturities: string[];
  functions: string[];
  /** CISA's designations across the control's tuples. */
  designations?: string[];
  /** The catalog baselines that include the control. */
  baselines?: string[];
  ztMapping?: {
    pillar: string;
    function: string;
    maturity: string;
    guidance: string;
  };
}

export interface ControlFamily {
  id: string;
  name: string;
  controls: NistControl[];
}

interface LayerCakeVisualizationProps {
  families: ControlFamily[];
  query: FilterQuery;
  /** Control numbers the server matched on prose the diagram's dataset does not carry. */
  textMatches?: ReadonlySet<string>;
  isActive: boolean;
  reflow: boolean;
  /** A control's address, by control number; each chip links to it. */
  hrefFor: (controlNumber: string) => string;
}

export default function LayerCakeVisualization({
  families,
  query,
  textMatches,
  isActive,
  reflow,
  hrefFor,
}: LayerCakeVisualizationProps) {
  const totalControls = families.reduce(
    (sum, family) => sum + family.controls.length,
    0,
  );

  // While filtering, collapse families with zero matches; matched families keep their
  // frozen mountain position (non-matching controls dim within them — see FamilyColumn).
  const visibleFamilies = isActive
    ? families.filter((family) =>
        family.controls.some((control) =>
          matchesQuery(control, query, textMatches),
        ),
      )
    : families;
  const empty = visibleFamilies.length === 0;
  // The families last shown, by id, so the empty state can keep them laid out (below).
  const shownIds = visibleFamilies.map((family) => family.id).join(" ");
  const [lastShownIds, setLastShownIds] = useState(shownIds);
  if (!empty && shownIds !== lastShownIds) setLastShownIds(shownIds);
  const lastShown = families.filter((family) =>
    lastShownIds.split(" ").includes(family.id),
  );
  const matchedCount = isActive
    ? visibleFamilies.reduce(
        (sum, family) =>
          sum +
          family.controls.filter((control) =>
            matchesQuery(control, query, textMatches),
          ).length,
        0,
      )
    : totalControls;

  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Gap left between the container's top edge and the header row after a recenter.
  // Measured to the header itself, not to the transform origin — the content padding
  // sits between the two, so pinning the origin here would put the header ~43px down.
  const TOP_GUTTER = 24;

  const fitContent = useCallback((animateMs = 0) => {
    if (!transformRef.current || !containerRef.current || !contentRef.current)
      return;

    const currentScale = transformRef.current.state.scale;
    const containerRect = containerRef.current.getBoundingClientRect();
    // Measure the element the library transforms, not our inner div. The two differ by
    // the contentStyle padding, and positioning one from the other's dimensions is the
    // same error recenter carried: it centres the inner box and leaves the padding out.
    const origin = contentRef.current.parentElement ?? contentRef.current;
    const contentRect = origin.getBoundingClientRect();

    const naturalWidth = contentRect.width / currentScale;
    const naturalHeight = contentRect.height / currentScale;

    const padding = 48;
    const scale = Math.min(
      (containerRect.width - padding) / naturalWidth,
      (containerRect.height - padding) / naturalHeight,
      1,
    );

    const x = (containerRect.width - naturalWidth * scale) / 2;
    const y = (containerRect.height - naturalHeight * scale) / 2;

    // setTransform resolves when the animation finishes; nothing here waits
    // on it, so the promise is explicitly discarded rather than left floating.
    void transformRef.current.setTransform(x, y, scale, animateMs);
  }, []);

  /**
   * The reset control centres the smallest family and snaps to the top of the mountain.
   *
   * It deliberately does not fit the whole diagram. `fitContent` constrains on both axes,
   * and the tallest family runs to twenty-odd controls, so height decides the scale and
   * everything lands too small to read. Worse, fitting centres vertically too, which on a
   * diagram this tall drops you into the dead space beneath the shortest columns — under
   * the bridge — with no header in sight.
   *
   * `arrangeMountain` sorts descending and deals alternately into left and right, so the
   * middle of the arrangement is the smallest family — while everything is showing.
   * Under a filter it is simply the middle of what remains, which is still the useful
   * place to land; the title says "middle" rather than "smallest" for that reason.
   * Centring there puts the peak of the mountain either side of you and leaves the
   * neighbours one pan away in each direction.
   * The vertical position is pinned to the top rather than centred, so the header row is
   * always the first thing in view.
   *
   * setTransform rather than zoomToElement: the latter frames an element by centring it on
   * both axes, which is the vertical behaviour being avoided here.
   */
  // Which view the user last chose, so a resize re-applies it instead of overriding it.
  // Mount and the collapse/show-all toggle both legitimately fit — the content's shape
  // changed — but a window resize has no opinion about framing and should not discard one.
  const viewMode = useRef<"fit" | "recenter">("fit");

  const RECENTER_SCALE = 0.8;
  const recenter = useCallback(() => {
    const wrapper = transformRef.current;
    const container = containerRef.current;
    const content = contentRef.current;
    if (!wrapper || !container || !content) return;

    viewMode.current = "recenter";
    const middle = visibleFamilies[Math.floor(visibleFamilies.length / 2)];
    const node = middle
      ? content.querySelector<HTMLElement>(`#family-${middle.id}`)
      : null;
    // No column to aim at (an empty or filtered-out set) — fall back to the whole-diagram
    // fit rather than leaving the view wherever it happened to be.
    if (!node) return fitContent(300);

    // Measure against the element the library actually transforms, which is `content`'s
    // PARENT: TransformComponent spreads contentStyle onto the same div it puts the
    // transform on, so our own content div sits inside that padding. Measuring from our
    // div instead leaves the padding out of the sums — worth ~19px at this scale — and
    // ties the arithmetic to a padding value it would not notice changing.
    const origin = content.parentElement ?? content;

    const currentScale = wrapper.state.scale;
    const originRect = origin.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Rects are rendered pixels; divide out the live scale for natural coordinates.
    // setTransform positions the origin, so a natural offset scales by the TARGET scale.
    const nodeCentreX =
      (nodeRect.left - originRect.left + nodeRect.width / 2) / currentScale;
    const nodeTop = (nodeRect.top - originRect.top) / currentScale;

    const x = containerRect.width / 2 - nodeCentreX * RECENTER_SCALE;
    const y = TOP_GUTTER - nodeTop * RECENTER_SCALE;

    void wrapper.setTransform(x, y, RECENTER_SCALE, 300);
  }, [visibleFamilies, fitContent]);

  // Fit on mount and whenever families change
  useEffect(() => {
    const timer = setTimeout(fitContent, 50);
    return () => clearTimeout(timer);
  }, [fitContent, families]);

  // Re-fit on container resize.
  //
  // The observer calls `recenter` through an effect event, so the observer is created
  // once and never depends on it.
  // Under a filter `visibleFamilies` is a new array on every render, so `recenter` is a
  // new function each time, and a dependency on it re-created the observer on any
  // re-render (opening or closing a control changes the URL, which re-renders the cake).
  // A new ResizeObserver reports the size it starts with, and that report re-fit the
  // diagram, discarding the reader's zoom and pan.
  const onResize = useEffectEvent(() =>
    viewMode.current === "recenter" ? recenter() : fitContent(),
  );
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => onResize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Recenter + rescale (animated) when the visible content resizes: on a Collapse-to-
  // matches / Show-all toggle, and on a filter change WHILE collapsed (the matched set
  // grew/shrank). In dim mode (reflow off, not a toggle) leave the view alone so the
  // user's pan/zoom is preserved. Skipped on first render; the mount effect already fits.
  const didReflowMount = useRef(false);
  const prevReflow = useRef(reflow);
  useEffect(() => {
    if (!didReflowMount.current) {
      didReflowMount.current = true;
      prevReflow.current = reflow;
      return;
    }
    const toggled = prevReflow.current !== reflow;
    prevReflow.current = reflow;
    if (!toggled && !reflow) return;
    viewMode.current = "fit";
    const timer = setTimeout(() => fitContent(300), 60);
    return () => clearTimeout(timer);
  }, [fitContent, reflow, matchedCount]);

  // The chips are links, and a pan that starts and ends on one would otherwise follow
  // it: the chip moves with the pointer, so the release lands on the chip pressed. The
  // pan library reports where each mouse pan starts and each move after; a pan whose
  // pointer went further than DRAG_SLOP from where it started, at any point, has moved.
  // The window's mouseup ends it, the one event every release produces, even when the
  // library has already let the pan go (the pointer left the document, or the window
  // lost focus). A moved pan's mouseup cancels the click, or a middle button's
  // auxclick, that its release produces; Next's Link skips a default-prevented click.
  // That click comes straight after the release, before any timer, so the cancel lasts
  // one tick: a click with no pan behind it (Enter on a focused chip, a screen reader's
  // activate, a later click) always goes through. Only the reader's mouse counts: a
  // touch pan produces no click to cancel, and the library's own reports (a synthetic
  // event from panBy, an empty object on each inertia frame) are not trusted events.
  const DRAG_SLOP = 5;
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const cancelNextClick = useRef(false);
  const readersMouse = (e: MouseEvent | TouchEvent) =>
    e.isTrusted && !("touches" in e) ? e : undefined;
  // Each press replaces the last pan, below, and that is what keeps a lost release
  // harmless. If the window loses focus mid-pan and the button is let go elsewhere, the
  // page sees no mouseup, and a moved pan is left behind. The next press on the canvas
  // replaces it before its own release, so a chip's click goes through. The zoom buttons
  // are outside the area the library pans from, so a stale pan can cancel their click,
  // but a button's click has no default action to cancel and the zoom still happens.
  const onPanningStart = (
    _: ReactZoomPanPinchRef,
    e: MouseEvent | TouchEvent,
  ) => {
    const at = readersMouse(e);
    if (at) pan.current = { x: at.clientX, y: at.clientY, moved: false };
  };
  const onPanning = (_: ReactZoomPanPinchRef, e: MouseEvent | TouchEvent) => {
    const start = pan.current;
    const at = readersMouse(e);
    if (
      start &&
      at &&
      Math.hypot(at.clientX - start.x, at.clientY - start.y) > DRAG_SLOP
    )
      start.moved = true;
  };
  useEffect(() => {
    const endPan = () => {
      const moved = pan.current?.moved ?? false;
      pan.current = null;
      if (!moved) return;
      cancelNextClick.current = true;
      setTimeout(() => {
        cancelNextClick.current = false;
      }, 0);
    };
    window.addEventListener("mouseup", endPan);
    return () => window.removeEventListener("mouseup", endPan);
  }, []);
  const cancelClickAfterPan = (e: React.MouseEvent) => {
    if (!cancelNextClick.current) return;
    cancelNextClick.current = false;
    e.preventDefault();
  };

  return (
    <section className="px-4 py-4">
      {/* Header row */}
      <div className="mx-auto mb-3 flex max-w-[96rem] items-center justify-between">
        <h2 className="text-ink flex items-center gap-2 text-xl font-bold">
          <span className="bg-accent h-8 w-2 rounded-full"></span>
          {product.familiesHeading}
          <span
            aria-live="polite"
            className="bg-surface-muted text-ink-muted rounded-full px-3 py-1 text-sm font-medium"
          >
            {isActive
              ? `Showing ${matchedCount} of ${totalControls} controls`
              : `${totalControls} controls`}
          </span>
        </h2>

        {/* Legend: the chips' own color and glyph for each state, from the same list. */}
        <ul className="flex flex-wrap gap-4 text-xs font-medium">
          {ZT_STATES.map((state) => (
            <li key={state.status} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[9px] ${state.chip}`}
              >
                {state.glyph}
              </span>
              <span className="text-ink-muted">
                {state.label ?? product.baselineChipLabel}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Zoom/Pan Canvas */}
      <div
        ref={containerRef}
        className="border-border bg-surface-canvas relative mx-auto max-w-[96rem] overflow-hidden rounded-xl border"
        style={{ height: "65vh" }}
        onClickCapture={cancelClickAfterPan}
        onAuxClickCapture={cancelClickAfterPan}
      >
        {/* The empty state covers the canvas rather than replacing it. Unmounted, the
            canvas would come back as a new TransformWrapper at its initial scale in the
            corner, then jump when a fit caught up; kept, it comes back where the reader
            left it. */}
        {empty ? (
          <div className="bg-surface-canvas absolute inset-0 z-20 flex items-center justify-center">
            <div className="text-center">
              <p className="text-ink-muted text-lg">
                No controls match the current filter.
              </p>
              <p className="text-ink-muted mt-2 text-sm">
                Try selecting a different filter option.
              </p>
            </div>
          </div>
        ) : null}
        <TransformWrapper
          ref={transformRef}
          initialScale={0.5}
          minScale={0.1}
          maxScale={2}
          wheel={{ step: 0.05 }}
          smooth
          onPanningStart={onPanningStart}
          onPanning={onPanning}
        >
          {({ zoomIn, zoomOut }) => (
            <>
              {/* Zoom Controls */}
              {empty ? null : (
                <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
                  <button
                    onClick={() => zoomIn()}
                    className="border-border-strong bg-surface text-ink hover:bg-surface-muted flex h-8 w-8 items-center justify-center rounded border text-sm font-bold shadow-sm"
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    onClick={() => zoomOut()}
                    className="border-border-strong bg-surface text-ink hover:bg-surface-muted flex h-8 w-8 items-center justify-center rounded border text-sm font-bold shadow-sm"
                    title="Zoom out"
                  >
                    −
                  </button>
                  <button
                    onClick={recenter}
                    className="border-border-strong bg-surface text-ink-muted hover:bg-surface-muted flex h-8 w-8 items-center justify-center rounded border text-xs shadow-sm"
                    title="Center the middle family, snap to top"
                  >
                    ⊙
                  </button>
                </div>
              )}

              {/* Hint */}
              {empty ? null : (
                <div className="bg-surface/80 text-ink-muted absolute bottom-3 left-3 z-10 rounded px-2 py-1 text-xs shadow-sm">
                  Scroll to zoom · Drag to pan
                </div>
              )}

              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ padding: "24px" }}
              >
                {/* With nothing matching, the families last shown stay laid out, hidden:
                    emptied, the content would shrink to its padding and the library would
                    pull the view back inside those bounds, to the corner. Holding the same
                    families, rather than every one, keeps the content the size the reader
                    left, so the view comes back where it was. With nothing shown yet, as
                    on a link that matches nothing, every family stands in. Under Collapse
                    to matches the hidden columns shrink to their placeholders, and the
                    re-fit on the way out covers that. */}
                <div
                  ref={contentRef}
                  className={`flex gap-6 ${empty ? "invisible" : ""}`}
                  aria-hidden={empty || undefined}
                  inert={empty}
                >
                  {(empty
                    ? lastShown.length > 0
                      ? lastShown
                      : families
                    : visibleFamilies
                  ).map((family) => (
                    <FamilyColumn
                      key={family.id}
                      family={family}
                      query={query}
                      textMatches={textMatches}
                      isActive={isActive}
                      reflow={reflow}
                      hrefFor={hrefFor}
                    />
                  ))}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </section>
  );
}
