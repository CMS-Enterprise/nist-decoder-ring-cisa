"use client";

import { useRef } from "react";
import { Info } from "lucide-react";
import { useDismissibleDetails } from "./useDismissibleDetails";

/** What an "i" toggle explains on request. */
export interface InfoContent {
  /** Accessible name of the toggle. */
  toggleLabel: string;
  title: string;
  paragraphs: string[];
}

/**
 * An "i" disclosure explaining a row or pane: a native <details>, the repo's one popover
 * pattern, closed by Escape or a click elsewhere the same way the filter's dropdowns are.
 */
export function InfoToggle({ info }: { info: InfoContent }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);
  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label={info.toggleLabel}
        title={info.toggleLabel}
        className="text-ink-muted hover:text-ink flex cursor-pointer list-none items-center rounded-full"
      >
        <Info size={14} aria-hidden="true" />
      </summary>
      <div
        role="note"
        className="border-border bg-surface absolute left-0 z-20 mt-1 w-72 rounded-lg border p-3 text-xs font-normal normal-case shadow-lg"
      >
        <p className="text-ink mb-2 font-semibold">{info.title}</p>
        {info.paragraphs.map((text, i) => (
          <p key={i} className="text-ink-muted mb-2 leading-relaxed last:mb-0">
            {text}
          </p>
        ))}
      </div>
    </details>
  );
}
