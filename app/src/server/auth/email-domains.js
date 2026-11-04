/**
 * The one reading of `AUTH_ALLOWED_EMAIL_DOMAINS`, shared by the startup check in `src/env.js`
 * and the sign-in rule in `settings.ts`, so the two cannot disagree about what is listed.
 *
 * A comma-separated list. Entries are trimmed and lower-cased and may be written with a
 * leading `@`. An empty list is no list, so the setting left blank never turns into "nobody
 * may sign in".
 *
 * @param {string | undefined} value
 * @returns {string[] | undefined}
 */
export function parseEmailDomains(value) {
  const domains = (value ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return domains.length > 0 ? domains : undefined;
}
