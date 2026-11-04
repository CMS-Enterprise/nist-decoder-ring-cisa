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
        className="flex cursor-pointer list-none items-center rounded-full text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <Info size={14} aria-hidden="true" />
      </summary>
      <div
        role="note"
        className="absolute left-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal normal-case shadow-lg"
      >
        <p className="mb-2 font-semibold text-slate-700">{info.title}</p>
        {info.paragraphs.map((text, i) => (
          <p key={i} className="mb-2 leading-relaxed text-slate-600 last:mb-0">
            {text}
          </p>
        ))}
      </div>
    </details>
  );
}
