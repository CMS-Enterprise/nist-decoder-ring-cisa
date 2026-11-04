// Docs: prisma/generators/zt-overlay/README.md
/**
 * A tuple is (control, pillar, function, maturity): one place a control sits in
 * CISA's Zero Trust Maturity Model, and one row of 13.
 */

import { compareText } from "./order.js";

export interface Tuple {
  controlId: string;
  pillar: string;
  function: string;
  maturity: string;
}

/** The pillars CISA's mapping uses, in the model's order. */
export const PILLAR_ORDER = [
  "IDENTITY",
  "DEVICES",
  "NETWORKS",
  "APPLICATIONS",
  "DATA",
];
export const MATURITY_ORDER = ["TRADITIONAL", "INITIAL", "ADVANCED", "OPTIMAL"];

export function compareTuples(a: Tuple, b: Tuple): number {
  return (
    compareText(a.controlId, b.controlId) ||
    PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar) ||
    compareText(a.function, b.function) ||
    MATURITY_ORDER.indexOf(a.maturity) - MATURITY_ORDER.indexOf(b.maturity)
  );
}
