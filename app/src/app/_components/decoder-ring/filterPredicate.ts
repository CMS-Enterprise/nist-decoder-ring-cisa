/**
 * Pure filter logic for the Bridge. One predicate (`matchesQuery`) reads the
 * URL-backed filter state (facets + search text) and decides whether a control is
 * shown — so search narrows within active filters and vice-versa, with no special
 * composition code. Kept pure + React-free so it's cheap to unit-test exhaustively.
 */

export interface FilterableControl {
  id: string; // controlNumber, e.g. "AC-02"
  name: string;
  status: string; // "zero-trust-aligned" | "zt-aligned-with-enhancements" | "zt-via-enhancements" | "compliance"
  family: string; // family code, e.g. "AC"
  pillars: string[];
  maturities: string[];
  /** CISA's designations across the control's Zero Trust tuples (KEY, SUPPORTING, INFORMATIVE). */
  designations?: string[];
  /** The catalog baselines that include the control, as the catalog spells them. */
  baselines?: string[];
  /** Every baseline that includes at least one of the control's enhancements. */
  enhancementBaselines?: string[];
}

/** URL value for the baseline facet's "in no baseline" option. */
export const NO_BASELINE = "NONE";
/** A baseline's URL value: "Moderate" -> "MODERATE". */
export const baselineKey = (label: string): string => label.toUpperCase();

export interface FilterQuery {
  pillar: string[];
  maturity: string[];
  designation: string[];
  baseline: string[];
  family: string[];
  status: string[];
  q: string;
}

/** The facets: every FilterQuery field but the search text. */
export const FACET_KEYS = [
  "pillar",
  "maturity",
  "designation",
  "baseline",
  "family",
  "status",
] as const satisfies ReadonlyArray<keyof FilterQuery>;

/**
 * Canonicalize a control identifier so the variants users type compare equal:
 * "AC-02", "AC-2", "AC-02(01)", "ac-2.1" → "ac2" / "ac2.1". A trailing sub-control
 * letter (e.g. "AU-05a") is dropped here — letter-level matching is a server concern.
 * Non-identifier text (e.g. "least privilege") returns lowercased + trimmed unchanged.
 */
export function normalizeControlId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = /^([a-z]{2})-?0*(\d+)(?:[.(]0*(\d+)\)?)?/.exec(trimmed);
  if (!match) return trimmed;
  const [, family, num, enhancement] = match;
  return `${family}${num}${enhancement ? `.${enhancement}` : ""}`;
}

/**
 * Facet match: AND across dimensions, OR within a dimension. An empty dimension is no
 * constraint. A compliance-only control (no pillars/maturities) naturally fails an
 * active pillar/maturity facet — selecting a ZT facet hides pure-compliance controls.
 */
export function passesFacets(
  control: FilterableControl,
  query: FilterQuery,
): boolean {
  if (
    query.pillar.length &&
    !query.pillar.some((p) => control.pillars.includes(p))
  )
    return false;
  if (
    query.maturity.length &&
    !query.maturity.some((m) => control.maturities.includes(m))
  )
    return false;
  // A control matches when any of its tuples carries a selected designation.
  if (
    query.designation.length &&
    !query.designation.some((d) => (control.designations ?? []).includes(d))
  )
    return false;
  if (query.baseline.length) {
    // Inclusive: a control matches a baseline when it or any of its enhancements is in
    // it, and is "in no baseline" only when neither it nor any enhancement is in one.
    const has = [
      ...(control.baselines ?? []),
      ...(control.enhancementBaselines ?? []),
    ].map(baselineKey);
    const match = query.baseline.some((b) =>
      b === NO_BASELINE ? has.length === 0 : has.includes(b),
    );
    if (!match) return false;
  }
  if (query.family.length && !query.family.includes(control.family))
    return false;
  if (query.status.length && !query.status.includes(control.status))
    return false;
  return true;
}

// The 20 control-family codes, the same set in both catalogs. A bare two-letter query equal to one of these is an identifier (family) query; any other short string ("in", "io", "to") stays free text.
// Exported so the suite can prove coverage over every family rather than against a copied list that would drift.
export const FAMILY_CODES: ReadonlySet<string> = new Set([
  "AC",
  "AT",
  "AU",
  "CA",
  "CM",
  "CP",
  "IA",
  "IR",
  "MA",
  "MP",
  "PE",
  "PL",
  "PM",
  "PS",
  "PT",
  "RA",
  "SA",
  "SC",
  "SI",
  "SR",
]);

/** An identifier-shaped query: a family code with a number, or a bare family code. */
export function isIdentifierQuery(text: string): boolean {
  const q = text.trim().toLowerCase();
  return (
    /^[a-z]{2}[-\s]?\d/.test(q) ||
    (/^[a-z]{2}$/.test(q) && FAMILY_CODES.has(q.toUpperCase()))
  );
}

/**
 * Client-side text match. An identifier-shaped query — a family code with a number
 * ("AC-2", "ac02", "AC-02(01)") or a bare family code ("AC") — matches the control NUMBER
 * by prefix only. Any other query is free text, matched against the control name.
 *
 * Splitting these is deliberate: a bare substring match let "AC" match every control
 * whose *name* merely contained the letters "ac" (SC-21 "…Caching Resolver", "…Backup",
 * "…Placement"), which is invisible and confusing in the diagram. The bare-code branch is
 * gated on the real family-code set so a two-letter English word ("in", "io") doesn't get
 * routed to the number path and blank the whole diagram.
 *
 * Statement prose, discussion and ZT-guidance text are still matched server-side, because
 * the diagram's dataset does not carry them. They reach this predicate as `serverMatches`
 * rather than by shipping the prose to the client — and they apply to free-text queries
 * only. An identifier query keeps the prefix rule as its sole authority, since the
 * server's substring matching would otherwise reintroduce the exact behaviour that split
 * was built to prevent.
 */
export function matchesText(
  control: FilterableControl,
  text: string,
  serverMatches?: ReadonlySet<string>,
): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const isIdQuery = isIdentifierQuery(q);
  // An identifier query is answered here and only here. The server matches control
  // numbers as a raw case-insensitive substring over names, discussion, statement text
  // and ZT guidance, which is the opposite of what an identifier means: "AC" appears
  // inside "access", "account" and "each", so consulting the server first returns most
  // of the catalog for a two-letter family code. Worse, it is not merely noisy —
  // "ac-3" matches the controls whose prose cites AC-3 while missing AC-03 itself,
  // because the number is stored zero-padded. The prefix rule below is the whole
  // reason the number/name split exists; letting a substring match pre-empt it undoes it.
  if (isIdQuery) {
    return normalizeControlId(control.id).startsWith(normalizeControlId(q));
  }
  // Free text only: the server has searched prose this dataset does not carry, so take
  // its verdict or the local name match. Absent a server answer — under two characters,
  // or in flight — this is exactly the behaviour that shipped before.
  return (
    control.name.toLowerCase().includes(q) || !!serverMatches?.has(control.id)
  );
}

/**
 * The single predicate: shown iff it passes every facet AND the text query.
 *
 * `serverMatches` is the uncapped control-number list from decoder.searchControls,
 * threaded in so the diagram narrows on the same scope the typeahead searches. It is
 * optional and absent whenever the server has no answer — under two characters, or
 * while the request is in flight — in which case this behaves exactly as it did before.
 */
export function matchesQuery(
  control: FilterableControl,
  query: FilterQuery,
  serverMatches?: ReadonlySet<string>,
): boolean {
  return (
    passesFacets(control, query) && matchesText(control, query.q, serverMatches)
  );
}

/** True when any facet or the search box is active. */
export function isQueryActive(query: FilterQuery): boolean {
  return (
    query.pillar.length > 0 ||
    query.maturity.length > 0 ||
    query.designation.length > 0 ||
    query.baseline.length > 0 ||
    query.family.length > 0 ||
    query.status.length > 0 ||
    query.q.trim().length > 0
  );
}
