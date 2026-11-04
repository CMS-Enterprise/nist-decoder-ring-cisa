# Authentication strategy

How Decoder Ring decides who someone is, and what it does with the answer. Setup steps live in the runbooks; this page explains the design and where each piece sits.

## The model

Decoder Ring is a public reference. Every page and every read procedure works without signing in, and nothing in the app is restricted by identity today.

Sign-in is a feature a deployment turns on by configuration. With no sign-in settings the app is anonymous: no sign-in control, no prompt, nothing to configure. That is the right setup for someone running it on their own machine, and it is the default. With an OpenID Connect (OIDC) issuer configured, people can sign in through it and the app knows who they are.

The app trusts one issuer per deployment and names none in its code. Which identity provider a deployment uses, and who that provider admits, is the deploying organisation's decision.

## How sign-in works

```
Browser → /api/auth/signin/oidc → issuer login → /api/auth/callback/oidc → signIn check → session row → session cookie
```

- **Library.** Auth.js (`next-auth` v5) with its Prisma adapter. Sessions are stored in the database, not in the cookie: the cookie carries a session token, and the `Session` table holds what it points to. Signing out deletes the row.
- **One provider, by configuration.** A single OIDC provider with the id `oidc`, built from `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID` and `AUTH_OIDC_SECRET`. All three or none: a partial set stops the app at startup with the missing settings named, so a deployment never runs looking configured while staying anonymous.
- **Claims.** Name and email come from the issuer's userinfo endpoint rather than the ID token, because every OIDC issuer serves userinfo and ID token claims vary by issuer. Auth.js still checks the userinfo subject against the ID token's.
- **Who may sign in.** The issuer decides who can authenticate. `AUTH_ALLOWED_EMAIL_DOMAINS` optionally narrows that to listed email domains, checked in Auth.js's `signIn` callback after the issuer returns and before anything is stored. A person refused at their first sign-in leaves no user record and lands on the error page headed "Access Denied". The address is read from the issuer at every sign-in, and with a list the issuer must mark it verified (`email_verified`); `AUTH_ALLOW_UNVERIFIED_EMAIL=true` relaxes that for an issuer that never sends the claim.
- **Users are created on first sign-in.** There is no pre-provisioning. The adapter writes a `User` and an `Account` row (provider `oidc`, the issuer's subject as the account id) the first time someone signs in.
- **Where sign-in is offered.** Always at `/api/auth/signin`, Auth.js's own page. With `AUTH_SIGNIN_LINK=true` the header also carries a control that goes straight to the issuer and, once signed in, shows the person's name and "Sign out". `AUTH_OIDC_NAME` names the provider on the button. With the setting off, the header control renders nothing and never reads the session. The page reads the setting per request, so it takes effect on a running container without a rebuild. With no issuer configured, nothing asks Auth.js for a session at all.

## SAML

The app speaks OIDC only. A SAML identity provider is reached through a SAML-to-OIDC bridge (Keycloak, Dex or a commercial identity platform): the bridge is a SAML service provider to the identity provider and an OIDC issuer to the app, and the app is configured exactly as for any other issuer. The bridge setup is in the runbook below.

## What identity is used for today

- **`auth.me`** is the one `protectedProcedure`. It returns the signed-in person's id, name and email, and refuses a request with no session. It exists to prove the round trip end to end; nothing in the page calls it yet.
- **The catalog boundary.** Every procedure's output is checked against the catalog vocabulary list before it is served (`server/api/catalog-boundary.ts`). `auth.me` is exempt by its exact procedure path: a person's own name and email are not catalog text, and an address at an organisation whose name is on the list must not fail the procedure. Who may sign in is decided at sign-in, not by this check.
- **No roles.** There is no role or permission model. Signing in identifies a person; it grants nothing.

## Settings

Full descriptions, with examples, are in the setup runbook. In brief:

| Variable                                               | Purpose                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                                          | Encrypts session cookies. Required in production.                                                                         |
| `AUTH_URL`                                             | The app's public URL; Auth.js builds callback URLs from it. In production with an issuer, this or `AUTH_TRUST_HOST=true`. |
| `AUTH_TRUST_HOST`                                      | `true` behind a proxy that sets the host, as the alternative to `AUTH_URL`.                                               |
| `AUTH_OIDC_ISSUER`, `AUTH_OIDC_ID`, `AUTH_OIDC_SECRET` | The issuer and this app's client registration. All three or none.                                                         |
| `AUTH_OIDC_NAME`                                       | The provider's name on the sign-in button. Optional.                                                                      |
| `AUTH_SIGNIN_LINK`                                     | `true` adds the header sign-in control. Optional; requires an issuer.                                                     |
| `AUTH_ALLOWED_EMAIL_DOMAINS`                           | Comma-separated email domains allowed to sign in. Optional; requires an issuer.                                           |
| `AUTH_ALLOW_UNVERIFIED_EMAIL`                          | `true` accepts addresses not marked verified. Optional; requires a domain list.                                           |

`docker-compose.yml` passes the issuer settings through from the shell, empty by default, and sets `AUTH_URL` to each container's own port. `app/.env.example` lists them, commented out, so every local path starts anonymous.

## In a deployed environment

The Terraform stacks supply every setting above to the ECS task. With no issuer given, a deployment is anonymous, like a local run. To turn sign-in on, set the environment's Terraform inputs:

| Terraform input                                   | Reaches the task as                              |
| ------------------------------------------------- | ------------------------------------------------ |
| `oidc_issuer`                                     | `AUTH_OIDC_ISSUER`                               |
| `oidc_client_id`                                  | `AUTH_OIDC_ID`                                   |
| — (Secrets Manager `ztdr/<env>/AUTH_OIDC_SECRET`) | `AUTH_OIDC_SECRET`, as an ECS secret             |
| `oidc_display_name`                               | `AUTH_OIDC_NAME`                                 |
| `oidc_signin_link`                                | `AUTH_SIGNIN_LINK`                               |
| `oidc_allowed_email_domains`                      | `AUTH_ALLOWED_EMAIL_DOMAINS`, joined with commas |
| `oidc_allow_unverified_email`                     | `AUTH_ALLOW_UNVERIFIED_EMAIL`                    |
| `app_fqdn` (required)                             | `AUTH_URL`, always                               |

Terraform creates the client-secret entry when an issuer is set but never holds its value: apply, then put the secret with the command in output `launch.sign_in`, which also gives the redirect URI to register at the issuer (`<url>/api/auth/callback/oidc`). The inputs are validated the same way the app is, so a configuration the app would refuse fails at `terraform plan`. The full walk-through is in [`aws-deployment.md`](aws-deployment.md) and the setup runbook below.

Access control at the network edge (the WAF's geolock and rate limit) is independent of the app's sign-in. The app neither requires nor reads anything from that layer.

## Where the code is

| File                                          | Role                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/src/server/auth/settings.ts`             | Reads the settings, builds the provider, and holds the email-domain check.                                        |
| `app/src/server/auth/create-config.ts`        | The Auth.js configuration as a factory over a database client and providers, so tests run the real configuration. |
| `app/src/server/auth/config.ts`               | The app's configuration, from the environment.                                                                    |
| `app/src/env.js`                              | Startup validation, including the all-or-nothing and domain-list checks.                                          |
| `app/src/app/api/auth/[...nextauth]/route.ts` | Auth.js's route handlers.                                                                                         |
| `app/src/app/_components/SignInControl.tsx`   | The header control.                                                                                               |
| `app/src/server/api/routers/auth.ts`          | `auth.me`.                                                                                                        |
| `app/src/server/api/trpc.ts`                  | `protectedProcedure` and the catalog boundary middleware.                                                         |

`app/src/server/auth/__tests__/oidc-round-trip.integration.test.ts` runs an in-process OIDC issuer and drives Auth.js's real handlers through the full authorization-code flow, with and without a domain list.

## Runbooks

- [`docs/runbooks/auth-setup.md`](../runbooks/auth-setup.md): turning sign-in on, registering the client, every setting, quick versus production setup, who may sign in, verifying, proxies, troubleshooting, and SAML through a bridge step by step.
- [`docs/runbooks/auth-secret-rotation.md`](../runbooks/auth-secret-rotation.md): rotating `AUTH_SECRET`, and what signed-in users experience while it rolls.

## Not built

- Roles, permissions, or any route that requires sign-in.
- More than one issuer per deployment, or a provider chooser.
- Native SAML.
- Re-checking open sessions when the domain list changes. Sessions last until they expire or the person signs out.
