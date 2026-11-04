"use client";

import Link from "next/link";

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

// Chip color per ZT alignment state — four hues so a user reads base-only / base +
// enhancement(s) / enhancement-only / none at a glance (mirrors the legend in
// LayerCakeVisualization). White text on blue-600, violet-600, and teal-700 each clears
// WCAG AA (~5:1+) over the slate-50 canvas; the grey baseline uses dark slate text.
// The chips are links, and the design system's unlayered `a` and `a:focus` rules beat
// Tailwind's layered utilities: they take the text color, and on focus the background and
// the outline. So the text colors and the focused background are marked important.
const STATUS_CHIP_CLASSES: Record<string, string> = {
  "zero-trust-aligned":
    "border-blue-700 bg-blue-600 focus:bg-blue-600! text-white! hover:bg-blue-500",
  "zt-aligned-with-enhancements":
    "border-violet-700 bg-violet-600 focus:bg-violet-600! text-white! hover:bg-violet-500",
  "zt-via-enhancements":
    "border-teal-800 bg-teal-700 focus:bg-teal-700! text-white! hover:bg-teal-600",
  compliance:
    "border-slate-300 bg-slate-200 focus:bg-slate-200! text-slate-600! hover:bg-slate-300",
};

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
      <div className="group flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-emerald-500 bg-emerald-400 px-3 py-2 text-center text-slate-900 shadow-sm transition-all hover:bg-emerald-300">
        <span className="text-[13px] leading-tight font-bold">
          {family.name}
        </span>
        <span className="text-xs leading-none font-semibold tracking-widest text-emerald-900/70">
          {family.id}
        </span>
      </div>

      {/* Individual controls — a clean vertical stack with a small gap between chips. */}
      <div className="flex flex-col gap-1.5">
        {visibleControls.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-slate-400 italic">
            No controls
          </div>
        ) : (
          visibleControls.map((control) => {
            // Reflow removes non-matches; otherwise they dim in place (the family keeps
            // its height + frozen position, matches stay vivid).
            const dimmed =
              isActive && !reflow && !matchesQuery(control, query, textMatches);
            const baseClass =
              "cursor-pointer truncate rounded-md border px-3 py-3 text-center text-sm font-bold shadow-md transition-all focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-slate-900!";
            const colorClass =
              STATUS_CHIP_CLASSES[control.status] ??
              STATUS_CHIP_CLASSES.compliance;

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
                className={`${baseClass} ${colorClass} ${dimmed ? "opacity-30 grayscale" : ""}`}
                title={control.name}
              >
                {control.id}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
