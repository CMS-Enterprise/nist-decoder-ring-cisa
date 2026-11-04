import { parseAsArrayOf, parseAsString, parseAsStringEnum } from "nuqs/server";

import { NO_BASELINE, baselineKey } from "./filterPredicate";
import { product } from "~/config/product";

/**
 * The filter bar's URL contract, outside the "use client" hook so the export route parses
 * the same URL the diagram reads. nuqs/server's parsers run on either side.
 */

/** The pillars the Zero Trust mapping uses: CISA's five. The schema's
 *  enum also has CROSS_CUTTING, which no mapping here carries, so the filter does
 *  not offer it. */
export const PILLAR_VALUES = [
  "IDENTITY",
  "DEVICES",
  "NETWORKS",
  "APPLICATIONS",
  "DATA",
] as const;
export const MATURITY_VALUES = [
  "TRADITIONAL",
  "INITIAL",
  "ADVANCED",
  "OPTIMAL",
] as const;
/** CISA's designations, strongest first. */
export const DESIGNATION_VALUES = ["KEY", "SUPPORTING", "INFORMATIVE"] as const;
/** The catalog's baselines as URL values, then the option for controls in none. */
export const BASELINE_VALUES: readonly string[] = [
  ...product.catalogBaselines.map(baselineKey),
  NO_BASELINE,
];
export const STATUS_VALUES = [
  "zero-trust-aligned",
  "zt-aligned-with-enhancements",
  "zt-via-enhancements",
  "compliance",
] as const;

/**
 * The facet parsers validate against the allowed values at parse time (invalid values in
 * the URL are dropped) but type the result as string[] — the predicate and FilterBar work
 * in plain strings, which keeps facet toggling type-clean.
 */
export const FILTER_PARSERS = {
  pillar: parseAsArrayOf(
    parseAsStringEnum<string>([...PILLAR_VALUES]),
  ).withDefault([]),
  maturity: parseAsArrayOf(
    parseAsStringEnum<string>([...MATURITY_VALUES]),
  ).withDefault([]),
  designation: parseAsArrayOf(
    parseAsStringEnum<string>([...DESIGNATION_VALUES]),
  ).withDefault([]),
  baseline: parseAsArrayOf(
    parseAsStringEnum<string>([...BASELINE_VALUES]),
  ).withDefault([]),
  family: parseAsArrayOf(parseAsString).withDefault([]),
  status: parseAsArrayOf(
    parseAsStringEnum<string>([...STATUS_VALUES]),
  ).withDefault([]),
  q: parseAsString.withDefault(""),
};
