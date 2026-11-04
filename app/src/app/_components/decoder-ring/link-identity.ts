/**
 * When two reference URLs are the same link. Scheme and host compare without case, a
 * trailing slash on the path does not count, and surrounding whitespace is ignored;
 * the path, query and fragment otherwise compare exactly, since they can address
 * different documents or sections.
 */
export function urlKey(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
    const user = u.username || u.password ? `${u.username}:${u.password}@` : "";
    return `${u.protocol}//${user}${u.host}${path}${u.search}${u.hash}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

/** The links in order, each URL once; the first occurrence wins. */
export function uniqueByUrl<T extends { url: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = urlKey(l.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The site a reference opens on, which is what the References panes group by: the host,
 * lower-cased and without a leading "www.", so subdomains that are different sites
 * (csrc.nist.gov, nvlpubs.nist.gov) stay apart. A URL that does not parse groups as "other".
 */
export function linkHost(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
}

/**
 * A pane's reference list. On the base control's tab, its own links, each URL once. On an
 * enhancement's tab, the enhancement's own links first, chipped, then its base's; a link both
 * cite is listed once, as the enhancement's own. `base` is null on the base tab.
 */
export function withBaseLinks<T extends { url: string }>(
  own: T[],
  base: T[] | null,
): Array<T & { scope?: "enhancement" | "base" }> {
  if (base === null) return uniqueByUrl(own);
  return uniqueByUrl([
    ...own.map((l) => ({ ...l, scope: "enhancement" as const })),
    ...base.map((l) => ({ ...l, scope: "base" as const })),
  ]);
}
