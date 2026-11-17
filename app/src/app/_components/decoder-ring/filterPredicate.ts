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
  /** Its own Zero Trust rows. */
  zeroTrust: ZeroTrustRow[];
  /** Its enhancements' Zero Trust rows and baselines, in catalog order, so a facet can match through them. */
  enhancements?: Array<{
    id: string;
    name?: string;
    zeroTrust: ZeroTrustRow[];
    baselines?: string[];
  }>;
  /** The catalog baselines that include the control, as the catalog spells them. */
  baselines?: string[];
  /** Every baseline that includes at least one of the control's enhancements. */
  enhancementBaselines?: string[];
}

/** One Zero Trust row: a pillar at a maturity, with CISA's designation. A mapping with no affinity rows has one row naming its pillars joined. */
export interface ZeroTrustRow {
  pillar: string;
  maturity: string;
  designation?: string | null;
}

/** The facets a Zero Trust row carries. */
type RowFacets = Pick<FilterQuery, "pillar" | "maturity" | "designation">;

/** A row passes the pillar, maturity and designation facets when it is in every active one. */
export const rowPasses = (row: ZeroTrustRow, query: RowFacets): boolean =>
  (!query.pillar.length ||
    row.pillar.split(", ").some((p) => query.pillar.includes(p))) &&
  (!query.maturity.length || query.maturity.includes(row.maturity)) &&
  (!query.designation.length ||
    (!!row.designation && query.designation.includes(row.designation)));

const ztFacetActive = (query: RowFacets) =>
  query.pillar.length > 0 ||
  query.maturity.length > 0 ||
  query.designation.length > 0;

/** True when one of the control's own rows passes the row facets. */
export const ownRowPasses = (
  control: Pick<FilterableControl, "zeroTrust">,
  query: RowFacets,
): boolean =>
  !ztFacetActive(query) || control.zeroTrust.some((r) => rowPasses(r, query));

/**
 * The enhancements that pass the row facets on a row of their own and the baseline facet
 * on their own baselines, as the export filters them; none when no row facet is active.
 */
export const matchingEnhancements = (
  control: Pick<FilterableControl, "enhancements">,
  query: RowFacets & Pick<FilterQuery, "baseline">,
): string[] =>
  ztFacetActive(query)
    ? (control.enhancements ?? [])
        .filter(
          (e) =>
            e.zeroTrust.some((r) => rowPasses(r, query)) &&
            inBaseline(e.baselines ?? [], query),
        )
        .map((e) => e.id)
    : [];

/** True when the baselines pass the baseline facet; "in no baseline" is an empty list. */
function inBaseline(
  baselines: string[],
  query: Pick<FilterQuery, "baseline">,
): boolean {
  if (!query.baseline.length) return true;
  const has = baselines.map(baselineKey);
  return query.baseline.some((b) =>
    b === NO_BASELINE ? has.length === 0 : has.includes(b),
  );
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
 * constraint. The pillar, maturity and designation facets match on one row: a control
 * passes when one of its own rows is in every active one, or an enhancement passes them
 * and the baseline facet itself, so one control or enhancement meets them all. A
 * compliance-only control has no rows, so a ZT facet hides it.
 */
export function passesFacets(
  control: FilterableControl,
  query: FilterQuery,
): boolean {
  const own = ownRowPasses(control, query);
  if (!own && matchingEnhancements(control, query).length === 0) return false;
  // Inclusive: a control matches a baseline when it or any of its enhancements is in
  // it, and is "in no baseline" only when neither it nor any enhancement is in one. A
  // match through an enhancement has already met the baseline facet itself.
  if (
    own &&
    !inBaseline(
      [...(control.baselines ?? []), ...(control.enhancementBaselines ?? [])],
      query,
    )
  )
    return false;
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
 * ("AC-2", "ac02", "AC-02(01)") or a bare family code ("AC") — matches the control NUMBER:
 * by prefix until the number is whole (two digits, "AC-02", which is not AC-24), then
 * whole. A typed enhancement matches itself and its base. Any other query is free text,
 * matched against the control name.
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
  control: Pick<FilterableControl, "id" | "name">,
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
    const id = normalizeControlId(control.id);
    const key = normalizeControlId(q);
    // A typed enhancement, even before its number ("AC-02("), names its base whole, and
    // the base matches too, so the diagram shows where it sits. Its number matches whole
    // once it has two digits or a closing parenthesis, so "AC-02(01)" is not also
    // AC-02(11); before that it matches by the digits typed, so "AC-02(1" still offers
    // (10) to (19).
    const [idBase, idEnh] = id.split(".");
    if (/[.(]$/.test(q)) return idBase === key;
    if (!key.includes(".")) {
      const [, digits = ""] = /^[a-z]{2}[-\s]?(\d+)/.exec(q) ?? [];
      return digits.length >= 2 ? idBase === key : id.startsWith(key);
    }
    const [keyBase, keyEnh] = key.split(".");
    if (idBase !== keyBase) return false;
    if (idEnh === undefined) return true;
    const [, digits = "", closed] = /[.(](\d+)(\))?/.exec(q) ?? [];
    if (digits.length >= 2 || closed) return idEnh === keyEnh;
    return digits === "0" ? idEnh.length === 1 : idEnh.startsWith(digits);
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

/** An enhancement the search lists as a result of its own. */
export interface EnhancementResult {
  id: string;
  name: string;
  base: string;
}

/**
 * The enhancements search lists under a pillar, maturity or designation filter, in catalog
 * order: each that matches the filters through `matchingEnhancements`, of a base the
 * filters show, when its own number or name matches the text or, for free text, its base
 * is a search hit. An identifier query never takes the server's hits, as `matchesText`
 * explains.
 *
 * So search can list more than the diagram shows: free text lists an enhancement on its
 * own name while its base, whose name does not match, is dimmed ("compil" lists AU-02(01)
 * Compilation under a dimmed AU-02).
 */
export function enhancementResults(
  controls: readonly FilterableControl[],
  query: FilterQuery,
  hitIds: ReadonlySet<string>,
): EnhancementResult[] {
  if (!ztFacetActive(query)) return [];
  const freeText = !isIdentifierQuery(query.q);
  return controls.flatMap((control) => {
    if (!passesFacets(control, query)) return [];
    const matched = new Set(matchingEnhancements(control, query));
    return (control.enhancements ?? []).flatMap((e) => {
      const result = { id: e.id, name: e.name ?? "", base: control.id };
      return matched.has(e.id) &&
        ((freeText && hitIds.has(control.id)) || matchesText(result, query.q))
        ? [result]
        : [];
    });
  });
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
