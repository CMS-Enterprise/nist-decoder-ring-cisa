"use client";

import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "~/trpc/react";
import {
  enhancementResults,
  type EnhancementResult,
  type FilterableControl,
} from "./filterPredicate";
import { useDecoderQuery } from "./useDecoderQuery";

interface SearchTypeaheadProps {
  /** A control's address, by control number; each result links to it (direct
   *  navigation). Left out, the box only narrows by its term and offers no dropdown. */
  hrefFor?: (controlNumber: string) => string;
  /** The diagram's controls, so a Zero Trust filter can list the enhancements it matches. */
  controls?: readonly FilterableControl[];
}

interface ResultRow {
  id: string;
  name: string;
  label: string;
  withdrawn?: boolean;
  /** The base control, for an enhancement. */
  base?: string;
  /** An enhancement listed under its base, so drawn indented. */
  nested?: boolean;
}

const NO_CONTROLS: readonly FilterableControl[] = [];

/**
 * At most this many enhancement results. The server caps the controls it returns at 25
 * too, so the list holds at most 50 rows: each cap cuts its own kind.
 */
const ENHANCEMENT_CAP = 25;

const MATCH_LABELS: Record<string, string> = {
  id: "control number",
  name: "name",
  text: "text / ZT guidance",
};

// A result's element id, for aria-activedescendant to name.
const optionId = (list: string, i: number) => `${list}-${i}`;

const enhancementRow = (e: EnhancementResult, nested: boolean): ResultRow => ({
  ...e,
  label: "enhancement, matches filters",
  nested,
});

/**
 * Search box that does double duty: it writes the debounced term to the URL `q`
 * (which narrows the layer cake live, via the shared filter predicate) AND offers a
 * direct-navigation dropdown backed by decoder.searchControls — selecting a result
 * opens that control's modal. "Narrow + jump."
 *
 * The box and its dropdown are an ARIA combobox: focus stays in the box while the arrow
 * keys move through the results, Enter opens the one marked, and Escape closes the list.
 * Each result is still a link, so a modified click opens it in a new tab.
 *
 * Search reads the catalog's current controls. "Search withdrawn controls" adds the ones
 * it has withdrawn to the dropdown, marked, for a reader arriving with an older document's
 * control number. They never narrow the diagram, which shows current controls only.
 */

export default function SearchTypeahead({
  hrefFor,
  controls = NO_CONTROLS,
}: SearchTypeaheadProps) {
  const { query, setQuery } = useDecoderQuery();
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [open, setOpen] = useState(false);
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Tracks the value we last wrote to the URL, so the sync effect can tell an external
  // q change (Clear all, the chip ×) from our own debounced write.
  const lastPushed = useRef(query.q);
  // Set by a result pick; the next focus is the dialog handing it back.
  const picked = useRef(false);

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
  // Each matching enhancement follows its base when the base is a hit, and the rest
  // follow the hits. Nothing until the server answers, so none shows ahead of its base.
  const rows = useMemo<ResultRow[]>(() => {
    if (!results) return [];
    const { hits } = results;
    const hitIds = new Set(hits.map((h) => h.controlNumber));
    const matched = enhancementResults(
      controls,
      { ...query, q: debounced },
      hitIds,
    );
    // Those under a hit first, so the cap never drops a listed base's for the rest.
    const kept = [
      ...matched.filter((e) => hitIds.has(e.base)),
      ...matched.filter((e) => !hitIds.has(e.base)),
    ].slice(0, ENHANCEMENT_CAP);
    const byBase = new Map<string, ResultRow[]>();
    const rest: ResultRow[] = [];
    for (const e of kept) {
      const list = byBase.get(e.base);
      if (!hitIds.has(e.base)) rest.push(enhancementRow(e, false));
      else if (list) list.push(enhancementRow(e, true));
      else byBase.set(e.base, [enhancementRow(e, true)]);
    }
    return [
      ...hits.flatMap((hit) => [
        {
          id: hit.controlNumber,
          name: hit.controlName,
          withdrawn: hit.withdrawn,
          label: hit.withdrawn
            ? "withdrawn"
            : (MATCH_LABELS[hit.matchedIn] ?? hit.matchedIn),
        },
        ...(byBase.get(hit.controlNumber) ?? []),
      ]),
      ...rest,
    ];
  }, [results, controls, query, debounced]);

  // A new term starts with none marked (React's "reset on prop change" pattern); its
  // answer arrives under it, and nothing can be marked while it loads.
  const [activeFor, setActiveFor] = useState(debounced);
  if (activeFor !== debounced) {
    setActiveFor(debounced);
    setActive(-1);
  }
  const marked = active < rows.length ? active : -1;

  const listed = Boolean(hrefFor) && open && debounced.length >= 2;
  const showing = listed && rows.length > 0;

  // Keep the marked result in view as the arrow keys move past the list's edge.
  useEffect(() => {
    if (marked >= 0)
      document
        .getElementById(optionId(listId, marked))
        ?.scrollIntoView?.({ block: "nearest" });
  }, [marked, listId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // While an input method composes, its arrow keys and Enter pick and accept its own text.
    if (!hrefFor || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!rows.length) return;
      // Each end wraps to the other; from none marked, down marks the first, up the last.
      const down = e.key === "ArrowDown";
      setActive((i) =>
        down
          ? (Math.min(i, rows.length - 1) + 1) % rows.length
          : i <= 0 || i >= rows.length
            ? rows.length - 1
            : i - 1,
      );
    } else if (e.key === "Enter" && showing && marked >= 0) {
      e.preventDefault();
      document.getElementById(optionId(listId, marked))?.click();
    } else if (e.key === "Escape" && listed) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
      <div ref={wrapper} className="relative w-full max-w-md">
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            picked.current = false;
            setOpen(true);
          }}
          // A pick opens the control's dialog, which gives focus back to this box when
          // it closes, as the loading frame before it does: those returns must not
          // reopen the list the pick closed. Typing, a click on the box, or focus
          // leaving it for anything but a dialog ends that.
          onFocus={() => {
            if (!picked.current) setOpen(true);
          }}
          onClick={() => {
            picked.current = false;
            setOpen(true);
          }}
          // Close once focus leaves the search for good, never for a move within it.
          onBlur={(e) => {
            const to = e.relatedTarget;
            if (!(to instanceof Element && to.closest('[role="dialog"]')))
              picked.current = false;
            if (!wrapper.current?.contains(to)) setOpen(false);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search controls — number, name, or text"
          aria-label="Search controls"
          {...(hrefFor
            ? {
                role: "combobox",
                "aria-autocomplete": "list" as const,
                "aria-expanded": showing,
                "aria-controls": listId,
                "aria-activedescendant":
                  showing && marked >= 0 ? optionId(listId, marked) : undefined,
              }
            : {})}
          className="border-border-strong bg-surface text-ink placeholder:text-ink-muted focus:border-accent w-full rounded-lg border px-3 py-1.5 text-sm"
        />
        {listed && rows.length === 0 && (
          <p
            role="status"
            className="border-border bg-surface text-ink-muted absolute z-30 mt-1 w-full rounded-lg border px-3 py-2 text-sm shadow-lg"
          >
            No controls match &ldquo;{debounced}&rdquo;
          </p>
        )}
        {hrefFor && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            hidden={!showing}
            // Cancelling the mouse-down keeps focus in the box, so its blur doesn't close
            // the list before a click on a result, or on the list's scrollbar, lands.
            onMouseDown={(e) => e.preventDefault()}
            className="border-border bg-surface absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border shadow-lg"
          >
            {showing &&
              rows.map((row, i) => (
                <li key={row.id} role="presentation">
                  <Link
                    id={optionId(listId, i)}
                    role="option"
                    aria-selected={i === marked}
                    tabIndex={-1}
                    href={hrefFor(row.id)}
                    // No prefetch, like the cake's chips: each result would ask the server
                    // for its control as the reader types.
                    prefetch={false}
                    // A modified click is one Link leaves to the browser (a new tab or
                    // window, or a download), and this page stays where it was, so the
                    // list stays open for the next result. A new window that takes focus
                    // still closes it, through the box's blur, as any move away does.
                    onClick={(e) => {
                      if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                        picked.current = true;
                        setOpen(false);
                      }
                    }}
                    // Named in full, as the cake's chips are, with the visible label
                    // inside the name for speech input; the number names the base.
                    aria-label={
                      row.base
                        ? `${row.id}${row.name ? ` ${row.name}` : ""}, ${row.label}`
                        : undefined
                    }
                    className={`hover:bg-surface-canvas aria-selected:bg-surface-canvas flex w-full items-baseline gap-3 py-2 pr-3 text-left text-sm ${row.nested ? "pl-6" : "pl-3"}`}
                  >
                    <span className="min-w-0 truncate">
                      <span
                        className={
                          row.withdrawn
                            ? "text-ink-muted font-semibold line-through"
                            : "text-ink font-semibold"
                        }
                      >
                        {row.id}
                      </span>{" "}
                      <span className="text-ink-muted">{row.name}</span>
                    </span>
                    <span className="text-ink-muted ml-auto shrink-0 pl-3 text-xs">
                      {row.label}
                    </span>
                  </Link>
                </li>
              ))}
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
