import { env } from "~/env";
import { db } from "~/server/db";

import { createAuthConfig } from "./create-config";
import { oidcProviders, readAuthSettings } from "./settings";

/**
 * The app's Auth.js configuration. Providers come from the environment: none unless a
 * deployment configures an OIDC issuer, in which case the app signs in through it, limited
 * to the listed email domains when `AUTH_ALLOWED_EMAIL_DOMAINS` is set. See
 * `docs/runbooks/auth-setup.md`.
 */
const settings = readAuthSettings(env);

export const authConfig = createAuthConfig(
  db,
  oidcProviders(settings),
  settings.allowedEmailDomains,
  settings.allowUnverifiedEmail,
);
