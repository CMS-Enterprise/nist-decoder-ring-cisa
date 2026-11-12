import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { parseEmailDomains } from "./server/auth/email-domains.js";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    DATABASE_URL: z.string().url(),
    // The app's public URL. Auth.js builds callback URLs from it and trusts the request host
    // when it is set; AUTH_TRUST_HOST=true is the alternative behind a proxy that sets the host.
    AUTH_URL: z.string().url().optional(),
    AUTH_TRUST_HOST: z.enum(["true", "false"]).optional(),
    // Sign-in by OIDC, off unless all three are set. See docs/runbooks/auth-setup.md.
    AUTH_OIDC_ISSUER: z.string().url().optional(),
    AUTH_OIDC_ID: z.string().optional(),
    AUTH_OIDC_SECRET: z.string().optional(),
    AUTH_OIDC_NAME: z.string().optional(),
    AUTH_SIGNIN_LINK: z.enum(["true", "false"]).optional(),
    // Comma-separated email domains allowed to sign in; unset, the issuer alone decides.
    AUTH_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
    // With a domain list, accept an address the issuer did not mark verified. Off by default.
    AUTH_ALLOW_UNVERIFIED_EMAIL: z.enum(["true", "false"]).optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    /**
     * The app's version, which `next.config.js` reads from `package.json` and inlines at build time. Nothing sets it in the environment. It is unset outside a Next build, as under Vitest, and the footer then shows no version.
     */
    NEXT_PUBLIC_APP_VERSION: z.string().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    AUTH_OIDC_ISSUER: process.env.AUTH_OIDC_ISSUER,
    AUTH_OIDC_ID: process.env.AUTH_OIDC_ID,
    AUTH_OIDC_SECRET: process.env.AUTH_OIDC_SECRET,
    AUTH_OIDC_NAME: process.env.AUTH_OIDC_NAME,
    AUTH_SIGNIN_LINK: process.env.AUTH_SIGNIN_LINK,
    AUTH_ALLOWED_EMAIL_DOMAINS: process.env.AUTH_ALLOWED_EMAIL_DOMAINS,
    AUTH_ALLOW_UNVERIFIED_EMAIL: process.env.AUTH_ALLOW_UNVERIFIED_EMAIL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});

/**
 * Sign-in is all or nothing. Some but not all of the three OIDC settings would leave the app
 * anonymous while looking configured, and a header link with no issuer would lead nowhere, so
 * both stop startup with the settings named. So does a domain list with no issuer, which would
 * read as a restriction on a sign-in that does not exist, and a list entry that is not a
 * domain, which would refuse everyone it was meant to let in. The unverified-address opt-out
 * means nothing without a list, so it needs one.
 *
 * In production a configured issuer also needs the app's public URL: `AUTH_URL`, or
 * `AUTH_TRUST_HOST=true` behind a proxy that sets the host. Auth.js trusts any host outside
 * production, so local development needs neither. With no issuer none of this applies: an
 * unconfigured app is anonymous by design, locally and deployed.
 *
 * @param {Record<string, string | undefined>} source
 * @returns {string | null}
 */
export function oidcConfigurationError(source) {
  const names = ["AUTH_OIDC_ISSUER", "AUTH_OIDC_ID", "AUTH_OIDC_SECRET"];
  const set = names.filter((n) => source[n]);
  if (set.length > 0 && set.length < names.length) {
    const missing = names.filter((n) => !source[n]);
    return `OIDC sign-in is partly configured: ${set.join(", ")} set but ${missing.join(", ")} not. Set all three, or none.`;
  }
  if (source.AUTH_SIGNIN_LINK === "true" && set.length === 0) {
    return "AUTH_SIGNIN_LINK is true but no OIDC issuer is configured. Set AUTH_OIDC_ISSUER, AUTH_OIDC_ID and AUTH_OIDC_SECRET, or unset AUTH_SIGNIN_LINK.";
  }
  const domains = parseEmailDomains(source.AUTH_ALLOWED_EMAIL_DOMAINS) ?? [];
  if (domains.length > 0 && set.length === 0) {
    return "AUTH_ALLOWED_EMAIL_DOMAINS is set but no OIDC issuer is configured. Set AUTH_OIDC_ISSUER, AUTH_OIDC_ID and AUTH_OIDC_SECRET, or unset AUTH_ALLOWED_EMAIL_DOMAINS.";
  }
  const invalid = domains.filter(
    (d) =>
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
        d,
      ),
  );
  if (invalid.length > 0) {
    return `AUTH_ALLOWED_EMAIL_DOMAINS has entries that are not domains: ${invalid.join(", ")}. List domains separated by commas, such as agency.gov,partner.gov.`;
  }
  if (source.AUTH_ALLOW_UNVERIFIED_EMAIL === "true" && domains.length === 0) {
    return "AUTH_ALLOW_UNVERIFIED_EMAIL is true but no AUTH_ALLOWED_EMAIL_DOMAINS list is set. It only relaxes a domain list; set one, or unset AUTH_ALLOW_UNVERIFIED_EMAIL.";
  }
  if (
    set.length === names.length &&
    source.NODE_ENV === "production" &&
    !source.AUTH_URL &&
    source.AUTH_TRUST_HOST !== "true"
  ) {
    return "OIDC sign-in is configured but the app's public URL is not. Set AUTH_URL to the URL people use, or AUTH_TRUST_HOST=true behind a proxy that sets the host.";
  }
  return null;
}

if (!process.env.SKIP_ENV_VALIDATION) {
  const problem = oidcConfigurationError(process.env);
  if (problem) throw new Error(problem);
}
