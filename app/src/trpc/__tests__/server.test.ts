import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// server.ts wires everything up when it is imported, and mock call history is
// cleared before each test, so the stubs record their arguments in plain arrays.
const stubs = vi.hoisted(() => {
  const record = {
    callerFactoryArgs: [] as Array<() => Promise<unknown>>,
    helperArgs: [] as Array<[unknown, () => unknown]>,
    contextArgs: [] as Array<{ headers: Headers }>,
  };
  const caller = { name: "the server-side caller" };
  const helpers = { trpc: { name: "api" }, HydrateClient: () => null };
  return {
    record,
    caller,
    helpers,
    createCaller: (createContext: () => Promise<unknown>) => {
      record.callerFactoryArgs.push(createContext);
      return caller;
    },
    createHydrationHelpers: (c: unknown, getQueryClient: () => unknown) => {
      record.helperArgs.push([c, getQueryClient]);
      return helpers;
    },
    createTRPCContext: async (opts: { headers: Headers }) => {
      record.contextArgs.push(opts);
      return { session: null, ...opts };
    },
  };
});
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
}));
vi.mock("~/server/api/root", () => ({ createCaller: stubs.createCaller }));
vi.mock("~/server/api/trpc", () => ({
  createTRPCContext: stubs.createTRPCContext,
}));
vi.mock("@trpc/react-query/rsc", () => ({
  createHydrationHelpers: stubs.createHydrationHelpers,
}));

import { api, HydrateClient } from "../server";

describe("the server component tRPC caller", () => {
  it("exports the hydration helpers built on the app's caller", () => {
    expect(stubs.record.helperArgs).toHaveLength(1);
    expect(stubs.record.helperArgs[0]![0]).toBe(stubs.caller);
    expect(api).toBe(stubs.helpers.trpc);
    expect(HydrateClient).toBe(stubs.helpers.HydrateClient);
  });

  it("hands the helpers a query client factory", () => {
    const getQueryClient = stubs.record.helperArgs[0]![1];
    expect(getQueryClient()).toBeInstanceOf(QueryClient);
  });

  it("builds each context from the request headers, marked as coming from a server component", async () => {
    const createContext = stubs.record.callerFactoryArgs[0]!;
    await createContext();
    const { headers } = stubs.record.contextArgs.at(-1)!;
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("x-trpc-source")).toBe("rsc");
  });
});
