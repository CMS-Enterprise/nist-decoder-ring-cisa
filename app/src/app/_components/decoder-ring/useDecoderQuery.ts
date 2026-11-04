"use client";

import { useQueryStates } from "nuqs";

import { isQueryActive } from "./filterPredicate";
import { FILTER_PARSERS } from "./queryParsers";
import { serializeFilters } from "./filterParams";

export {
  PILLAR_VALUES,
  MATURITY_VALUES,
  DESIGNATION_VALUES,
  BASELINE_VALUES,
  STATUS_VALUES,
} from "./queryParsers";

/**
 * The Bridge's filter + search state, backed by the URL (nuqs). The URL is the single
 * source of truth, so a filtered view is shareable and the same contract extends to
 * the future shell/tabs; the parsers live in queryParsers.ts so the export route reads
 * the same URL. history:"replace" keeps typing/toggling out of the back-stack;
 * clearOnDefault keeps empty facets out of the URL.
 */

type FacetKey =
  "pillar" | "maturity" | "designation" | "baseline" | "family" | "status";

const FILTER_OPTIONS = { history: "replace", clearOnDefault: true } as const;

export function useDecoderQuery() {
  const [query, setQuery] = useQueryStates(FILTER_PARSERS, FILTER_OPTIONS);

  /** Add or remove one value within a facet (the FilterBar's checkbox + chip action). */
  const toggleFacet = (key: FacetKey, value: string) => {
    const current = query[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    void setQuery({ [key]: next });
  };

  const clear = () =>
    setQuery({
      pillar: [],
      maturity: [],
      designation: [],
      baseline: [],
      family: [],
      status: [],
      q: "",
    });

  return {
    query,
    setQuery,
    clear,
    toggleFacet,
    isActive: isQueryActive(query),
    /** The current filters as "?…" (or ""), for links to and from a control's path. */
    search: serializeFilters(query),
  };
}
