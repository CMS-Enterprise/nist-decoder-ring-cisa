/**
 * What a reference link leads to, in words a reader can check before clicking:
 * the kind of document, the site it opens on, and the resolver it goes through
 * when the href is not the destination (every DOI). "PDF · nvlpubs.nist.gov ·
 * via doi.org" is the whole story of a NIST publication link.
 *
 * Composed at read time from what the reference-link pipeline recorded on the
 * row (the resolved URL and the media type), never parsed in the browser.
 * Pure; covered by reference-descriptor.test.ts.
 */

export interface ReferenceDestination {
  /** The href the pane renders. */
  url: string;
  /** Where the href ends up after redirects, when the live check saw it. */
  resolvedUrl: string | null;
  /** The media type the destination served, when the live check saw it. */
  contentType: string | null;
}

const KIND_BY_TYPE: Record<string, string> = {
  "application/pdf": "PDF",
  "text/html": "Web page",
  "application/xhtml+xml": "Web page",
  "text/plain": "Text",
  "application/json": "JSON",
  "application/xml": "XML",
  "text/xml": "XML",
};

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The path of a URL, which is where a file extension lives; a `.pdf` in the
 *  query string names a parameter, not the document served. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? url;
  }
}

/** The kind of document: from the recorded media type, else from the
 *  destination's file extension, else unknown. */
export function documentKind(
  contentType: string | null,
  destination: string,
): string | null {
  if (contentType) {
    const known = KIND_BY_TYPE[contentType];
    if (known) return known;
    const subtype = contentType.split("/")[1];
    return subtype ? subtype.replace(/^x-/, "").toUpperCase() : null;
  }
  return /\.pdf$/i.test(pathOf(destination)) ? "PDF" : null;
}

export function describeReference(d: ReferenceDestination): string | null {
  const destination = d.resolvedUrl ?? d.url;
  const kind = documentKind(d.contentType, destination);
  const site = hostOf(destination);
  const via = hostOf(d.url);
  const parts = [
    kind,
    site,
    via && site && via !== site ? `via ${via}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
