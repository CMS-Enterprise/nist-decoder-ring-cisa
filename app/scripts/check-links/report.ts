/**
 * Live HTTP probing + console reporting for the link-checker.
 *
 * Side-effectful (network + stdout) → coverage-excluded in vitest.config.ts.
 * The LIVE layer is REPORT-ONLY by default: a non-2xx/3xx response is recorded
 * and printed but does not change the exit code unless --strict is passed. The
 * static/format layer (./validate.ts) is the hard gate.
 */

import type { FormatFailure, UrlRecord } from "./validate.js";
import { FORMAT_FAILURE_LABEL } from "./validate.js";
import {
  classifyError,
  classifyResponse,
  isLiveFailure,
  isTransient,
  needsManualCheck,
  type LinkClass,
} from "./classify.js";

// ---------------------------------------------------------------------------
// Live HTTP probe — native fetch only, no new dependency
// ---------------------------------------------------------------------------

// Generous, because the corpus includes PDF hosts that take several seconds to
// answer even a one-byte range under concurrent load. Tunable via env.
const REQUEST_TIMEOUT_MS = Number(process.env.LINKCHECK_TIMEOUT_MS ?? 20000);
// One retry after a pause for the transient shapes (timeout, dropped socket).
const RETRY_DELAY_MS = 2000;
// Several .gov and .mil origins answer a bare client with 404 and a browser-style
// one with 403; the second is the honest answer, so identify as a browser-style
// client. The token names this tool so an origin can tell whom to contact.
const CLIENT_ID = "Mozilla/5.0 (compatible; decoder-ring-link-check/1.0)";
// Be a polite client to live origins (small publishers especially) — low concurrency + a per-request
// delay so a routine check never looks like a burst / DDoS. Tunable via env.
const DEFAULT_CONCURRENCY = Number(process.env.LINKCHECK_CONCURRENCY ?? 4);
const DEFAULT_DELAY_MS = Number(process.env.LINKCHECK_DELAY_MS ?? 300);

/**
 * Per-host "soft-404" signatures: some origins serve an error page with HTTP 200.
 * When content-checking is on, a 200 whose <title> exactly equals the host's
 * generic/not-found title is treated as not-reachable (the page isn't real).
 *
 * Empty here: every host the NIST corpus links to answers a missing page
 * with a real 404 (measured 2026-09-30 across 158 distinct URLs). Add a host here
 * only from a measured soft-200, with the title it serves. Exported so a test can
 * hold the table to what has been measured.
 */
export const SOFT_404_TITLE: Record<string, string> = {};

const TITLE_RE = /<title>([^<]*)<\/title>/i;

/** "application/pdf; charset=binary" → "application/pdf"; null when absent. */
export function mediaTypeOf(header: string | null): string | null {
  if (!header) return null;
  const type = header.split(";")[0]!.trim().toLowerCase();
  return type === "" ? null : type;
}
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface LiveResult {
  record: UrlRecord;
  /** HTTP status code, or null when the request never produced a response. */
  status: number | null;
  /** Final URL after redirects (res.url), when available. */
  finalUrl: string | null;
  /** Media type of the response without parameters (e.g. "application/pdf"),
   *  when the origin sent one. Says what the link leads to. */
  contentType: string | null;
  /** True only when the class is "reachable". */
  ok: boolean;
  /** Why it is or is not ok. See ./classify.ts. */
  linkClass: LinkClass;
  /** Populated when the request threw (DNS, timeout, TLS, abort), with the
   *  underlying error code appended when the cause chain carries one. */
  error: string | null;
}

/**
 * Probe one URL with a GET that asks for the first byte only. HEAD is not used:
 * nvlpubs.nist.gov, where every NIST DOI resolves, answers HEAD with 404 on every
 * PDF while serving GET, so a HEAD-first check reports the whole NIST corpus as
 * dead. A one-byte range costs one round trip, is answered 206 by origins that
 * support ranges and 200 by those that ignore them, and either is reachable.
 * Content mode needs the body for the soft-404 title check, so it sends a plain
 * GET. Follows redirects and records the final status + URL. Network errors are
 * captured and classified, not thrown, so one dead link never aborts the run.
 */
export async function probe(
  record: UrlRecord,
  content = false,
): Promise<LiveResult> {
  const request = (full: boolean): Promise<Response> =>
    fetch(record.url, {
      method: "GET",
      headers: full
        ? { "user-agent": CLIENT_ID }
        : { "user-agent": CLIENT_ID, range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(false);
      const finalUrl = res.url || null;
      const contentType = mediaTypeOf(res.headers.get("content-type"));
      let linkClass = classifyResponse(res.status, finalUrl, record.url);
      let error: string | null = null;
      await res.body?.cancel();

      // Soft-404 detection (content mode, 2xx): an origin that serves its error
      // page with a 200 looks reachable to a status check and is not.
      if (content && linkClass === "reachable") {
        // (a) Redirect-to-homepage — cheap, host-agnostic: we asked for a real
        // path but landed on the bare host root (a common "not found" fallback).
        try {
          const reqPath = new URL(record.url).pathname.replace(/\/+$/, "");
          const landed = new URL(finalUrl ?? record.url);
          const finalPath = landed.pathname.replace(/\/+$/, "");
          if (reqPath !== "" && finalPath === "") {
            linkClass = "gone";
            error = `soft-404 (redirected to homepage ${landed.origin}/)`;
          }
        } catch {
          // unparsable URL — leave to the title check / format gate
        }
        // (b) Per-host not-found signature: only now fetch a body, and only for a
        // host with a signature, so a PDF corpus is never downloaded whole.
        if (linkClass === "reachable") {
          const host = (() => {
            try {
              return new URL(finalUrl ?? record.url).hostname.toLowerCase();
            } catch {
              return "";
            }
          })();
          const signature = SOFT_404_TITLE[host];
          if (signature) {
            const page = await request(true);
            const body = await page.text();
            const title = (TITLE_RE.exec(body)?.[1] ?? "").trim();
            if (title === signature || title === "") {
              linkClass = "gone";
              error = `soft-404 (page title is the site generic/not-found page)`;
            }
          }
        }
      }

      return {
        record,
        status: res.status,
        finalUrl,
        contentType,
        ok: linkClass === "reachable",
        linkClass,
        error,
      };
    } catch (err) {
      const { linkClass, code } = classifyError(err);
      if (attempt === 0 && isTransient(err, code)) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        record,
        status: null,
        finalUrl: null,
        contentType: null,
        ok: false,
        linkClass,
        error: code ? `${message} [${code}]` : message,
      };
    }
  }
}

/**
 * Tiny hand-written promise pool — caps concurrent in-flight probes at
 * `concurrency`. No external dependency (e.g. p-limit). Workers pull from a
 * shared cursor until the input is exhausted; results land at their input
 * index so output order is stable.
 */
export async function probeAll(
  records: UrlRecord[],
  concurrency: number = DEFAULT_CONCURRENCY,
  content = false,
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<LiveResult[]> {
  const results = new Array<LiveResult>(records.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= records.length) return;
      results[index] = await probe(records[index]!, content);
      // Polite throttle between requests so a routine check isn't a burst.
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, records.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function unique(records: UrlRecord[]): number {
  return new Set(records.map((r) => r.url)).size;
}

/** Print the format-validation summary + per-failure detail (grouped by code). */
export function reportFormat(
  records: UrlRecord[],
  failures: FormatFailure[],
): void {
  process.stdout.write(
    `\nStatic format check: ${records.length} URL(s) scanned (${unique(records)} unique)\n`,
  );

  if (failures.length === 0) {
    process.stdout.write("  PASS — no malformed URLs\n");
    return;
  }

  // Group failures by code for a readable summary.
  const byCode = new Map<string, FormatFailure[]>();
  for (const f of failures) {
    const bucket = byCode.get(f.code);
    if (bucket) bucket.push(f);
    else byCode.set(f.code, [f]);
  }

  process.stdout.write(`  FAIL — ${failures.length} malformed URL(s):\n`);
  for (const group of byCode.values()) {
    process.stdout.write(
      `\n  [${FORMAT_FAILURE_LABEL[group[0]!.code]}] (${group.length})\n`,
    );
    for (const f of group) {
      process.stdout.write(
        `    - ${f.record.source} (${f.record.id}): ${f.record.url}\n`,
      );
    }
  }
}

/**
 * Print the live HTTP probe summary. Dead and unreachable links are failures;
 * links a script cannot verify (blocked clients, certificate chains) are listed
 * separately as needing a manual check and never count against the run.
 */
export function reportLive(results: LiveResult[]): {
  failures: number;
  manual: number;
} {
  const failures = results.filter((r) => isLiveFailure(r.linkClass));
  const manual = results.filter((r) => needsManualCheck(r.linkClass));
  const counts = new Map<LinkClass, number>();
  for (const r of results)
    counts.set(r.linkClass, (counts.get(r.linkClass) ?? 0) + 1);

  const distinct = new Set(results.map((r) => r.record.url)).size;
  process.stdout.write(
    `\nLive HTTP check (report-only): ${distinct} distinct URL(s) probed across ${results.length} record(s)\n`,
  );
  const summary = (
    ["reachable", "script-blocked", "tls-chain", "gone", "unreachable"] as const
  )
    .filter((c) => counts.has(c))
    .map((c) => `${c} ${counts.get(c)}`)
    .join(", ");
  if (summary) process.stdout.write(`  by class: ${summary}\n`);

  const describe = (r: LiveResult): string =>
    r.error ? `ERR ${r.error}` : `HTTP ${r.status ?? "?"}`;

  if (manual.length > 0) {
    process.stdout.write(
      `  ${manual.length} URL(s) need a manual check (not counted as failures):\n`,
    );
    for (const m of manual) {
      const landed =
        m.finalUrl && m.finalUrl !== m.record.url ? ` -> ${m.finalUrl}` : "";
      process.stdout.write(
        `    - [${m.linkClass}: ${describe(m)}] ${m.record.source} (${m.record.id}): ${m.record.url}${landed}\n`,
      );
    }
  }

  if (failures.length === 0) {
    process.stdout.write("  PASS — no dead or unreachable links\n");
    return { failures: 0, manual: manual.length };
  }

  process.stdout.write(`  ${failures.length} URL(s) not reachable:\n`);
  for (const f of failures) {
    process.stdout.write(
      `    - [${describe(f)}] ${f.record.source} (${f.record.id}): ${f.record.url}\n`,
    );
  }
  return { failures: failures.length, manual: manual.length };
}
