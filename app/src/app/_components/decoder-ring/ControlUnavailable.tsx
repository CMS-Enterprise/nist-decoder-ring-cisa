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
    <div className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-unavailable-title"
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-4 right-4 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={20} />
        </button>
        <h2
          id="control-unavailable-title"
          className="mb-2 pr-8 text-xl font-bold text-slate-900"
        >
          {title}
        </h2>
        <div className="mb-5 text-sm text-slate-600">{children}</div>
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className={
              onRetry
                ? "rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                : "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            }
          >
            Back to all controls
          </button>
        </div>
      </div>
    </div>
  );
}
