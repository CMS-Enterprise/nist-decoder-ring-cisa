"use client";

import { useRef } from "react";

import {
  useDecoderQuery,
  PILLAR_VALUES,
  MATURITY_VALUES,
  DESIGNATION_VALUES,
  BASELINE_VALUES,
  STATUS_VALUES,
} from "./useDecoderQuery";
import { NO_BASELINE, baselineKey } from "./filterPredicate";
import { useDismissibleDetails } from "./useDismissibleDetails";
import { product } from "~/config/product";
import { STANDARD_SLOTS } from "~/config/product-slots";
import { RAW_BASELINE_LABEL } from "./statement";

const PILLAR_LABELS: Record<string, string> = {
  IDENTITY: "Identity",
  DEVICES: "Devices",
  NETWORKS: "Networks",
  APPLICATIONS: "Apps & Workloads",
  DATA: "Data",
};
const MATURITY_LABELS: Record<string, string> = {
  TRADITIONAL: "Traditional",
  INITIAL: "Initial",
  ADVANCED: "Advanced",
  OPTIMAL: "Optimal",
};
const DESIGNATION_LABELS: Record<string, string> = {
  KEY: "Key",
  SUPPORTING: "Supporting",
  INFORMATIVE: "Informative",
};
const BASELINE_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    product.catalogBaselines.map((b) => [
      baselineKey(b),
      (STANDARD_SLOTS.baselineLabel ?? RAW_BASELINE_LABEL)(b),
    ]),
  ),
  [NO_BASELINE]: product.baselineFacetNone,
};
const STATUS_LABELS: Record<string, string> = {
  "zero-trust-aligned": "ZT Aligned",
  "zt-aligned-with-enhancements": "ZT Aligned + Enhancements",
  "zt-via-enhancements": "ZT Enhancements",
  compliance: product.baselineChipLabel,
};

type FacetKey =
  "pillar" | "maturity" | "designation" | "baseline" | "status" | "family";

interface FilterBarProps {
  /** Family options for the Family facet (code + display name). */
  families: { id: string; name: string }[];
  /** The diagram's "collapse to matches" view; left out where there is no diagram. */
  reflow?: boolean;
  onToggleReflow?: () => void;
  /** Clear every facet + the search term (also resets the reflow view). */
  onClear: () => void;
}

export default function FilterBar({
  families,
  reflow = false,
  onToggleReflow,
  onClear,
}: FilterBarProps) {
  const { query, setQuery, toggleFacet, isActive } = useDecoderQuery();
  const barRef = useRef<HTMLDivElement>(null);

  // Escape or a click outside the bar closes any open facet dropdown.
  useDismissibleDetails(barRef);

  const familyLabels: Record<string, string> = Object.fromEntries(
    families.map((f) => [f.id, f.name]),
  );

  // Each facet is one fixed width, shared by its button and its open panel, so open
  // panels sit side by side instead of over one another. The width is the narrowest that
  // keeps every option to two lines at the options' size and the button's label and
  // selection count to one; Family's longest name and ZT Designation's label need more.
  const facets: {
    key: FacetKey;
    label: string;
    values: readonly string[];
    labels: Record<string, string>;
    width: string;
    /** The button's tooltip, where how an option matches is not obvious from its name. */
    hint?: string;
  }[] = [
    {
      key: "pillar",
      label: "Pillar",
      values: PILLAR_VALUES,
      labels: PILLAR_LABELS,
      width: "w-36",
    },
    {
      key: "maturity",
      label: "Maturity",
      values: MATURITY_VALUES,
      labels: MATURITY_LABELS,
      width: "w-36",
    },
    {
      key: "designation",
      label: "ZT Designation",
      values: DESIGNATION_VALUES,
      labels: DESIGNATION_LABELS,
      // Wider than the other short facets so its label and a selection count fit on one line.
      width: "w-44",
    },
    {
      key: "baseline",
      label: product.baselineFacetLabel,
      values: BASELINE_VALUES,
      labels: BASELINE_LABELS,
      hint: product.baselineFacetHint,
      width: "w-36",
    },
    {
      key: "status",
      label: "Status",
      values: STATUS_VALUES,
      labels: STATUS_LABELS,
      width: "w-36",
    },
    {
      key: "family",
      label: "Family",
      values: families.map((f) => f.id),
      labels: familyLabels,
      width: "w-64",
    },
  ];

  const facetLabelFor = (key: FacetKey) =>
    facets.find((f) => f.key === key)?.label ?? key;

  const labelFor = (key: FacetKey, value: string) =>
    facets.find((f) => f.key === key)?.labels[value] ?? value;

  const activeChips = (
    [
      "pillar",
      "maturity",
      "designation",
      "baseline",
      "status",
      "family",
    ] as FacetKey[]
  ).flatMap((key) => query[key].map((value) => ({ key, value })));

  return (
    <div ref={barRef} className="flex flex-col gap-2">
      {/* Facet dropdowns + reflow toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {facets.map((facet) => {
          const selected = query[facet.key];
          return (
            <details
              key={facet.key}
              className={`group relative shrink-0 ${facet.width}`}
            >
              <summary
                title={facet.hint}
                className="flex w-full cursor-pointer list-none items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-300"
              >
                <span className="flex items-center gap-1.5">
                  {facet.label}
                  {selected.length > 0 && (
                    <span className="rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
                      {selected.length}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {facet.values.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-slate-400 italic">
                    No options
                  </p>
                ) : (
                  facet.values.map((value) => (
                    // flex! and my-0!: a design-system stylesheet loaded outside
                    // Tailwind's layers sets label { display: block; margin-block: 1.5em 0 },
                    // and unlayered rules beat layered utilities unless they are important.
                    <label
                      key={value}
                      className="my-0! flex! cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs leading-4 text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(value)}
                        onChange={() => toggleFacet(facet.key, value)}
                        className="h-4 w-4 shrink-0 rounded border-slate-300"
                      />
                      {/* Wraps beside the checkbox, never under it. */}
                      <span className="min-w-0">
                        {facet.labels[value] ?? value}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </details>
          );
        })}

        {isActive && onToggleReflow && (
          <button
            type="button"
            onClick={onToggleReflow}
            aria-pressed={reflow}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              reflow
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
            title="Collapse the diagram down to just the matching controls"
          >
            {reflow ? "Show all" : "Collapse to matches"}
          </button>
        )}
      </div>

      {/* Active-filter chips + clear all */}
      {isActive && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map(({ key, value }) => (
            <button
              key={`${key}:${value}`}
              type="button"
              onClick={() => toggleFacet(key, value)}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              title={`Remove ${facetLabelFor(key)}: ${labelFor(key, value)}`}
            >
              {/* The facet's name leads, so values from different facets never read as one list. */}
              <span className="text-slate-500">{facetLabelFor(key)}:</span>{" "}
              {labelFor(key, value)}
              <span aria-hidden className="text-slate-400">
                ×
              </span>
            </button>
          ))}
          {query.q.trim() !== "" && (
            <button
              type="button"
              onClick={() => void setQuery({ q: "" })}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              title="Clear the search term"
            >
              &ldquo;{query.q}&rdquo;
              <span aria-hidden className="text-slate-400">
                ×
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-xs font-medium text-blue-600 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
