/**
 * Static / format URL validators — the deterministic, side-effect-free core
 * of the link-checker. This module is the ONE part of scripts/check-links
 * that stays under unit-test coverage (see app/vitest.config.ts); the source
 * collectors (db/seed-sql/api) and the live HTTP prober are side-effectful and
 * are coverage-excluded.
 *
 * These checks are the HARD GATE: any failure here makes the CLI exit non-zero
 * regardless of --live. They catch the malformed URLs that creep into seed data
 * when a link is pasted rather than parsed — a double scheme
 * (`https://a.gov/https://b.gov/...`) or unencoded whitespace in a path.
 *
 * Nothing here knows a host. A rule about what one site's paths look like belongs
 * to that site's corpus (its override table and redirect report under
 * prisma/generators/reference-links/), not to the format gate every corpus shares.
 */

/** A URL paired with the record it came from, so failures are actionable. */
export interface UrlRecord {
  /** Owning record id, e.g. a ReferenceLink id, NistControl controlNumber, or an API path. */
  id: string;
  /** Which source / column the URL came from, e.g. "ReferenceLink.url". */
  source: string;
  /** The raw URL string as stored / served. */
  url: string;
}

/** Machine-readable reason a URL failed static validation. */
export type FormatFailureCode =
  "empty" | "double-scheme" | "whitespace" | "non-http-scheme" | "malformed";

export interface FormatFailure {
  record: UrlRecord;
  code: FormatFailureCode;
  detail: string;
}

/**
 * Detect a second scheme embedded after the host, e.g.
 *   https://a.gov/https://b.gov/posts/...
 * The leading `https?://` is consumed first, then we look for another
 * `http://` or `https://` anywhere in the remainder.
 */
const DOUBLE_SCHEME = /^https?:\/\/.*https?:\/\//i;

/** Any ASCII whitespace (space, tab, newline, CR, FF, VT) inside the URL. */
const WHITESPACE = /\s/;

/** Leading scheme matcher — used to classify the scheme before WHATWG parsing. */
const LEADING_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * Validate a single URL's FORMAT. Returns a FormatFailure if it fails any
 * static check, or null if it is well-formed. The check order is deliberate:
 * cheap structural checks (empty / whitespace / double-scheme) run before the
 * WHATWG `URL` parse so the most actionable, specific code is reported.
 */
export function validateFormat(record: UrlRecord): FormatFailure | null {
  const raw = record.url;

  if (raw === null || raw === undefined || raw.trim() === "") {
    return { record, code: "empty", detail: "URL is empty or whitespace-only" };
  }

  // Unencoded whitespace — spaces in a path must be percent-encoded (%20).
  // Checked before double-scheme so "https://host/A B https://x" reports the
  // whitespace (the thing a human fixes) rather than the scheme artifact.
  if (WHITESPACE.test(raw)) {
    return {
      record,
      code: "whitespace",
      detail: "URL contains unencoded whitespace",
    };
  }

  // Double-scheme: a malformed concatenation like https://a.gov/https://b.gov/...
  if (DOUBLE_SCHEME.test(raw)) {
    return {
      record,
      code: "double-scheme",
      detail: "URL contains a second scheme embedded after the host",
    };
  }

  // Scheme must be http(s). A relative URL (no scheme) or a non-web scheme
  // (mailto:, ftp:, javascript:) is rejected — these are links meant to be
  // followed in a browser.
  const schemeMatch = LEADING_SCHEME.exec(raw);
  if (!schemeMatch) {
    return {
      record,
      code: "non-http-scheme",
      detail: "URL has no scheme (relative or scheme-less)",
    };
  }
  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return {
      record,
      code: "non-http-scheme",
      detail: `URL scheme is "${scheme}", expected http or https`,
    };
  }

  // Final structural gate: WHATWG URL parser. Catches malformations the
  // targeted regexes don't (missing host, bad authority, etc.).
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      record,
      code: "malformed",
      detail: "URL failed WHATWG URL parsing",
    };
  }

  // A scheme-only or host-less URL ("https://") parses in some engines with an
  // empty host — reject it explicitly so it can't pass as well-formed.
  if (!parsed.hostname) {
    return {
      record,
      code: "malformed",
      detail: "URL has no host",
    };
  }

  return null;
}

/**
 * Validate a batch of URL records. Returns only the failures (well-formed
 * URLs produce no entry). Pure: no I/O, no ordering side effects.
 */
export function validateAll(records: UrlRecord[]): FormatFailure[] {
  const failures: FormatFailure[] = [];
  for (const record of records) {
    const failure = validateFormat(record);
    if (failure) failures.push(failure);
  }
  return failures;
}

/** Human-readable one-line label for a failure code (used in the report). */
export const FORMAT_FAILURE_LABEL: Record<FormatFailureCode, string> = {
  empty: "Empty / blank URL",
  "double-scheme": "Double scheme (embedded http(s):// after host)",
  whitespace: "Unencoded whitespace",
  "non-http-scheme": "Non-http(s) or missing scheme",
  malformed: "Malformed (failed URL parse)",
};
