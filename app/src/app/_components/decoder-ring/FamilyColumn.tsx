"use client";

import Link from "next/link";

import { product } from "~/config/product";

import type { ControlFamily } from "./LayerCakeVisualization";
import { matchesQuery, type FilterQuery } from "./filterPredicate";

interface FamilyColumnProps {
  family: ControlFamily;
  query: FilterQuery;
  /** Control numbers the server matched on prose the diagram's dataset does not carry. */
  textMatches?: ReadonlySet<string>;
  isActive: boolean;
  reflow: boolean;
  /** A control's address, by control number; each chip links to it. */
  hrefFor: (controlNumber: string) => string;
}

/**
 * The four Zero Trust states a chip can show: base only, base and enhancements,
 * enhancements only, and none. Each has its own color and its own glyph, so the state
 * is never carried by color alone (WCAG 1.4.1), and the chip's accessible name says it
 * in words. The fills also step in lightness, darker for more coverage, so they part in
 * grayscale too (globals.css). The legend in LayerCakeVisualization reads this same list,
 * so the two cannot drift. Text on each fill is at least 5.4:1, and stays above 4.5:1 on
 * hover; docs/architecture/color-tokens.md has the pairs.
 */
export const ZT_STATES = [
  {
    status: "zero-trust-aligned",
    label: "ZT Aligned",
    glyph: "●",
    chip: "border-ink/25 bg-state-aligned text-on-accent hover:brightness-110",
  },
  {
    status: "zt-aligned-with-enhancements",
    label: "ZT Aligned + Enhancements",
    glyph: "◆",
    chip: "border-ink/25 bg-state-aligned-enh text-on-accent hover:brightness-150 dark:hover:brightness-90",
  },
  {
    status: "zt-via-enhancements",
    label: "ZT Enhancements",
    glyph: "▲",
    chip: "border-border-strong bg-state-enh text-ink hover:brightness-110",
  },
  {
    status: "compliance",
    // The product names the mapping a control is missing from.
    label: null,
    glyph: "○",
    chip: "border-border-strong bg-state-none text-state-none-ink hover:brightness-95",
  },
] as const;

export type ZTState = (typeof ZT_STATES)[number];

/** A control's state, with anything unrecognized read as not mapped. */
export function ztStateOf(status: string): ZTState {
  return ZT_STATES.find((s) => s.status === status) ?? ZT_STATES[3];
}

export default function FamilyColumn({
  family,
  query,
  textMatches,
  isActive,
  reflow,
  hrefFor,
}: FamilyColumnProps) {
  // Reflow collapses the family to just its matching controls; otherwise all controls
  // render and non-matches dim in place.
  const visibleControls =
    isActive && reflow
      ? family.controls.filter((control) =>
          matchesQuery(control, query, textMatches),
        )
      : family.controls;

  return (
    <div
      id={`family-${family.id}`}
      className="flex min-w-[200px] flex-col gap-3"
    >
      {/*
        Family Header. The name leads and the code sits under it: the code is a lookup
        key you already know if you are looking for it, while the name is what someone
        scanning the diagram actually reads. It used to be the other way round, with the
        name at 10px, uppercased, and held at opacity-0 until hover.

        Fixed height rather than fitted to the text, because these sit in a flex row with
        the control stacks hanging beneath — a header sized to its own name would step the
        cake's top edge and misalign every stack. h-24 is sized for the worst case in
        either catalog, PT at 63 characters, which wraps to three lines at this width.
        Mixed case rather than uppercase: it is narrower per character and easier to read
        at this size, which is what buys the third line back.
      */}
      <div className="border-success/40 bg-surface-family text-ink flex h-24 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 text-center shadow-sm">
        <span className="text-[13px] leading-tight font-bold">
          {family.name}
        </span>
        <span className="text-ink-muted text-xs leading-none font-semibold tracking-widest">
          {family.id}
        </span>
      </div>

      {/* Individual controls — a clean vertical stack with a small gap between chips. */}
      <div className="flex flex-col gap-1.5">
        {visibleControls.length === 0 ? (
          <div className="text-ink-muted px-2 py-3 text-center text-xs italic">
            No controls
          </div>
        ) : (
          visibleControls.map((control) => {
            // Reflow removes non-matches; otherwise they dim in place (the family keeps
            // its height + frozen position, matches stay vivid).
            const dimmed =
              isActive && !reflow && !matchesQuery(control, query, textMatches);
            const baseClass =
              "cursor-pointer truncate rounded-md border px-3 py-3 text-center text-sm font-bold shadow-md transition-all";
            const state = ztStateOf(control.status);

            // A link, so a reader can open a control in a new tab or copy its address.
            // No prefetch: the cake shows a few hundred chips, and each would ask the
            // server for its control on sight. Not draggable, so pressing and dragging
            // on a chip pans the cake rather than dragging the link; Firefox also needs
            // the drag start cancelled.
            return (
              <Link
                key={control.id}
                href={hrefFor(control.id)}
                prefetch={false}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className={`${baseClass} ${state.chip} ${dimmed ? "opacity-30 grayscale" : ""}`}
                title={control.name}
                // Named in full rather than through a visually hidden suffix, whose
                // spacing the name computation does not keep.
                aria-label={`${control.id}, ${state.label ?? product.baselineChipLabel}`}
              >
                <span aria-hidden="true" className="mr-1.5 text-xs">
                  {state.glyph}
                </span>
                {control.id}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
