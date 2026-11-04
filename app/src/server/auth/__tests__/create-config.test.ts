import { describe, expect, it, vi } from "vitest";

const { prismaAdapter, adapter } = vi.hoisted(() => {
  const adapter = { name: "the Prisma adapter" };
  return { adapter, prismaAdapter: vi.fn(() => adapter) };
});
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: prismaAdapter }));

import { createAuthConfig } from "../create-config";

const db = {} as never;
const provider = { id: "oidc", type: "oidc" } as never;

type SignIn = (params: {
  user: { id?: string; email?: string };
  profile?: { email?: string; email_verified?: unknown };
}) => unknown;
type Session = (params: {
  session: { user: { name: string; email: string }; expires: string };
  user: { id: string };
}) => unknown;

const signInOf = (domains?: string[], allowUnverified?: boolean) =>
  createAuthConfig(db, [], domains, allowUnverified).callbacks!
    .signIn as SignIn;

describe("createAuthConfig", () => {
  it("stores users through the Prisma adapter on the given client", () => {
    const config = createAuthConfig(db, [provider]);
    expect(prismaAdapter).toHaveBeenCalledWith(db);
    expect(config.adapter).toBe(adapter);
    expect(config.providers).toEqual([provider]);
  });

  it("lets anyone the issuer signs in through when no domain list is set", () => {
    expect(signInOf()({ user: { email: "pat@anywhere.org" } })).toBe(true);
  });

  it("checks the issuer's profile, not the stored user's address", () => {
    const signIn = signInOf(["example.gov"]);
    const stored = { email: "pat@example.gov" };
    expect(
      signIn({
        user: stored,
        profile: { email: "pat@example.com", email_verified: true },
      }),
    ).toBe(false);
    expect(
      signIn({
        user: { email: "old@example.com" },
        profile: { email: "pat@example.gov", email_verified: true },
      }),
    ).toBe(true);
  });

  it("falls back to the stored address when there is no profile", () => {
    const signIn = signInOf(["example.gov"], true);
    expect(signIn({ user: { email: "pat@example.gov" } })).toBe(true);
    expect(signIn({ user: { email: "pat@example.com" } })).toBe(false);
  });

  it("refuses an unverified address unless the allowance is set", () => {
    const unverified = { user: {}, profile: { email: "pat@example.gov" } };
    expect(signInOf(["example.gov"])(unverified)).toBe(false);
    expect(signInOf(["example.gov"], true)(unverified)).toBe(true);
  });

  it("puts the user's id on the session and keeps the rest", () => {
    const session = createAuthConfig(db, []).callbacks!.session as Session;
    const result = session({
      session: {
        user: { name: "Pat Example", email: "pat@example.gov" },
        expires: "2099-01-01T00:00:00.000Z",
      },
      user: { id: "u1" },
    });
    expect(result).toEqual({
      user: { name: "Pat Example", email: "pat@example.gov", id: "u1" },
      expires: "2099-01-01T00:00:00.000Z",
    });
  });
});
