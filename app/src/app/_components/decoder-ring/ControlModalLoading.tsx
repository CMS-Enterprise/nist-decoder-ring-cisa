"use client";

import { X } from "lucide-react";

import { useCloseToCake } from "./useCloseToCake";
import { useEscape } from "./useEscape";

/**
 * The modal's frame while an in-app open waits on the server: the RSC round trip and
 * the existence check in resolveControlRoute. Opening used to be instant, so without
 * this a click shows nothing until the response lands, and a reader clicks again.
 * Close and Escape work as they do on the modal, which cancels the pending open.
 */
export default function ControlModalLoading() {
  const close = useCloseToCake();
  useEscape(close);

  return (
    <div className="animate-in fade-in bg-scrim/70 fixed inset-0 z-50 flex items-stretch p-4 backdrop-blur-sm duration-200 md:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Loading control"
        aria-busy="true"
        className="border-border bg-surface relative flex w-full items-center justify-center rounded-xl border shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-ink-muted hover:bg-surface-muted hover:text-ink absolute top-6 right-6 rounded-full p-1 transition-colors"
        >
          <X className="h-6 w-6" />
        </button>
        <div role="status" className="text-ink-muted text-center">
          <div className="border-accent mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"></div>
          <p className="text-sm font-medium">Loading control…</p>
        </div>
      </div>
    </div>
  );
}
