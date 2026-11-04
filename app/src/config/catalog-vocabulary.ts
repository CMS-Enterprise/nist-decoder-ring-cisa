/**
 * What counts as catalog vocabulary, defined once.
 *
 * Three tests asserted this independently and had already drifted apart: two matched
 * case-sensitively and one did not. A term added to one copy and not the others is a term
 * nothing catches, and a gate that is quietly narrower than its siblings reads as
 * coverage it does not have. One definition removes that failure mode rather than
 * documenting it.
 *
 * The app's tests and the server's catalog boundary both read this one list, so what the
 * tests ban and what the server refuses to serve cannot drift into lists that merely
 * overlap.
 */

/**
 * Organisations, products and hosts that belong to the other line. This array and the
 * boundary tests' ban patterns are the declared allowlist: they have to name what they ban.
 *
 * Each term is matched as a whole word, so a plural or a run-together spelling is a
 * different word and is listed on its own: `ADOs` is not caught by `ADO`, nor `CMSCloud`
 * by `CMS`. `IDM`, `SLS` and the gold images are the other line's internal systems and
 * platform, which its guidance used to name.
 */
export const CATALOG_MARKERS = [
  "CMS Cloud",
  "CMSCloud",
  "CloudTamer",
  "CyberGeek",
  "IS2P2",
  "cms.gov",
  "CMS",
  "ADO",
  "ADOs",
  "HVA",
  "ARS",
  "Kion",
  "IDM",
  "SLS",
  "Gold Image",
  "Gold Images",
] as const;

/**
 * Word-boundary a term unless it carries punctuation of its own. `cms.gov` is a host, and
 * bounding its right edge would stop it matching inside a URL path; every other term is a
 * word, so "regenerated" must not match ADO and "CMSish" must not match CMS.
 */
function pattern(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^[\w ]+$/.test(term) ? `\\b${escaped}\\b` : escaped;
}

/**
 * Case-insensitive. These name organisations and products, and a name does not stop
 * being one when someone writes it uncapitalised.
 */
export const CATALOG_VOCABULARY = new RegExp(
  CATALOG_MARKERS.map(pattern).join("|"),
  "i",
);

/**
 * The lines of a file that carry catalog vocabulary, as `line  content` for a report.
 *
 * Comments count. A comment is committed, read and searched like any other line, and
 * the sweep used to skip them, which is how a module whose only mentions were comments
 * passed a gate that existed to notice it.
 */
export function offendingLines(text: string): string[] {
  const out: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (CATALOG_VOCABULARY.test(line)) out.push(`${i + 1}  ${line.trim()}`);
  }
  return out;
}
