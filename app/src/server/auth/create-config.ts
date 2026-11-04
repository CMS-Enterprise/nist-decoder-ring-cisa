import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";

import type { PrismaClient } from "../../../generated/prisma";
import { emailPermitted } from "./settings";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

/**
 * The Auth.js configuration, built from a database client and a provider list so a test can
 * run the real configuration against its own database and a local issuer.
 *
 * `allowedEmailDomains` is checked in the `signIn` callback, which Auth.js runs after the
 * issuer returns and before the adapter writes anything, so a refused person leaves no user
 * row and lands on the error page with `AccessDenied`. The issuer's profile is read rather
 * than the stored user, because a returning user's stored address is whatever it was at
 * their first sign-in. On the OIDC path Auth.js always has a profile by this point; the
 * stored address is read only if a provider without one is ever added. `allowUnverifiedEmail`
 * relaxes the list's `email_verified` requirement for an issuer that never sends the claim.
 */
export function createAuthConfig(
  db: PrismaClient,
  providers: Provider[],
  allowedEmailDomains?: string[],
  allowUnverifiedEmail = false,
): NextAuthConfig {
  return {
    providers,
    adapter: PrismaAdapter(db),
    callbacks: {
      signIn: ({ user, profile }) =>
        emailPermitted(
          profile ? profile.email : user.email,
          profile?.email_verified,
          allowedEmailDomains,
          allowUnverifiedEmail,
        ),
      session: ({ session, user }) => ({
        ...session,
        user: {
          ...session.user,
          id: user.id,
        },
      }),
    },
  };
}
