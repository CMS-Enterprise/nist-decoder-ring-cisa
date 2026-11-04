import { afterEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  return { env };
});
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db: {} }));

import { OIDC_PROVIDER_ID } from "../settings";

const OIDC = {
  AUTH_OIDC_ISSUER: "https://issuer.example.gov",
  AUTH_OIDC_ID: "decoder-ring",
  AUTH_OIDC_SECRET: "a-secret",
};

// config.ts reads the environment once, when it is first imported, so each case
// replaces the environment and then loads a fresh copy. Replaced, not merged: a
// second load in one test sees only the settings it was given.
async function configWith(values: Record<string, string>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, values);
  vi.resetModules();
  return (await import("../config")).authConfig;
}

type SignIn = (params: {
  user: { email?: string };
  profile?: unknown;
}) => unknown;

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

describe("the app's Auth.js configuration", () => {
  it("has no providers when no issuer is configured", async () => {
    const config = await configWith({});
    expect(config.providers).toEqual([]);
  });

  it("signs in through the configured issuer", async () => {
    const config = await configWith(OIDC);
    expect(config.providers).toEqual([
      expect.objectContaining({
        id: OIDC_PROVIDER_ID,
        type: "oidc",
        issuer: OIDC.AUTH_OIDC_ISSUER,
        clientId: OIDC.AUTH_OIDC_ID,
        clientSecret: OIDC.AUTH_OIDC_SECRET,
      }),
    ]);
  });

  it("limits sign-in to the listed email domains", async () => {
    const config = await configWith({
      ...OIDC,
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.gov",
    });
    const signIn = config.callbacks!.signIn as SignIn;
    const as = (email: string) =>
      signIn({ user: {}, profile: { email, email_verified: true } });
    expect(as("pat@example.gov")).toBe(true);
    expect(as("pat@example.com")).toBe(false);
  });

  it("passes the unverified-email allowance through", async () => {
    const strict = await configWith({
      ...OIDC,
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.gov",
    });
    const unverified = { user: {}, profile: { email: "pat@example.gov" } };
    expect((strict.callbacks!.signIn as SignIn)(unverified)).toBe(false);

    const relaxed = await configWith({
      ...OIDC,
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.gov",
      AUTH_ALLOW_UNVERIFIED_EMAIL: "true",
    });
    expect((relaxed.callbacks!.signIn as SignIn)(unverified)).toBe(true);
  });
});
