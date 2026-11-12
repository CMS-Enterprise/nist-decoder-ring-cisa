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
      <label htmlFor={inputId} className="text-ink my-0! text-sm font-medium">
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
        className="border-border-strong bg-surface text-ink placeholder:text-ink-muted focus:border-accent w-full max-w-md rounded-lg border px-3 py-1.5 text-sm"
      />
      <ul
        id={resultsId}
        aria-label="Matching controls"
        className={
          results.length > 0
            ? "border-border bg-surface m-0! max-h-64 w-full max-w-md list-none! overflow-auto rounded-lg border p-0!"
            : "hidden"
        }
      >
        {results.map((c) => (
          <li key={c.id} className="m-0!">
            <button
              type="button"
              onClick={() => add(c.id)}
              className="hover:bg-surface-canvas focus-visible:bg-accent-subtle flex! w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm"
            >
              <span
                className={
                  c.withdrawn
                    ? "text-ink-muted shrink-0 font-semibold line-through"
                    : "text-ink shrink-0 font-semibold"
                }
              >
                {c.id}
              </span>
              <span className="text-ink-muted min-w-0 truncate">{c.name}</span>
              {/* A withdrawn control is exported when picked, as the catalog last published it. */}
              {c.withdrawn && (
                <span className="text-ink-muted ml-auto shrink-0 pl-3 text-xs">
                  withdrawn
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {term.length > 0 && controls && results.length === 0 && (
        <p className="text-ink-muted text-xs">
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
                className="bg-surface-muted text-ink hover:bg-surface-strong flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                {id}
                <span aria-hidden className="text-ink-muted">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li className="m-0!">
            <button
              type="button"
              onClick={() => remove([])}
              className="text-accent ml-1 text-xs font-medium hover:underline"
            >
              Clear picks
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
