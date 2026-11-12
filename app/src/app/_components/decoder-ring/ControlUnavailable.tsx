"use client";

import { X } from "lucide-react";

import { useCloseToCake } from "./useCloseToCake";
import { useEscape } from "./useEscape";

/**
 * A small dialog over the cake for an address the modal cannot show. It says what to
 * do and never repeats the id from the address, which came from whoever wrote the link.
 * With `onRetry` (a load that failed rather than a control that isn't there), Try
 * again leads and Back to all controls follows it.
 */
export default function ControlUnavailable({
  title,
  children,
  onRetry,
}: {
  title: string;
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  const close = useCloseToCake();
  useEscape(close);

  return (
    <div className="animate-in fade-in bg-scrim/70 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-unavailable-title"
        className="border-border bg-surface relative w-full max-w-md rounded-xl border p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-ink-muted hover:bg-surface-muted hover:text-ink absolute top-4 right-4 rounded-full p-1 transition-colors"
        >
          <X size={20} />
        </button>
        <h2
          id="control-unavailable-title"
          className="text-ink mb-2 pr-8 text-xl font-bold"
        >
          {title}
        </h2>
        <div className="text-ink-muted mb-5 text-sm">{children}</div>
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="bg-accent text-on-accent hover:bg-accent-strong rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className={
              onRetry
                ? "border-border-strong text-ink hover:bg-surface-canvas rounded-lg border px-4 py-2 text-sm font-semibold"
                : "bg-accent text-on-accent hover:bg-accent-strong rounded-lg px-4 py-2 text-sm font-semibold"
            }
          >
            Back to all controls
          </button>
        </div>
      </div>
    </div>
  );
}
