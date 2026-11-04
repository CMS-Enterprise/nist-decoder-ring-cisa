"use client";

import { useState } from "react";

import { isRateLimited } from "~/trpc/rate-limited";

export type DownloadStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "busy" }
  | { kind: "limited" }
  | { kind: "failed"; message: string };

/** What each status says, the same wherever an export is downloaded. */
export const STATUS_MESSAGE: Record<
  Exclude<DownloadStatus["kind"], "idle" | "failed">,
  string
> = {
  pending: "A large export can take several seconds to build.",
  busy: "Other exports are being built right now. Try again in a few seconds.",
  limited:
    "You've made many exports in a short time. Try again in a few minutes.",
};

/**
 * Fetch an /api/export link and save the file under the route's own name, so the page
 * can say the build is pending and explain a 429, which a plain navigation to the link
 * could not: the build cap's comes as JSON, the load balancer's rate limit as text.
 */
export function useExportDownload() {
  const [status, setStatus] = useState<DownloadStatus>({ kind: "idle" });

  const download = async (href: string, fallbackName: string) => {
    setStatus({ kind: "pending" });
    try {
      const res = await fetch(href);
      if (res.status === 429) {
        return setStatus({ kind: isRateLimited(res) ? "limited" : "busy" });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        return setStatus({
          kind: "failed",
          message: body?.error ?? `The export failed (${res.status}).`,
        });
      }
      const name =
        /filename="([^"]+)"/.exec(
          res.headers.get("Content-Disposition") ?? "",
        )?.[1] ?? fallbackName;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // A tick later: some browsers have cancelled a download whose URL was revoked at once.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({ kind: "idle" });
    } catch {
      setStatus({
        kind: "failed",
        message: "The export could not be reached.",
      });
    }
  };

  return { status, download };
}
