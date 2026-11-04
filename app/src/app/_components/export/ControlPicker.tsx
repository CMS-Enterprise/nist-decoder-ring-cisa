"use client";

import { useId, useMemo, useRef, useState } from "react";

import { normalizeControlId } from "~/app/_components/decoder-ring/filterPredicate";
import { api } from "~/trpc/react";

const MAX_RESULTS = 20;

// The `!` classes override the design system's unlayered list and button rules.

/**
 * Search the catalog's controls and enhancements by id or name and add them as picks. The
 * results are a plain list of buttons rather than a combobox, so each is reached by Tab.
 */
export default function ControlPicker({
  picks,
  onChange,
}: {
  picks: string[];
  onChange: (picks: string[]) => void;
}) {
  const inputId = useId();
  const resultsId = useId();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: controls } = api.decoder.listControls.useQuery(undefined, {
    staleTime: Infinity,
  });

  const picked = useMemo(() => new Set(picks.map(normalizeControlId)), [picks]);
  // One chip per control, however a pasted link spells it.
  const chips = picks.filter(
    (p, i) =>
      picks.findIndex(
        (q) => normalizeControlId(q) === normalizeControlId(p),
      ) === i,
  );
  const names = useMemo(
    () => new Map((controls ?? []).map((c) => [c.id, c.name])),
    [controls],
  );

  const term = text.trim().toLowerCase();
  const results =
    term.length === 0
      ? []
      : (controls ?? [])
          .filter(
            (c) =>
              !picked.has(normalizeControlId(c.id)) &&
              (normalizeControlId(c.id).startsWith(normalizeControlId(term)) ||
                c.id.toLowerCase().includes(term) ||
                c.name.toLowerCase().includes(term)),
          )
          .slice(0, MAX_RESULTS);

  const add = (id: string) => {
    onChange([...picks, id]);
    setText("");
    // The chosen result leaves the list, so focus goes back to the search box rather than the page.
    inputRef.current?.focus();
  };
  // The pressed chip or "Clear picks" unmounts, so focus goes back to the search box too.
  const remove = (next: string[]) => {
    onChange(next);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* my-0!: the design system's unlayered label rule otherwise adds a top margin. */}
      <label
        htmlFor={inputId}
        className="my-0! text-sm font-medium text-slate-700"
      >
        Pick controls or enhancements
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            add(results[0].id);
          }
        }}
        placeholder="Control number or name, e.g. AC-02"
        aria-controls={resultsId}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      />
      <ul
        id={resultsId}
        aria-label="Matching controls"
        className={
          results.length > 0
            ? "m-0! max-h-64 w-full max-w-md list-none! overflow-auto rounded-lg border border-slate-200 bg-white p-0!"
            : "hidden"
        }
      >
        {results.map((c) => (
          <li key={c.id} className="m-0!">
            <button
              type="button"
              onClick={() => add(c.id)}
              className="flex! w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none"
            >
              <span
                className={
                  c.withdrawn
                    ? "shrink-0 font-semibold text-slate-400 line-through"
                    : "shrink-0 font-semibold text-slate-800"
                }
              >
                {c.id}
              </span>
              <span
                className={`min-w-0 truncate ${c.withdrawn ? "text-slate-400" : "text-slate-600"}`}
              >
                {c.name}
              </span>
              {/* A withdrawn control is exported when picked, as the catalog last published it. */}
              {c.withdrawn && (
                <span className="ml-auto shrink-0 pl-3 text-xs text-slate-400">
                  withdrawn
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {term.length > 0 && controls && results.length === 0 && (
        <p className="text-xs text-slate-500">
          No unpicked control matches &ldquo;{text.trim()}&rdquo;.
        </p>
      )}

      {picks.length > 0 && (
        <ul
          aria-label="Picked controls"
          className="m-0! flex! list-none! flex-row! flex-wrap! items-center gap-1.5 p-0!"
        >
          {chips.map((id) => (
            <li key={id} className="m-0!">
              <button
                type="button"
                onClick={() =>
                  remove(
                    picks.filter(
                      (p) => normalizeControlId(p) !== normalizeControlId(id),
                    ),
                  )
                }
                aria-label={`Remove ${id}`}
                title={names.get(id) ?? id}
                className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                {id}
                <span aria-hidden className="text-slate-400">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li className="m-0!">
            <button
              type="button"
              onClick={() => remove([])}
              className="ml-1 text-xs font-medium text-blue-600 hover:underline"
            >
              Clear picks
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
