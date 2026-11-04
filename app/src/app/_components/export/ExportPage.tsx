"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import {
  createSerializer,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from "nuqs";

import FilterBar from "~/app/_components/decoder-ring/FilterBar";
import SearchTypeahead from "~/app/_components/decoder-ring/SearchTypeahead";
import { isQueryActive } from "~/app/_components/decoder-ring/filterPredicate";
import { FILTER_PARSERS } from "~/app/_components/decoder-ring/queryParsers";
import { useDecoderQuery } from "~/app/_components/decoder-ring/useDecoderQuery";
import { LINE_DATASETS, LINE_FIELDS } from "~/lib/export/from-detail";
import type { ExportDataset, ExportField } from "~/lib/export/record";
import {
  droppedExportValues,
  EXPORT_ENHANCEMENTS,
  EXPORT_FORMATS,
  EXPORT_PARSERS,
} from "~/lib/export/selection";
import { api } from "~/trpc/react";
import { RateLimited } from "~/trpc/rate-limited";
import ControlPicker from "./ControlPicker";
import { STATUS_MESSAGE, useExportDownload } from "./useExportDownload";

const PAGE_PARSERS = {
  ...EXPORT_PARSERS,
  format: parseAsStringEnum([...EXPORT_FORMATS]).withDefault("xlsx"),
};
const OPTIONS = { history: "replace", clearOnDefault: true } as const;
const toDownload = createSerializer(PAGE_PARSERS);
const toDiagram = createSerializer(FILTER_PARSERS);
// The same keys as written in the address bar, to find what the parsers quietly dropped.
const RAW_PARSERS = Object.fromEntries(
  Object.keys(PAGE_PARSERS).map((k) => [k, parseAsString]),
) as Record<keyof typeof PAGE_PARSERS, typeof parseAsString>;

const DATASET_LABELS: Record<ExportDataset, string> = {
  statement: "Statement, parameters and discussion",
  assessment: "Assessment procedures",
  zeroTrust: "Zero Trust guidance",
  references: "References",
};
const FIELD_LABELS: Record<ExportField, string> = {
  baselines: "Baselines",
  frequency: "Frequency",
  priority: "Priority",
  lineage: "Withdrawn status and lineage",
};
const ENHANCEMENT_LABELS: Record<(typeof EXPORT_ENHANCEMENTS)[number], string> =
  {
    with: "Each control with its enhancements",
    without: "Base controls only",
    only: "Only their enhancements",
  };

/** Past this many controls a DOCX is long enough that the page suggests the spreadsheet. */
export const LARGE_DOCX = 200;
/** A rough page count: about two controls to a page, from whole-catalog documents. */
export const docxPages = (controls: number) =>
  Math.max(10, Math.round(controls / 2 / 10) * 10);

/**
 * No retry for a refused selection, or for the load balancer's rate limit, where retrying
 * only adds to the count. A gateway error or a network failure is retried.
 */
export const retryCount = (
  failures: number,
  err: { data?: { code?: string } | null; cause?: unknown },
) =>
  err.data?.code !== "BAD_REQUEST" &&
  !(err.cause instanceof RateLimited) &&
  failures < 3;

// The design system's unlayered element rules (fieldset, legend, headings, links) beat
// Tailwind's layered utilities, so sections are headed cards and the overrides are marked
// important, as the filter bar does.
function Section({
  title,
  hint,
  role,
  children,
}: {
  title: string;
  hint?: string;
  /** The role of the options inside, labelled by the section's title. */
  role?: "group" | "radiogroup";
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 id={id} className="m-0! text-base! font-semibold! text-slate-800">
        {title}
      </h2>
      {hint && <p className="mt-1 mb-0! text-xs text-slate-500">{hint}</p>}
      <div role={role} aria-labelledby={role ? id : undefined} className="mt-3">
        {children}
      </div>
    </section>
  );
}

// flex! and my-0!: the design system's unlayered label rule beats Tailwind's layered utilities.
const OPTION =
  "my-0! flex! cursor-pointer items-center gap-2 text-sm text-slate-700";
const CONTROL =
  "h-4 w-4 shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500";
const DOWNLOAD =
  "rounded-lg px-4 py-2 text-sm font-semibold text-white! no-underline! focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none";

/**
 * Build an export and download it. The page's URL is the export's own selection
 * (~/lib/export/selection) plus the format, so the download link is that same query
 * string on /api/export, and a copied link reproduces the file.
 */
export default function ExportPage() {
  const [state, setState] = useQueryStates(PAGE_PARSERS, OPTIONS);
  const [raw] = useQueryStates(RAW_PARSERS);
  const { clear } = useDecoderQuery();
  const { status, download } = useExportDownload();
  const includeId = useId();
  const { format, ...selection } = state;

  const { data: bridge } = api.decoder.getBridgeData.useQuery(undefined, {
    staleTime: Infinity,
  });
  // The link's own values, refused as /api/export would refuse them, so a hand-edited link
  // is never quietly widened: `baseline=BOGUS` or an empty `pick=` would be the whole catalog.
  const params = new URLSearchParams(
    Object.entries(raw).flatMap(([k, v]) => (v === null ? [] : [[k, v]])),
  );
  const invalid = [
    ...droppedExportValues(params, selection),
    ...(["enhancements", "format"] as const).filter(
      (k) => raw[k] !== null && raw[k] !== state[k],
    ),
    ...(raw.pick === "" ? ["pick"] : []),
  ];
  // Content and details change what each control carries, not which controls, so the
  // count leaves them out and toggling them does not count again.
  const {
    data: counted,
    isFetching: counting,
    isPlaceholderData: stale,
    error: countError,
  } = api.decoder.countExport.useQuery(
    { ...selection, data: [], fields: [] },
    {
      placeholderData: (previous) => previous,
      // A link the page refuses is not counted: it would only count a widened selection.
      enabled: invalid.length === 0,
      retry: retryCount,
    },
  );
  const count = counted?.count;

  const href = toDownload("/api/export", state);
  const picked = selection.pick.length > 0;
  // Only what this app offers, so a toggle never writes an option the page does not show.
  const data = selection.data.filter((d) => LINE_DATASETS.includes(d));
  const fields = selection.fields.filter((f) => LINE_FIELDS.includes(f));
  const empty = data.length === 0 && fields.length === 0;
  // The server's own reason when it refuses the selection, such as a pick that matches
  // nothing; a malformed input gets a plain sentence rather than the validator's detail.
  const blocked =
    invalid.length > 0
      ? `This link's selection isn't valid (${invalid.join(", ")}). Change or clear it to continue.`
      : countError?.data?.code === "BAD_REQUEST"
        ? countError.data.zodError
          ? "This link's selection isn't valid."
          : countError.message
        : count === 0
          ? "This selection has no controls."
          : null;
  // A count still on its way, or the previous selection's while the new one is counted.
  const settling = !blocked && !countError && (stale || count === undefined);

  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-2">
          <h1 className="m-0! text-2xl! font-black! tracking-tight text-slate-800">
            Export controls
          </h1>
          <Link
            href={toDiagram("/", selection)}
            className="text-sm font-medium text-blue-600! hover:underline"
          >
            Back to the decoder ring
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
        <Section
          title="Controls"
          hint={
            picked
              ? "Picks are exported as they are; the filters below do not apply while there are picks."
              : "Filter the catalog as the main view does. With no filter, every current control is exported; pick a withdrawn control to export it."
          }
        >
          <div className={`flex flex-col gap-2 ${picked ? "opacity-50" : ""}`}>
            <SearchTypeahead />
            {bridge && (
              <FilterBar
                families={bridge.families}
                onClear={() => void clear()}
              />
            )}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ControlPicker
              picks={selection.pick}
              onChange={(pick) => void setState({ pick })}
            />
          </div>
        </Section>

        <Section
          title="Enhancements"
          hint="What each base control brings. A picked enhancement is always exported on its own."
          role="radiogroup"
        >
          <div className="flex flex-col gap-1.5">
            {EXPORT_ENHANCEMENTS.map((value) => (
              <label key={value} className={OPTION}>
                <input
                  type="radio"
                  name="enhancements"
                  checked={selection.enhancements === value}
                  onChange={() => void setState({ enhancements: value })}
                  className={CONTROL}
                />
                {ENHANCEMENT_LABELS[value]}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Include">
          <div className="grid gap-4 sm:grid-cols-2">
            <div
              role="group"
              aria-labelledby={`${includeId}-content`}
              className="flex flex-col gap-1.5"
            >
              <p
                id={`${includeId}-content`}
                className="m-0! text-xs font-semibold tracking-wide text-slate-500 uppercase"
              >
                Content
              </p>
              {LINE_DATASETS.map((d) => (
                <label key={d} className={OPTION}>
                  <input
                    type="checkbox"
                    checked={data.includes(d)}
                    onChange={() => void setState({ data: toggle(data, d) })}
                    className={CONTROL}
                  />
                  {DATASET_LABELS[d]}
                </label>
              ))}
            </div>
            <div
              role="group"
              aria-labelledby={`${includeId}-details`}
              className="flex flex-col gap-1.5"
            >
              <p
                id={`${includeId}-details`}
                className="m-0! text-xs font-semibold tracking-wide text-slate-500 uppercase"
              >
                Details
              </p>
              {LINE_FIELDS.map((f) => (
                <label key={f} className={OPTION}>
                  <input
                    type="checkbox"
                    checked={fields.includes(f)}
                    onChange={() =>
                      void setState({ fields: toggle(fields, f) })
                    }
                    className={CONTROL}
                  />
                  {FIELD_LABELS[f]}
                </label>
              ))}
            </div>
          </div>
          {empty && (
            <p className="mt-3 text-xs text-slate-500">
              With nothing ticked, the export lists each control&rsquo;s number,
              name and family.
            </p>
          )}
        </Section>

        <Section title="Format" role="radiogroup">
          <div className="flex flex-col gap-1.5">
            <label className={OPTION}>
              <input
                type="radio"
                name="format"
                checked={format === "xlsx"}
                onChange={() => void setState({ format: "xlsx" })}
                className={CONTROL}
              />
              Spreadsheet (XLSX): one sheet per kind of content, easy to filter
              and search
            </label>
            <label className={OPTION}>
              <input
                type="radio"
                name="format"
                checked={format === "docx"}
                onChange={() => void setState({ format: "docx" })}
                className={CONTROL}
              />
              Document (DOCX): a heading per control, for an SSP section or an
              assessment package
            </label>
          </div>
          {format === "docx" && count !== undefined && count > LARGE_DOCX && (
            <p
              role="note"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {count} controls make a document of roughly {docxPages(count)}{" "}
              pages. The spreadsheet is easier to filter and search at this
              size.{" "}
              <button
                type="button"
                onClick={() => void setState({ format: "xlsx" })}
                className="font-medium underline"
              >
                Use the spreadsheet
              </button>
            </p>
          )}
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          {blocked || settling ? (
            <button
              type="button"
              disabled
              className={`${DOWNLOAD} cursor-not-allowed bg-slate-400`}
            >
              Download {format.toUpperCase()}
            </button>
          ) : (
            <a
              href={href}
              aria-disabled={status.kind === "pending"}
              onClick={(e) => {
                e.preventDefault();
                if (status.kind !== "pending")
                  void download(href, `export.${format}`);
              }}
              className={`${DOWNLOAD} ${
                status.kind === "pending"
                  ? "cursor-not-allowed bg-slate-400"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {status.kind === "pending"
                ? "Preparing the file…"
                : `Download ${format.toUpperCase()}`}
            </a>
          )}
          <p aria-live="polite" className="text-sm text-slate-600">
            {blocked ??
              (countError
                ? "The control count is unavailable. Try again in a few minutes."
                : settling || count === undefined
                  ? "Counting…"
                  : `${count} ${count === 1 ? "control" : "controls"}${counting ? "…" : ""}`)}
          </p>
          {invalid.length > 0 && (
            <button
              type="button"
              onClick={() =>
                void setState(Object.fromEntries(invalid.map((k) => [k, null])))
              }
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Clear {invalid.join(", ")}
            </button>
          )}
        </div>
        <div aria-live="assertive" className="text-sm">
          {status.kind === "pending" && (
            <p className="text-slate-600">{STATUS_MESSAGE.pending}</p>
          )}
          {(status.kind === "busy" || status.kind === "limited") && (
            <p className="text-amber-800">{STATUS_MESSAGE[status.kind]}</p>
          )}
          {status.kind === "failed" && (
            <p className="text-red-700">{status.message}</p>
          )}
        </div>
        {!isQueryActive(selection) && !picked && (
          <p className="text-xs text-slate-500">
            No filter or pick is set, so this is every current control.
          </p>
        )}
      </main>
    </div>
  );
}
