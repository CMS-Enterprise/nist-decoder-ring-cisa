import type { Provider } from "next-auth/providers";

import { parseEmailDomains } from "./email-domains.js";

export { parseEmailDomains };

/**
 * Sign-in is a feature a deployment turns on by configuration; nothing in the code names an
 * issuer. With no OIDC settings the app is anonymous. With all three it signs in through that
 * issuer, from Auth.js's own sign-in page, and from a header link when `AUTH_SIGNIN_LINK` is
 * set. A partial configuration is refused at startup in `src/env.js`.
 */

/** The provider id. Auth.js reads `AUTH_OIDC_ID`, `_SECRET` and `_ISSUER` from it. */
export const OIDC_PROVIDER_ID = "oidc";

export interface AuthSettings {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  /** What the sign-in button calls the provider; unset, it says "Sign in". */
  name?: string;
  /** Whether the header carries a sign-in control. */
  signInLink: boolean;
  /** The email domains allowed to sign in, lower-cased; unset, the issuer alone decides. */
  allowedEmailDomains?: string[];
  /** With a domain list, accept an address the issuer did not mark verified. */
  allowUnverifiedEmail: boolean;
}

export interface AuthEnv {
  AUTH_OIDC_ISSUER?: string;
  AUTH_OIDC_ID?: string;
  AUTH_OIDC_SECRET?: string;
  AUTH_OIDC_NAME?: string;
  AUTH_SIGNIN_LINK?: string;
  AUTH_ALLOWED_EMAIL_DOMAINS?: string;
  AUTH_ALLOW_UNVERIFIED_EMAIL?: string;
}

/** An empty value counts as unset, as it does in `src/env.js`. */
function present(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

export function readAuthSettings(env: AuthEnv): AuthSettings {
  return {
    issuer: present(env.AUTH_OIDC_ISSUER),
    clientId: present(env.AUTH_OIDC_ID),
    clientSecret: present(env.AUTH_OIDC_SECRET),
    name: present(env.AUTH_OIDC_NAME),
    signInLink: env.AUTH_SIGNIN_LINK === "true",
    allowedEmailDomains: parseEmailDomains(env.AUTH_ALLOWED_EMAIL_DOMAINS),
    allowUnverifiedEmail: env.AUTH_ALLOW_UNVERIFIED_EMAIL === "true",
  };
}

/**
 * Whether an address the issuer vouched for may sign in. With no list, anyone the issuer
 * signs in is let in. With a list, the address's domain must be on it exactly: a subdomain
 * is a different organisation's mail as often as it is the same one's, so it is listed or
 * refused, never inferred. An address with more than one `@` is refused rather than parsed.
 *
 * Both values arrive as the issuer's userinfo JSON, which nothing types beyond `sub`, so
 * they are taken as unknown. With a list, `email_verified` must be `true`, or the string
 * `"true"` some issuers send, because a domain check on an address nobody confirmed checks
 * nothing. An absent claim is refused too: a SAML bridge drops it unless it is mapped.
 * `allowUnverified` (`AUTH_ALLOW_UNVERIFIED_EMAIL=true`) accepts an issuer that never sends
 * the claim; an explicit `false` is refused either way.
 */
export function emailPermitted(
  email: unknown,
  emailVerified: unknown,
  allowedDomains: string[] | undefined,
  allowUnverified = false,
): boolean {
  if (!allowedDomains) return true;
  if (emailVerified == null ? !allowUnverified : !isTrue(emailVerified)) {
    return false;
  }
  if (typeof email !== "string") return false;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0]) return false;
  return allowedDomains.includes(parts[1]!.toLowerCase());
}

function isTrue(value: unknown): boolean {
  return (
    value === true ||
    (typeof value === "string" && value.trim().toLowerCase() === "true")
  );
}

export function oidcConfigured(s: AuthSettings): boolean {
  return Boolean(s.issuer && s.clientId && s.clientSecret);
}

/** The providers to give Auth.js: the one OIDC issuer when configured, otherwise none. */
export function oidcProviders(s: AuthSettings): Provider[] {
  if (!oidcConfigured(s)) return [];
  return [
    {
      id: OIDC_PROVIDER_ID,
      name: s.name ?? "Single sign-on",
      type: "oidc",
      issuer: s.issuer,
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      // Read name and email from the issuer's userinfo endpoint, which every OIDC issuer
      // serves, rather than from the ID token, whose claims vary by issuer. Auth.js still
      // checks the userinfo subject against the ID token's.
      idToken: false,
    },
  ];
}
