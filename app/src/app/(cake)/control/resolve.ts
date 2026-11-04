import "server-only";

import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import {
  controlHref,
  ENHANCEMENT,
  ITEM,
  type SearchParams,
} from "~/app/_components/decoder-ring/filterParams";
import { product } from "~/config/product";
import { normalizeControlId, splitControlId } from "~/lib/control-id";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/server";

/**
 * The server side of `/control/[id]`, shared by the direct-load page and the
 * intercepted modal route so both resolve an address the same way.
 *
 * Everything in the path and the query is untrusted: a shared link puts it there. The
 * id must normalize before it reaches a redirect, the API or the page, `?enh` must be one
 * or two digits and `?item` a short letter-and-digit path before either goes into a
 * redirect. An unknown id is a 404 whose page does not repeat what was asked for.
 */

/**
 * Typed by hand rather than with Next's generated `PageProps<"/control/[id]">`: that
 * global only exists once `.next/types` has been generated, and `tsc --noEmit` on a
 * fresh checkout (CI) runs before any build.
 */
export interface ControlRouteProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

/** A control's detail as getControlById returns it. */
export type ControlDetail = RouterOutputs["decoder"]["getControlById"];

/**
 * getControlById for one base id, or null when the router says NOT_FOUND. Any other
 * failure is a real error and is rethrown.
 *
 * Through the router rather than a catalog table, so the router's own rule for what
 * exists applies, withdrawn controls included. Wrapped in React `cache` because the page and its metadata both ask,
 * and within one request they share the one query.
 */
const lookupControl = cache(
  async (base: string): Promise<ControlDetail | null> => {
    try {
      return await api.decoder.getControlById({ controlId: base });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  },
);

/** A path segment decoded, or null when its percent-encoding is malformed. */
function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function all(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/**
 * Resolve `/control/[id]` to the control it names, or end the request: a redirect to
 * the stored form for a loose or percent-encoded spelling, an enhancement id, a `?enh`
 * that is not exactly one zero-padded number or names no enhancement of the control,
 * and a 404 for anything that is not a control in the catalog.
 *
 * An enhancement is normally a tab on its base control, so it is served at the base
 * with `?enh`. An enhancement whose base isn't in the catalog would be its own chip on
 * the cake, and is served under its full id.
 * Telling the two apart takes a lookup of the base.
 *
 * Returns the control's detail too. The existence check has to fetch it anyway, so the
 * modal starts from it instead of asking the API for it a second time.
 */
export async function resolveControlRoute(
  rawId: string,
  search: SearchParams,
): Promise<{
  id: string;
  enhancement: string | null;
  detail: ControlDetail;
}> {
  const typed = decode(rawId);
  const normalized = typed === null ? null : normalizeControlId(typed);
  if (normalized === null) notFound();

  const { base, enhancement: fromId } = splitControlId(normalized);
  const asked = all(search.enh);
  const valid = asked.length === 1 && ENHANCEMENT.test(asked[0]!);
  const enhancement = fromId ?? (valid ? asked[0]!.padStart(2, "0") : null);

  const baseDetail = enhancement === null ? null : await lookupControl(base);
  const standalone = enhancement !== null && baseDetail === null;
  const id = standalone ? `${base}(${enhancement})` : base;
  // An enhancement the base doesn't have is dropped, so the address names the base tab
  // the modal would show rather than a tab that isn't there.
  const known =
    baseDetail?.enhancements.some((e) => e.id === `${base}(${enhancement})`) ??
    false;
  const servedEnhancement = known ? enhancement : null;

  // The highlighted item rides along on any redirect, so a successor link to another
  // control's enhancement (AC-17(01)?item=a) still lands on the item. A malformed or
  // repeated one is dropped from the address. So is one asked for on a tab the address
  // can't serve: on the base it would highlight an item the link never meant. One the
  // statement doesn't have is left; it highlights nothing.
  const askedTab = fromId !== null || asked.length > 0;
  const tabLost = askedTab && servedEnhancement === null && !standalone;
  const askedItem = all(search.item);
  const item =
    !tabLost && askedItem.length === 1 && ITEM.test(askedItem[0]!)
      ? askedItem[0]!
      : null;
  const badItem = askedItem.length > 0 && item === null;

  // Next has already decoded the segment; a percent-encoded spelling is redirected by
  // proxy.ts before it gets here.
  const badEnhancement = asked.length > 0 && asked[0] !== servedEnhancement;
  if (rawId !== id || badEnhancement || badItem) {
    redirect(controlHref(id, servedEnhancement, search, item));
  }

  // Only NOT_FOUND becomes a 404; any other failure is a real error and stays one.
  const detail = baseDetail ?? (await lookupControl(id));
  if (detail === null) notFound();

  return { id, enhancement: servedEnhancement, detail };
}

/**
 * The tab title: the control's id, or a fixed "Control not found" when the path is not
 * an id or names one the catalog doesn't have, so the 404 for `/control/ZZ-99` isn't
 * titled "ZZ-99". If the lookup fails outright, the title stays the id and the page's
 * error boundary says what happened.
 */
export async function controlMetadata({
  params,
}: Pick<ControlRouteProps, "params">): Promise<Metadata> {
  const { id: rawId } = await params;
  const typed = decode(rawId);
  const normalized = typed === null ? null : normalizeControlId(typed);
  const notFoundTitle = {
    title: `Control not found · ${product.metadataTitle}`,
  };
  if (normalized === null) return notFoundTitle;

  const titled = (id: string) => ({
    title: `${id} · ${product.metadataTitle}`,
  });
  const found = (id: string) =>
    lookupControl(id).then(
      (detail) => detail !== null,
      () => true,
    );

  // An address that isn't the stored form redirects before the page renders, so its
  // title is never shown: skip the lookup rather than run a query for nothing. An
  // enhancement id needs the base's lookup to know where it is served, as the page does.
  const { base, enhancement } = splitControlId(normalized);
  if (enhancement === null && rawId !== base) return titled(base);
  const id = enhancement !== null && !(await found(base)) ? normalized : base;
  if (rawId !== id) return titled(id);
  return (await found(id)) ? titled(id) : notFoundTitle;
}
