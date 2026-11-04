/**
 * How a statement part's marker is punctuated when rendered.
 *
 * Catalogs publish different markers, and the marker carries the nesting level.
 * NIST SP 800-53 uses "a." at the first level, "1." at the second and "(a)" at
 * the third, so a reader can tell depth from the marker alone. Another catalog
 * publishes a bare "a" because its statement parser captures the letter out of
 * whatever punctuated it — which is lossy: "a." and "(a)" both reduce to "a", and
 * the third level stops being distinguishable.
 *
 * The published marker is therefore kept verbatim in the seed, and the renderer
 * supplies a separator only when the catalog did not. Doing it the other way
 * around rendered every NIST item as "a.." on the page.
 */

/** The marker with exactly one trailing separator, whoever published it. */
export function formatPartLabel(label: string): string {
  // Already punctuated by the catalog — a trailing period, or a closing bracket
  // as in "(a)" and "[1]". Anything else is a bare marker and gets a period.
  return /[.)\]]$/.test(label) ? label : `${label}.`;
}
