import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

// index.ts does its work once, when it is imported, and mock call history is
// cleared before each test, so the stubs record their arguments in plain arrays.
const stubs = vi.hoisted(() => {
  const uncachedAuth = () => null;
  const cachedAuth = () => null;
  const handlers = { GET: () => null, POST: () => null };
  const signIn = () => null;
  const signOut = () => null;
  const nextAuthArgs: unknown[] = [];
  const cacheArgs: unknown[] = [];
  return {
    authConfig: { providers: [] },
    uncachedAuth,
    cachedAuth,
    handlers,
    signIn,
    signOut,
    nextAuthArgs,
    cacheArgs,
    nextAuth: (config: unknown) => {
      nextAuthArgs.push(config);
      return { auth: uncachedAuth, handlers, signIn, signOut };
    },
    cache: (fn: unknown) => {
      cacheArgs.push(fn);
      return cachedAuth;
    },
  };
});
vi.mock("../config", () => ({ authConfig: stubs.authConfig }));
vi.mock("next-auth", () => ({ default: stubs.nextAuth }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  cache: stubs.cache,
}));

import * as exported from "../index";

describe("the Auth.js instance", () => {
  it("is built once, from the app's configuration", () => {
    expect(stubs.nextAuthArgs).toEqual([stubs.authConfig]);
  });

  it("exports auth wrapped in React's per-request cache", () => {
    expect(stubs.cacheArgs).toEqual([stubs.uncachedAuth]);
    expect(exported.auth).toBe(stubs.cachedAuth);
  });

  it("exports Auth.js's handlers, signIn and signOut as they are", () => {
    expect(exported.handlers).toBe(stubs.handlers);
    expect(exported.signIn).toBe(stubs.signIn);
    expect(exported.signOut).toBe(stubs.signOut);
  });
});
