import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, db } = vi.hoisted(() => ({
  auth: vi.fn(),
  db: { name: "the database client" },
}));
vi.mock("~/server/auth", () => ({ auth }));
vi.mock("~/server/db", () => ({ db }));

import {
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  publicProcedure,
} from "~/server/api/trpc";

const OIDC = {
  AUTH_OIDC_ISSUER: "https://issuer.example.gov",
  AUTH_OIDC_ID: "decoder-ring",
  AUTH_OIDC_SECRET: "a-secret",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  auth.mockReset();
});

describe("createTRPCContext", () => {
  it("never asks Auth.js for a session when no issuer is configured", async () => {
    vi.stubEnv("AUTH_OIDC_ISSUER", "");
    const headers = new Headers({ "x-trpc-source": "test" });

    const ctx = await createTRPCContext({ headers });

    expect(auth).not.toHaveBeenCalled();
    expect(ctx).toEqual({ db, session: null, headers });
  });

  it("treats an issuer without its client id and secret as unconfigured", async () => {
    vi.stubEnv("AUTH_OIDC_ISSUER", OIDC.AUTH_OIDC_ISSUER);
    vi.stubEnv("AUTH_OIDC_ID", "");
    vi.stubEnv("AUTH_OIDC_SECRET", "");

    const ctx = await createTRPCContext({ headers: new Headers() });

    expect(auth).not.toHaveBeenCalled();
    expect(ctx.session).toBeNull();
  });

  it("returns Auth.js's session when an issuer is configured", async () => {
    for (const [key, value] of Object.entries(OIDC)) vi.stubEnv(key, value);
    const session = { user: { id: "u1" }, expires: "2099-01-01T00:00:00.000Z" };
    auth.mockResolvedValue(session);

    const ctx = await createTRPCContext({ headers: new Headers() });

    expect(auth).toHaveBeenCalledOnce();
    expect(ctx.session).toBe(session);
    expect(ctx.db).toBe(db);
  });
});

describe("the timing middleware", () => {
  const caller = createCallerFactory(
    createTRPCRouter({ ping: publicProcedure.query(() => "pong") }),
  )({ db: db as never, session: null, headers: new Headers() });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("delays every call in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let settled = false;
    const call = caller.ping().then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(401);
    await expect(call).resolves.toBe("pong");
  });

  it.each(["test", "production"])(
    "does not delay when NODE_ENV is %s",
    async (env) => {
      vi.stubEnv("NODE_ENV", env);
      await expect(caller.ping()).resolves.toBe("pong");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("logs each call's path and duration", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await caller.ping();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[TRPC\] ping took \d+ms to execute$/),
    );
  });
});
