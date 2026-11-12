"use client";

import Link from "next/link";
import { createSerializer } from "nuqs";
import { useState, useMemo } from "react";
import { api } from "~/trpc/react";
import LayerCakeVisualization from "./LayerCakeVisualization";
import { arrangeMountain } from "./arrangeMountain";
import { useDecoderQuery } from "./useDecoderQuery";
import { FILTER_PARSERS } from "./queryParsers";
import FilterBar from "./FilterBar";
import SearchTypeahead from "./SearchTypeahead";
import { controlHref } from "./filterParams";
import { product } from "~/config/product";
import { appVersion } from "~/config/version";
import ThemeToggle from "~/app/_components/theme/ThemeToggle";

// The export page opens on the diagram's facets and search, carried in the URL.
const toExport = createSerializer(FILTER_PARSERS);

export default function DecoderRing({
  headerAccessory,
}: {
  /** Rendered at the top of the header; the page passes the sign-in control, which lays out its own row and renders nothing when sign-in is off. */
  headerAccessory?: React.ReactNode;
} = {}) {
  // Fetch the full bridge dataset once. staleTime: Infinity — this is reference data,
  // so don't refetch on focus/remount and flash a loading state mid-filter.
  const { data, isLoading, error } = api.decoder.getBridgeData.useQuery(
    undefined,
    { staleTime: Infinity },
  );
  // Mountain order is computed once from the full set (memoized on the query data,
  // which is stable via staleTime) and stays frozen across renders, so later filtering
  // dims/removes controls without ever reshuffling family positions.
  const families = useMemo(
    () => (data?.families ? arrangeMountain(data.families) : undefined),
    [data],
  );

  // URL-backed filter + search state — the Bridge is the first consumer of the shared
  // GlobalFilterQuery contract. The diagram dims non-matches and collapses empty families.
  const { query, isActive, clear, search: filterSearch } = useDecoderQuery();
  // Same query key the typeahead uses, so this subscribes to that cache entry rather
  // than issuing a second request — the prose match is computed once, server-side, and
  // read by both the dropdown and the diagram. Undefined under two characters or while
  // in flight, which is exactly when matchesQuery falls back to its client-only rules.
  const { data: search } = api.decoder.searchControls.useQuery(
    { q: query.q },
    { enabled: query.q.trim().length >= 2 },
  );
  const textMatches = useMemo(
    () => (search ? new Set(search.matchingIds) : undefined),
    [search],
  );
  // Reflow ("collapse to matches") removes non-matches instead of dimming — a view
  // toggle, off by default, surfaced in the FilterBar once a filter is active.
  const [reflow, setReflow] = useState(false);
  // Forget the reflow ("collapse") choice once no filter is active, so it doesn't reappear
  // pre-pressed ("Show all") on the next filter session — including when the last facet
  // chip is dismissed individually rather than via "Clear all". Adjusting state during
  // render (React's documented "reset on prop change" pattern) avoids a setState-in-effect
  // cascade.
  const [reflowSessionActive, setReflowSessionActive] = useState(isActive);
  if (reflowSessionActive !== isActive) {
    setReflowSessionActive(isActive);
    if (!isActive && reflow) setReflow(false);
  }

  // A control is a link to its address, so opening one lands in history: Back and
  // Forward move between the controls a reader opened, and the address can be shared,
  // opened in a new tab or copied. The @modal slot draws the modal over this page
  // (ControlModalRoute); the filters travel with the link so the cake behind it stays
  // as the reader left it. A withdrawn control, which the search offers when asked,
  // opens at its own address the same way.
  const hrefFor = (controlNumber: string) =>
    controlHref(controlNumber, null, filterSearch);

  return (
    <div className="bg-surface-canvas text-ink selection:bg-accent-muted min-h-screen font-sans">
      {/* HEADER SECTION */}
      <header className="border-border bg-surface border-b px-6 pt-3 pb-3 shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-3">
          <ThemeToggle />
          {headerAccessory}
        </div>
        <div className="mx-auto max-w-6xl text-center">
          <h1 className="text-ink mb-2 text-3xl font-black tracking-tight md:text-4xl">
            {product.bannerEyebrow}{" "}
            <span className="from-accent to-zt bg-gradient-to-br bg-clip-text text-transparent">
              DECODER RING
            </span>
          </h1>
          <p className="text-ink-muted mx-auto max-w-3xl text-sm leading-relaxed">
            A visual bridge between{" "}
            <span className="text-ink font-semibold">
              {product.bannerTitle}
            </span>{" "}
            and{" "}
            <span className="text-ink font-semibold">
              Zero Trust Architecture
            </span>
            . Select a control below to view specific implementation guidance.
          </p>
        </div>
      </header>

      {/* LOADING STATE */}
      {isLoading && (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="text-center">
            <div className="border-accent mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"></div>
            <p className="text-ink-muted">{product.loadingMessage}</p>
          </div>
        </div>
      )}

      {/* ERROR STATE */}
      {error && (
        <div className="mx-auto max-w-3xl p-8">
          <div className="border-error/30 bg-error-subtle rounded-lg border p-6 text-center">
            <p className="text-error text-lg font-semibold">
              Failed to load controls
            </p>
            <p className="text-error mt-2 text-sm">{error.message}</p>
          </div>
        </div>
      )}

      {/* SUCCESS STATE */}
      {!isLoading && !error && families && (
        <>
          {/* FILTER + SEARCH BAR */}
          <div className="mx-auto mb-3 flex max-w-[96rem] flex-col gap-2 px-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SearchTypeahead hrefFor={hrefFor} />
              <Link
                href={toExport("/export", query)}
                className="border-border-strong bg-surface text-ink hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-sm font-medium"
              >
                {isActive ? "Export this view" : "Export"}
              </Link>
            </div>
            <FilterBar
              families={families}
              reflow={reflow}
              onToggleReflow={() => setReflow((r) => !r)}
              onClear={() => {
                void clear();
                setReflow(false);
              }}
            />
          </div>

          {/* LAYER CAKE VISUALIZATION */}
          <LayerCakeVisualization
            families={families}
            query={query}
            textMatches={textMatches}
            isActive={isActive}
            reflow={reflow}
            hrefFor={hrefFor}
          />
        </>
      )}

      {/* FOOTER */}
      <footer className="border-border text-ink-muted border-t py-8 text-center text-sm">
        <p>{product.footerAttribution}</p>
        {appVersion && <p className="mt-1 text-xs">v{appVersion}</p>}
      </footer>
    </div>
  );
}
