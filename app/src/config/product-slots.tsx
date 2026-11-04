"use client";

import type { StatementSlots } from "~/app/_components/decoder-ring/statement";

/**
 * The render slots the product fills.
 *
 * `product.ts` holds strings and stays that way — its test walks every value
 * asserting no catalog vocabulary, which a component or a predicate would break.
 * So the slots that carry *behaviour* live here.
 *
 * Here every slot is empty, and that is the whole point rather than an
 * omission. The module that would fill them draws another catalog's baseline
 * vocabulary — single-letter abbreviations and a tailoring marker — and it lives
 * under `_components/`, outside the paths `no-catalog-literals.test.ts` admits.
 * Bringing it here to fill a slot would mean widening that allowlist, which is the
 * one thing that file says not to do. A baseline therefore renders as its own raw
 * token, in no catalog's words.
 */

/** Standard fills nothing. The absence is structural, not configured. */
export const STANDARD_SLOTS: StatementSlots = {};
