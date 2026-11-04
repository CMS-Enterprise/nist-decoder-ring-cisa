/**
 * The live-results file: one row per distinct URL probed, carrying what the
 * build step needs to seed a reference at its current location and to say
 * what it leads to: the status, the final URL after redirects, the media type,
 * the class, and the date. Written by retrieve.ts; read by build.ts, which
 * never touches the network. Committed, so git history is the log of pulls.
 *
 * Pure: results in, text out. Covered by live-results.test.ts.
 */

import type { LiveResult } from "../../../../scripts/check-links/report.js";
import { csvField, parseCsvRecords } from "./csv.js";

export const LIVE_RESULTS_HEADER = [
  "url",
  "status",
  "final_url",
  "content_type",
  "class",
  "error",
  "checked_on",
] as const;

export interface LiveResultRow {
  url: string;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  linkClass: string;
  error: string | null;
  checkedOn: string;
}

/**
 * Serialise live results as CSV, one row per distinct URL, sorted by URL so the
 * file is stable across runs and a diff shows only what changed on the network.
 * When the same URL was probed under several records the first result wins.
 */
export function toLiveResultsCsv(
  results: LiveResult[],
  checkedOn: string,
): string {
  const byUrl = new Map<string, LiveResult>();
  for (const r of results) {
    if (!byUrl.has(r.record.url)) byUrl.set(r.record.url, r);
  }
  const rows = [...byUrl.values()].sort((a, b) =>
    a.record.url < b.record.url ? -1 : a.record.url > b.record.url ? 1 : 0,
  );
  const lines = [LIVE_RESULTS_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.record.url),
        csvField(r.status),
        csvField(r.finalUrl),
        csvField(r.contentType),
        csvField(r.linkClass),
        csvField(r.error),
        csvField(checkedOn),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** An absent or empty CSV field is null; the file writes "" for null. */
function orNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

export function parseLiveResults(text: string): LiveResultRow[] {
  return parseCsvRecords(text).map((r) => {
    const status = orNull(r.status);
    return {
      url: r.url ?? "",
      status: status === null ? null : Number(status),
      finalUrl: orNull(r.final_url),
      contentType: orNull(r.content_type),
      linkClass: r.class ?? "",
      error: orNull(r.error),
      checkedOn: r.checked_on ?? "",
    };
  });
}

/** Today's date in UTC as YYYY-MM-DD, the granularity a link check is worth. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
