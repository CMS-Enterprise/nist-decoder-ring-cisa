"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { api } from "~/trpc/react";
import { useDecoderQuery } from "./useDecoderQuery";

interface SearchTypeaheadProps {
  /** A control's address, by control number; each result links to it (direct
   *  navigation). Left out, the box only narrows by its term and offers no dropdown. */
  hrefFor?: (controlNumber: string) => string;
}

const MATCH_LABELS: Record<string, string> = {
  id: "control number",
  name: "name",
  text: "text / ZT guidance",
};

/**
 * Search box that does double duty: it writes the debounced term to the URL `q`
 * (which narrows the layer cake live, via the shared filter predicate) AND offers a
 * direct-navigation dropdown backed by decoder.searchControls — selecting a result
 * opens that control's modal. "Narrow + jump."
 *
 * Search reads the catalog's current controls. "Search withdrawn controls" adds the ones
 * it has withdrawn to the dropdown, marked, for a reader arriving with an older document's
 * control number. They never narrow the diagram, which shows current controls only.
 */
export default function SearchTypeahead({ hrefFor }: SearchTypeaheadProps) {
  const { query, setQuery } = useDecoderQuery();
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [open, setOpen] = useState(false);
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  // Tracks the value we last wrote to the URL, so the sync effect can tell an external
  // q change (Clear all, the chip ×) from our own debounced write.
  const lastPushed = useRef(query.q);

  // Keep the caret snappy: debounce the raw input into a settled value...
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);

  // ...then drive both the URL `q` (diagram narrowing) and the dropdown query off it.
  // The write runs when the settled term changes and never because the setter did:
  // some nuqs releases return a new setter on every render, and a write keyed on the
  // setter would re-fire on each render it causes.
  const pushQuery = useEffectEvent((q: string) => {
    lastPushed.current = q;
    void setQuery({ q });
  });
  useEffect(() => {
    pushQuery(debounced);
  }, [debounced]);

  // Reflect an external q change (Clear all, the search chip ×) back into the input —
  // but never clobber in-flight typing, which always matches what we last pushed.
  useEffect(() => {
    if (query.q !== lastPushed.current) {
      lastPushed.current = query.q;
      setText(query.q);
      setDebounced(query.q);
    }
  }, [query.q]);

  // The flag is sent only when on, so the default request is the one the diagram reads.
  const { data: results } = api.decoder.searchControls.useQuery(
    includeWithdrawn ? { q: debounced, includeWithdrawn } : { q: debounced },
    { enabled: Boolean(hrefFor) && debounced.length >= 2 },
  );
  const hits = results?.hits ?? [];

  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
      <div className="relative w-full max-w-md">
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search controls — number, name, or text"
          aria-label="Search controls"
          className="border-border-strong bg-surface text-ink placeholder:text-ink-muted focus:border-accent w-full rounded-lg border px-3 py-1.5 text-sm"
        />
        {hrefFor && open && debounced.length >= 2 && (
          <ul className="border-border bg-surface absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border shadow-lg">
            {hits.length === 0 ? (
              <li className="text-ink-muted px-3 py-2 text-sm">
                No controls match &ldquo;{debounced}&rdquo;
              </li>
            ) : (
              hits.map((hit) => (
                <li key={hit.controlNumber}>
                  <Link
                    href={hrefFor(hit.controlNumber)}
                    // No prefetch, like the cake's chips: each result would ask the server
                    // for its control as the reader types.
                    prefetch={false}
                    // Cancelling the mouse-down keeps focus in the input, so its onBlur
                    // doesn't close the dropdown before the click lands and navigates.
                    onMouseDown={(e) => e.preventDefault()}
                    // A modified click is one Link leaves to the browser (a new tab or
                    // window, or a download), and this page stays where it was, so the
                    // list stays open for the next result. A new window that takes focus
                    // still closes it, through the box's blur, as any move away does.
                    onClick={(e) => {
                      if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                        setOpen(false);
                      }
                    }}
                    className="hover:bg-surface-canvas flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span
                        className={
                          hit.withdrawn
                            ? "text-ink-muted font-semibold line-through"
                            : "text-ink font-semibold"
                        }
                      >
                        {hit.controlNumber}
                      </span>{" "}
                      <span className="text-ink-muted">{hit.controlName}</span>
                    </span>
                    <span className="text-ink-muted ml-auto shrink-0 pl-3 text-xs">
                      {hit.withdrawn
                        ? "withdrawn"
                        : (MATCH_LABELS[hit.matchedIn] ?? hit.matchedIn)}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {hrefFor && (
        <label className="text-ink-muted inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={includeWithdrawn}
            onChange={(e) => setIncludeWithdrawn(e.target.checked)}
            className="border-border-strong h-3.5 w-3.5 rounded"
          />
          Search withdrawn controls
        </label>
      )}
    </div>
  );
}
