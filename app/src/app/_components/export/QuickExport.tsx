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
  "flex! w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-ink! no-underline! hover:bg-surface-canvas focus-visible:bg-accent-subtle aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted!";

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
      ? { text: status.message, tone: "text-error" }
      : status.kind === "idle"
        ? null
        : {
            text: STATUS_MESSAGE[status.kind],
            tone: status.kind === "pending" ? "text-ink-muted" : "text-warning",
          };

  return (
    // `contents`, so the status can take its own line in the modal's action row: outside the
    // menu, it stays in view after the menu closes, and never moves the buttons.
    <div className="contents">
      {/* Opens up and rightward, inside the pane, whose scrolling clips overflow. */}
      <details ref={ref} className="relative">
        <summary className="border-border-strong bg-surface text-ink hover:bg-surface-canvas flex cursor-pointer list-none items-center gap-2 rounded-lg border px-5 py-3 text-sm font-bold">
          <Download className="h-5 w-5" aria-hidden />
          <span>{pending ? "Preparing…" : "Export"}</span>
        </summary>
        <div className="border-border bg-surface absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border p-2 shadow-lg">
          {hasEnhancements && (
            <label className="border-border text-ink my-0! flex! cursor-pointer items-center gap-2 border-b px-3 pt-1 pb-2 text-sm">
              <input
                type="checkbox"
                checked={withEnhancements}
                onChange={(e) => setWithEnhancements(e.target.checked)}
                className="h-4 w-4 shrink-0"
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
            className={`${ITEM} border-border border-t`}
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
