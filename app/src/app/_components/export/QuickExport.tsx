"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { createSerializer, parseAsStringEnum } from "nuqs";

import { useDismissibleDetails } from "~/app/_components/decoder-ring/useDismissibleDetails";
import { EXPORT_FORMATS, EXPORT_PARSERS } from "~/lib/export/selection";
import { STATUS_MESSAGE, useExportDownload } from "./useExportDownload";

const serialize = createSerializer({
  ...EXPORT_PARSERS,
  format: parseAsStringEnum([...EXPORT_FORMATS]).withDefault("xlsx"),
});

// flex! and my-0!: the design system's unlayered label and link rules beat Tailwind's layers.
const ITEM =
  "flex! w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-slate-700! no-underline! hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-slate-400!";

/**
 * The control modal's export: one control, every dataset and field, in either format,
 * from a menu under the button. "More options" opens the export page with the control
 * picked, for anything else.
 */
export default function QuickExport({
  controlId,
  hasEnhancements,
}: {
  controlId: string;
  /** A base control with enhancements, which the reader may export with it or not. */
  hasEnhancements: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(ref);
  const [withEnhancements, setWithEnhancements] = useState(true);
  const { status, download } = useExportDownload();
  const selection = {
    pick: [controlId],
    enhancements:
      hasEnhancements && !withEnhancements
        ? ("without" as const)
        : ("with" as const),
  };
  const pending = status.kind === "pending";
  const message =
    status.kind === "failed"
      ? { text: status.message, tone: "text-red-700" }
      : status.kind === "idle"
        ? null
        : {
            text: STATUS_MESSAGE[status.kind],
            tone:
              status.kind === "pending" ? "text-slate-500" : "text-amber-800",
          };

  return (
    // `contents`, so the status can take its own line in the modal's action row: outside the
    // menu, it stays in view after the menu closes, and never moves the buttons.
    <div className="contents">
      {/* Opens up and rightward, inside the pane, whose scrolling clips overflow. */}
      <details ref={ref} className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none">
          <Download className="h-5 w-5" aria-hidden />
          <span>{pending ? "Preparing…" : "Export"}</span>
        </summary>
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {hasEnhancements && (
            <label className="my-0! flex! cursor-pointer items-center gap-2 border-b border-slate-100 px-3 pt-1 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={withEnhancements}
                onChange={(e) => setWithEnhancements(e.target.checked)}
                className="h-4 w-4 shrink-0 focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              Include its enhancements
            </label>
          )}
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              // aria-disabled rather than disabled, so the pressed button keeps keyboard focus.
              aria-disabled={pending}
              onClick={() => {
                if (!pending)
                  void download(
                    serialize("/api/export", { ...selection, format }),
                    `export.${format}`,
                  );
              }}
              className={ITEM}
            >
              {format === "xlsx"
                ? "Download spreadsheet (XLSX)"
                : "Download document (DOCX)"}
            </button>
          ))}
          <Link
            href={serialize("/export", selection)}
            className={`${ITEM} border-t border-slate-100`}
          >
            More options…
          </Link>
        </div>
      </details>
      {/* Always present, so a screen reader announces each change. */}
      <p aria-live="polite" className="sr-only">
        {message?.text}
      </p>
      {message && (
        <p
          aria-hidden
          className={`order-last my-0! basis-full text-right text-xs ${message.tone}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
