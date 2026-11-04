/**
 * Outcome classification for the live probe.
 *
 * A link check that reports one bit — reachable or not — throws away the reason,
 * and the reason decides what a person does next. A 404 is a dead link. A 403 to
 * a script is usually a host that blocks non-browser clients and is fine in a
 * browser. A certificate-chain error is a host that ships an incomplete chain,
 * which browsers repair and Node does not. Those are not the same finding and
 * they do not get the same treatment: only a dead or unreachable link is a
 * failure; the others are reported as needing a manual check.
 *
 * Pure: no network, no fs. Covered by classify.test.ts.
 */

export type LinkClass =
  /** 2xx after redirects, on a host that is not a known block page. */
  | "reachable"
  /** The origin refused or challenged a scripted client: 401/403/429, a 202 or
   *  418 bot challenge, or a redirect onto a known access-request page. A
   *  browser is likely fine; a person confirms. */
  | "script-blocked"
  /** The request threw on TLS: an incomplete or untrusted certificate chain. A
   *  browser fetches the missing intermediate; Node does not. A person confirms. */
  | "tls-chain"
  /** 404 or 410, or a soft-404 detected by the content layer. A dead link. */
  | "gone"
  /** Anything else: 5xx, DNS failure, timeout, connection refused. */
  | "unreachable";

/** Hosts that answer a blocked request with a 200 access-request page. A redirect
 *  onto one of these is a block, not a success. */
export const BLOCK_PAGE_HOSTS: ReadonlySet<string> = new Set([
  "unblock.federalregister.gov",
]);

/**
 * Hosts that answer Node's fetch with 404 while answering other clients with
 * 403 for the same URL, whatever request headers are sent — measured 2026-09-29
 * on every URL the catalog cites on them. The 403 is the honest answer: the
 * origin is fingerprinting the client, not reporting a missing page. A 404 from
 * one of these is therefore a block to be confirmed in a browser, not a dead
 * link. Extend the table only from a measurement of the same shape.
 */
export const CLIENT_FINGERPRINT_HOSTS: ReadonlySet<string> = new Set([
  "www.nsa.gov",
  "www.dni.gov",
  "www.jcs.mil",
  "www.esd.whs.mil",
]);

/** Node fetch surfaces TLS failures as a TypeError whose cause carries one of
 *  OpenSSL's verification codes. */
const TLS_CODE_RE =
  /^(CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|ERR_TLS|ERR_SSL|HOSTNAME_MISMATCH)/;

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A URL without its fragment. Fetch drops the fragment from `response.url`, so
 *  comparing a request URL to its final URL has to drop it too. */
export function stripFragment(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** Classify a response that arrived (status known), after redirects. */
export function classifyResponse(
  status: number,
  finalUrl: string | null,
  requestUrl?: string,
): LinkClass {
  const finalHost = hostOf(finalUrl);
  if (finalHost && BLOCK_PAGE_HOSTS.has(finalHost)) return "script-blocked";
  if (status === 404) {
    const host = finalHost ?? hostOf(requestUrl);
    if (host && CLIENT_FINGERPRINT_HOSTS.has(host)) return "script-blocked";
  }
  if (status === 404 || status === 410) return "gone";
  if (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status === 202 ||
    status === 418
  ) {
    return "script-blocked";
  }
  if (status >= 200 && status < 400) return "reachable";
  return "unreachable";
}

/** Classify a request that threw. Walks the cause chain for an error code. */
/** True for a thrown error worth one retry: a timeout or a dropped socket, the
 *  shape a busy origin produces under concurrent requests. Not TLS, not DNS. */
export function isTransient(err: unknown, code: string | null): boolean {
  if (
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  )
    return true;
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

export function classifyError(err: unknown): {
  linkClass: LinkClass;
  code: string | null;
} {
  let code: string | null = null;
  let cursor: unknown = err;
  for (
    let depth = 0;
    depth < 5 && cursor && typeof cursor === "object";
    depth++
  ) {
    const candidate = (cursor as { code?: unknown }).code;
    if (typeof candidate === "string" && candidate !== "") {
      code = candidate;
      break;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return {
    linkClass: code && TLS_CODE_RE.test(code) ? "tls-chain" : "unreachable",
    code,
  };
}

/** True for the classes a person has to look at rather than a script. */
export function needsManualCheck(linkClass: LinkClass): boolean {
  return linkClass === "script-blocked" || linkClass === "tls-chain";
}

/** True for the classes that count as a live failure. */
export function isLiveFailure(linkClass: LinkClass): boolean {
  return linkClass === "gone" || linkClass === "unreachable";
}
