import { createLoader, createParser, createSerializer } from "nuqs/server";

import { FILTER_PARSERS } from "./queryParsers";

// Building and reading a control's address from the filters. The parsers themselves
// live in queryParsers.ts, the URL contract shared with the export route and Standard;
// this file holds what only the control route needs. `nuqs/server` is the entry
// that is safe in server code, the proxy and the client alike.

/**
 * The filters as a query string ("?pillar=IDENTITY", or "" when none are set), for the
 * links that move between `/` and `/control/[id]`. Built from parsed values rather than
 * copied from the address bar, so a stray or malformed parameter is never carried along.
 * clearOnDefault keeps empty facets out, as the hook's own writes do.
 */
export const serializeFilters = createSerializer(FILTER_PARSERS, {
  clearOnDefault: true,
});

/** Parse the filters out of a page's `searchParams`, dropping anything invalid. */
export const loadFilters = createLoader(FILTER_PARSERS);

/** What `?enh` may hold: an enhancement's number, one or two digits. */
export const ENHANCEMENT = /^\d{1,2}$/;

/**
 * `?enh`, the open enhancement tab, as two digits ("01"), or null for the base tab.
 * Anything that isn't one or two digits reads as no tab. Whether the control has that
 * enhancement is the reader's to check: the server redirects an unknown one away, and
 * the modal shows the base tab for one it meets without that check.
 */
export const parseAsEnhancement = createParser({
  parse: (value) => (ENHANCEMENT.test(value) ? value.padStart(2, "0") : null),
  serialize: (value: string) => value,
});

/**
 * What `?item` may hold: an item's path inside a control's statement, the part after
 * `_smt.` (`k` for `ac-2_smt.k`, `a.1` for `ac-2_smt.a.1`). Up to four short
 * letter-and-digit segments; the catalog's go three deep.
 */
export const ITEM = /^[a-z0-9]{1,2}(\.[a-z0-9]{1,2}){0,3}$/;

/**
 * `?item`, the statement item a successor link highlighted, or null for none. Anything
 * that isn't a short letter-and-digit path reads as none. One the statement doesn't have
 * highlights nothing.
 */
export const parseAsItem = createParser({
  parse: (value) => (ITEM.test(value) ? value : null),
  serialize: (value: string) => value,
});

/** A page's `searchParams`, or the same shape built from a request's query. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * A control's address: its id, then the filters, then the enhancement, then the item.
 *
 * The filters stay as serializeFilters writes them, the same string the cake's links
 * use, so a redirect lands on the address a click would have given. URLSearchParams
 * would turn "," into "%2C" and make two addresses for one view. What the serializer
 * leaves raw outside printable ASCII is percent-encoded: the address goes into a
 * Location header, and Node rejects a header with a character above U+00FF, which
 * turns the redirect into a 500. `enh` is one or two digits by now, and `item` has
 * passed ITEM, so neither needs encoding.
 *
 * Here rather than in the control route's server code so proxy.ts, the cake and the
 * modal's cross-reference links build the same address. `search` is a page's query, as
 * the route receives it, or the "?…" string useDecoderQuery serializes.
 */
export function controlHref(
  id: string,
  enhancement: string | null,
  search: SearchParams | string,
  item: string | null = null,
): string {
  const filters = serializeFilters(loadFilters(search))
    .replace(/^\?/, "")
    .replace(/[^\x21-\x7e]+/g, encodeURIComponent);
  const enh = enhancement ? `enh=${enhancement}` : "";
  const it = item ? `item=${item}` : "";
  const qs = [filters, enh, it].filter(Boolean).join("&");
  return `/control/${id}${qs ? `?${qs}` : ""}`;
}
