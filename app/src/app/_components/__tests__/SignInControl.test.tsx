import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { env, auth, connection } = vi.hoisted(() => {
  const env: Record<string, string | undefined> = {};
  return { env, auth: vi.fn(), connection: vi.fn(async () => undefined) };
});
vi.mock("~/env", () => ({ env }));
// connection() needs a request scope that a direct render does not have; the mock stands in
// for it and lets the test show the setting is read per request, not at build.
vi.mock("next/server", () => ({ connection }));
vi.mock("~/server/auth", () => ({ auth, signIn: vi.fn(), signOut: vi.fn() }));

import { SignInControl } from "../SignInControl";

const ISSUER = {
  AUTH_OIDC_ISSUER: "https://idp.example.gov",
  AUTH_OIDC_ID: "decoder-ring",
  AUTH_OIDC_SECRET: "s3cret",
};

async function show() {
  const element = await SignInControl();
  if (element) render(element);
  return element;
}

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  auth.mockReset();
  connection.mockClear();
});

describe("SignInControl", () => {
  it("renders nothing, and never reads the session, without the link setting", async () => {
    Object.assign(env, ISSUER);
    expect(await show()).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });

  it("waits for the request before reading the setting, so a built page still follows it", async () => {
    await show();
    expect(connection).toHaveBeenCalledOnce();
  });

  it("renders nothing when the link is set but no issuer is", async () => {
    Object.assign(env, { AUTH_SIGNIN_LINK: "true" });
    expect(await show()).toBeNull();
  });

  it("offers sign-in, named for the provider when one is named", async () => {
    Object.assign(env, ISSUER, {
      AUTH_SIGNIN_LINK: "true",
      AUTH_OIDC_NAME: "Agency SSO",
    });
    auth.mockResolvedValue(null);
    await show();
    expect(
      screen.getByRole("button", { name: "Sign in with Agency SSO" }),
    ).toBeInTheDocument();
  });

  it("says just Sign in when the provider is unnamed", async () => {
    Object.assign(env, ISSUER, { AUTH_SIGNIN_LINK: "true" });
    auth.mockResolvedValue(null);
    await show();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows who is signed in and offers sign-out", async () => {
    Object.assign(env, ISSUER, { AUTH_SIGNIN_LINK: "true" });
    auth.mockResolvedValue({ user: { id: "u1", name: "Pat Example" } });
    await show();
    expect(screen.getByText("Pat Example")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});
