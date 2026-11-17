import { product } from "~/config/product";
import { type FACET_KEYS, NO_BASELINE, baselineKey } from "./filterPredicate";

// The filter bar's labels for each facet's values, outside its "use client" module so the
// export writers name the filters as the bar does.

export const PILLAR_LABELS: Record<string, string> = {
  IDENTITY: "Identity",
  DEVICES: "Devices",
  NETWORKS: "Networks",
  APPLICATIONS: "Apps & Workloads",
  DATA: "Data",
};
export const MATURITY_LABELS: Record<string, string> = {
  TRADITIONAL: "Traditional",
  INITIAL: "Initial",
  ADVANCED: "Advanced",
  OPTIMAL: "Optimal",
};
export const DESIGNATION_LABELS: Record<string, string> = {
  KEY: "Key",
  SUPPORTING: "Supporting",
  INFORMATIVE: "Informative",
};
// A baseline as the catalog spells it. The bar's own words for one come from the
// product's slots, which are client-only, so the files name it as the catalog does.
const BASELINE_NAMES: Record<string, string> = {
  ...Object.fromEntries(
    product.catalogBaselines.map((b) => [baselineKey(b), b]),
  ),
  [NO_BASELINE]: product.baselineFacetNone,
};
export const STATUS_LABELS: Record<string, string> = {
  "zero-trust-aligned": "ZT Aligned",
  "zt-aligned-with-enhancements": "ZT Aligned + Enhancements",
  "zt-via-enhancements": "ZT Enhancements",
  compliance: product.baselineChipLabel,
};

/** Each facet's name and its values' labels, keyed as the URL names it; a family is its code. */
export const FACETS = {
  pillar: { name: "Pillar", labels: PILLAR_LABELS },
  maturity: { name: "Maturity", labels: MATURITY_LABELS },
  designation: { name: "Designation", labels: DESIGNATION_LABELS },
  baseline: { name: "Baseline", labels: BASELINE_NAMES },
  family: { name: "Family", labels: {} },
  status: { name: "Status", labels: STATUS_LABELS },
} satisfies Record<
  (typeof FACET_KEYS)[number],
  { name: string; labels: Record<string, string> }
>;
