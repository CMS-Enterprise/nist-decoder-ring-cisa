/**
 * The catalog boundary, enforced on what the server serves.
 *
 * The source gate proves the code carries no catalog vocabulary; the seed scanner
 * proves the seed files do not. Neither proves what a procedure hands a client,
 * and that is the surface a person sees. This walks a procedure's result and
 * names the first string carrying a term from the shared list, so the middleware
 * in `trpc.ts` can refuse to serve it. One walk, composed into every procedure
 * builder, so a procedure added later inherits it without anyone remembering.
 *
 * The term list is `~/config/catalog-vocabulary`; there is no second list.
 */

import { CATALOG_VOCABULARY } from "~/config/catalog-vocabulary";

export interface BoundaryHit {
  /** Where in the result the string sits, e.g. `families[2].controls[0].name`. */
  path: string;
  /** The offending string, shortened around the first match. */
  excerpt: string;
}

/**
 * Procedures that serve the signed-in person's own details, and nothing else.
 *
 * The boundary keeps one catalog's vocabulary out of another catalog's product. A person's
 * name and email are not catalog text: an address names its owner's employer, and someone
 * whose employer is on the term list is still a person this deployment let in. Refusing to
 * serve them their own address would fail the procedure without protecting anything. Who
 * may sign in at all is decided at sign-in, by the issuer and `AUTH_ALLOWED_EMAIL_DOMAINS`,
 * not here.
 *
 * Keyed on the full procedure path, so the exemption cannot spread to a procedure added
 * later. The cost is that a procedure listed here must keep serving identity only;
 * anything else it returned would pass unchecked, so other data belongs in a procedure of
 * its own.
 */
const IDENTITY_PROCEDURES: ReadonlySet<string> = new Set(["auth.me"]);

/** Whether a procedure serves only the signed-in person's own details. */
export function servesOwnIdentity(procedure: string): boolean {
  return IDENTITY_PROCEDURES.has(procedure);
}

function excerptAround(text: string): string {
  const match = CATALOG_VOCABULARY.exec(text);
  const at = match?.index ?? 0;
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + (match?.[0].length ?? 0) + 30);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return `${head}${text.slice(start, end)}${tail}`;
}

function formatPath(path: readonly string[]): string {
  return path.reduce((acc, seg) => {
    if (/^\d+$/.test(seg)) return `${acc}[${seg}]`;
    return acc ? `${acc}.${seg}` : seg;
  }, "");
}

/**
 * The first string in `value` that carries catalog vocabulary, or null when none
 * does. Walks strings, arrays and plain objects; a Date, number, boolean or null
 * carries no text. Depth-first in key order, so the reported path is stable for a
 * given payload.
 */
export function findCatalogVocabulary(
  value: unknown,
  path: readonly string[] = [],
): BoundaryHit | null {
  if (typeof value === "string") {
    return CATALOG_VOCABULARY.test(value)
      ? { path: formatPath(path), excerpt: excerptAround(value) }
      : null;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const hit = findCatalogVocabulary(item, [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value)) {
      const hit = findCatalogVocabulary(item, [...path, key]);
      if (hit) return hit;
    }
  }
  return null;
}
