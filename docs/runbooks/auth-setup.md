# Sign-in setup (OIDC)

How a deploying organisation turns on sign-in. Decoder Ring ships with sign-in available and switched off: with no settings it is anonymous, as it has always been. It signs in through one OpenID Connect (OIDC) issuer that you configure. Nothing in the code names an issuer, and no route requires sign-in today; the feature exists so a deployment that needs to know who is using it can turn it on.

SAML identity providers are reached through a SAML-to-OIDC bridge; see [SAML through a bridge](#saml-through-a-bridge).

## What you need

- An OIDC issuer: any provider that publishes `/.well-known/openid-configuration` (most enterprise identity providers do).
- A client registered at that issuer for this app, with:
  - the authorization-code grant;
  - the redirect URI `https://<your app>/api/auth/callback/oidc`;
  - the scopes `openid`, `email` and `profile`;
  - a client secret (confidential client).
- The app's public URL and a session secret.

## Settings

| Variable                      | Required                                                 | What it is                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`                 | Yes, in production                                       | Encrypts session cookies. Generate with `openssl rand -base64 32`. Rotation: [`auth-secret-rotation.md`](./auth-secret-rotation.md).                                           |
| `AUTH_URL`                    | In production with sign-in on: this or `AUTH_TRUST_HOST` | The app's public URL, for example `https://decoder.example.gov`. Auth.js builds its callback URLs from it and trusts the request host when it is set.                          |
| `AUTH_TRUST_HOST`             | The alternative to `AUTH_URL`                            | `true` behind a proxy that sets the host header, when you cannot set `AUTH_URL`.                                                                                               |
| `AUTH_OIDC_ISSUER`            | For sign-in                                              | The issuer URL, without the `/.well-known/...` suffix.                                                                                                                         |
| `AUTH_OIDC_ID`                | For sign-in                                              | The client id from your registration.                                                                                                                                          |
| `AUTH_OIDC_SECRET`            | For sign-in                                              | The client secret. Store it as a secret, not in a file.                                                                                                                        |
| `AUTH_OIDC_NAME`              | No                                                       | The provider's name on the sign-in button, for example "Agency SSO".                                                                                                           |
| `AUTH_SIGNIN_LINK`            | No                                                       | `true` adds a sign-in control to the header.                                                                                                                                   |
| `AUTH_ALLOWED_EMAIL_DOMAINS`  | No                                                       | Comma-separated email domains allowed to sign in, for example `agency.gov,partner.gov`. Unset, anyone your issuer signs in is let in. See [Who may sign in](#who-may-sign-in). |
| `AUTH_ALLOW_UNVERIFIED_EMAIL` | No                                                       | With a domain list, `true` accepts an address the issuer did not mark verified, for an issuer that never sends `email_verified`. Prefer mapping the claim.                     |

With none of these set the app is anonymous and needs no auth settings at all, locally or deployed. That is the default, not a half-finished configuration.

Once you set any of them, the app checks them when it starts, and a mistake stops it there with a message naming what is wrong, before it serves anything:

- the three `AUTH_OIDC_` settings are all or nothing;
- `AUTH_SIGNIN_LINK=true` or `AUTH_ALLOWED_EMAIL_DOMAINS` need an issuer;
- every domain list entry must be a domain;
- `AUTH_ALLOW_UNVERIFIED_EMAIL` needs a domain list;
- in production, an issuer needs `AUTH_URL` or `AUTH_TRUST_HOST=true`.

A misconfigured deployment never runs looking configured.

## Two ways to offer sign-in

**Quick setup.** Set the secret, the URL and the three issuer settings. People sign in at `/api/auth/signin`, Auth.js's own sign-in page, and the app's pages are unchanged. Use this to prove the issuer connection before anyone sees it.

**Production.** Add `AUTH_SIGNIN_LINK=true`, and optionally `AUTH_OIDC_NAME`. The header gains a "Sign in" control that goes straight to your issuer, skipping the chooser page, and shows the person's name and "Sign out" once they are in.

## Who may sign in

Your issuer decides who can authenticate. `AUTH_ALLOWED_EMAIL_DOMAINS` narrows that further, for a deployment whose issuer also serves people who should not use this app: a shared or public identity provider, or a partner's.

- The domain after the `@` in the address the issuer returns must be on the list exactly, compared without regard to case. A subdomain is a separate entry: `agency.gov` does not admit `mail.agency.gov`.
- The issuer must mark the address verified: `email_verified` is `true` or the string `"true"`. An address marked unverified, or with no `email_verified` claim, is refused, because a domain check on an address nobody confirmed checks nothing. For an issuer that never sends the claim, map it at the issuer (see the bridge steps below) or, failing that, set `AUTH_ALLOW_UNVERIFIED_EMAIL=true`. An explicit `false` is refused either way.
- An address with more than one `@` is refused.
- A person with no email claim is refused while a list is set.
- The check runs when the issuer returns, before the app stores anything, so a person refused at their first sign-in leaves no user record. A returning person who is refused keeps the record from their earlier sign-in. Either way they land on the Auth.js error page headed "Access Denied", with `error=AccessDenied` in its address.
- The address is read fresh from the issuer at every sign-in, not from the app's stored copy, so a person whose address has moved to an unlisted domain is refused on their next sign-in.
- Sessions already open are not re-checked when the list changes. They last until they expire or the person signs out; to end one at once, delete that person's rows in the `Session` table.

Leave the setting unset when the issuer already admits only the right people. That is the usual case for an agency's own identity provider.

## Verify

1. Start the app with the settings. A startup error names any missing setting.
2. Open `/api/auth/signin` (or click the header control) and sign in at your issuer.
3. You return to the app. With the header control on, your name shows in the header.
4. `/api/auth/session` returns your name and email.

The app reads name and email from the issuer's userinfo endpoint, and stores each person and their session in its database (the `User`, `Account` and `Session` tables). Signing out deletes the session.

## On AWS with this repository's Terraform

Set the environment's `oidc_*` inputs instead of the variables: `oidc_issuer`, `oidc_client_id`, and optionally `oidc_display_name`, `oidc_signin_link`, `oidc_allowed_email_domains` and `oidc_allow_unverified_email`. Terraform passes them to the task, sets `AUTH_URL` from the deployment's URL, and creates the client-secret entry in Secrets Manager without holding its value. After the apply, output `launch.sign_in` gives the redirect URI to register and the command that stores the client secret. The full mapping is in [Auth Strategy](../architecture/auth-strategy.md#in-a-deployed-environment).

## Behind a proxy or load balancer

Set `AUTH_URL` to the public URL people use. If a trusted proxy sets the host and you cannot set `AUTH_URL`, set `AUTH_TRUST_HOST=true` instead; with an issuer configured, the app will not start in production without one of the two. Terminate TLS in front of the app and keep the redirect URI on `https`.

## Troubleshooting

| What you see                                      | Likely cause                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup error "OIDC sign-in is partly configured" | One or two of the three `AUTH_OIDC_` settings are set. Set all three, or none.                                                                                                         |
| The issuer says the redirect URI is invalid       | The registered redirect URI does not match `<AUTH_URL>/api/auth/callback/oidc` exactly, scheme and host included.                                                                      |
| Auth.js error page reading "Configuration"        | The app cannot read the issuer's discovery document. Check `AUTH_OIDC_ISSUER` and that the app can reach it.                                                                           |
| Startup error "the app's public URL is not" set   | Production with an issuer, but neither `AUTH_URL` nor `AUTH_TRUST_HOST=true`.                                                                                                          |
| Auth.js error page headed "Access Denied"         | `AUTH_ALLOWED_EMAIL_DOMAINS` is set and the person's email domain is not on it, the issuer marked the address unverified or sent no `email_verified` claim, or it sent no email claim. |
| Signed in, but no name or email                   | The issuer did not release the `profile` or `email` claims to this client. Grant them at the issuer.                                                                                   |

## SAML through a bridge

Decoder Ring speaks OIDC only. To sign in with a SAML identity provider, put a bridge between the two: a service that is a SAML service provider to your identity provider and an OIDC issuer to the app. Open-source options include Keycloak (identity brokering) and Dex (SAML connector); many commercial identity platforms do the same.

1. **Stand up the bridge** with its own HTTPS URL, for example `https://sso-bridge.example.gov`.
2. **Register the bridge with your SAML identity provider** as a service provider: give the identity provider the bridge's SAML metadata, and give the bridge the identity provider's metadata.
3. **Map attributes to claims.** Release a stable identifier and map it to `sub`, and map the email and display-name attributes to `email` and `name`. Use a persistent identifier for `sub`, not a transient one, or each sign-in creates a new user. If you use a domain list, also emit `email_verified: true` for addresses your identity provider vouches for; a bridge drops the claim unless it is mapped, and the list then refuses everyone.
4. **Create an OIDC client in the bridge** for Decoder Ring, as in [What you need](#what-you-need).
5. **Point the app at the bridge:** `AUTH_OIDC_ISSUER` is the bridge's issuer URL for that client, and `AUTH_OIDC_ID` and `AUTH_OIDC_SECRET` come from step 4.
6. **Verify** as above. A person signs in at your SAML identity provider, the bridge turns the assertion into an OIDC sign-in, and the app sees the claims from step 3.

## What this does not do

- One issuer per deployment; there is no provider chooser.
- No roles or permissions: signing in identifies a person, and nothing in the app is restricted by it yet. The domain list decides who may sign in, not what they may do.
- No native SAML; see the bridge above.
