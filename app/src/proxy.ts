import { NextResponse, type NextRequest } from "next/server";

import {
  controlHref,
  ENHANCEMENT,
  ITEM,
  type SearchParams,
} from "~/app/_components/decoder-ring/filterParams";
import { normalizeControlId } from "~/lib/control-id";

/**
 * Redirect a percent-encoded spelling of a control id, `/control/AC%2D02` or
 * `/control/%41C-02`, to the id's stored form, so each control keeps one address.
 *
 * It has to happen here: Next decodes the segment before the page sees it, so to
 * resolveControlRoute "AC%2D02" already reads "AC-02" and looks canonical. The target
 * is normalized, which never contains "%", so it can't redirect again. Anything that
 * doesn't decode to an id is passed on for the page to 404. No database access: an
 * enhancement id lands on its stored form and the page takes it from there.
 */
export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.slice("/control/".length);
  if (!segment.includes("%")) return NextResponse.next();

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return NextResponse.next();
  }
  const id = normalizeControlId(decoded);
  if (id === null) return NextResponse.next();

  // The query is rebuilt the way the page's own redirect builds it. Copying it through
  // won't do: Next has already re-encoded it by now, "," as "%2C".
  const search: SearchParams = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    search[key] = values.length === 1 ? values[0] : values;
  }
  const enh = request.nextUrl.searchParams.get("enh");
  const item = request.nextUrl.searchParams.get("item");
  const href = controlHref(
    id,
    enh && ENHANCEMENT.test(enh) ? enh : null,
    search,
    item && ITEM.test(item) ? item : null,
  );
  return NextResponse.redirect(new URL(href, request.url), 307);
}

export const config = { matcher: "/control/:id" };
