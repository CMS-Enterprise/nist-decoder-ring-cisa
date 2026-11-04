import { render, screen } from "@testing-library/react";
import type * as TrpcClient from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as QueryClientModule from "../query-client";

// The links are recorded as the provider builds its client, in plain arrays,
// since mock call history is cleared before each test. Each stub link is never
// run: the provider builds its client and nothing here sends a request.
const built = vi.hoisted(() => ({
  batchOptions: [] as Array<{
    url: string;
    headers: () => Headers;
    transformer: unknown;
    fetch: unknown;
  }>,
  loggerOptions: [] as Array<{ enabled: (op: unknown) => boolean }>,
  queryClients: 0,
}));
vi.mock("@trpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof TrpcClient>()),
  httpBatchStreamLink: (opts: (typeof built.batchOptions)[number]) => {
    built.batchOptions.push(opts);
    return () => () => undefined;
  },
  loggerLink: (opts: (typeof built.loggerOptions)[number]) => {
    built.loggerOptions.push(opts);
    return () => () => undefined;
  },
}));
vi.mock("../query-client", async (importOriginal) => {
  const actual = await importOriginal<typeof QueryClientModule>();
  return {
    createQueryClient: () => {
      built.queryClients += 1;
      return actual.createQueryClient();
    },
  };
});

import SuperJSON from "superjson";

import { rateLimitedFetch } from "../rate-limited";

import { TRPCReactProvider } from "../react";

const renderProvider = () =>
  render(
    <TRPCReactProvider>
      <p>the bridge</p>
    </TRPCReactProvider>,
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TRPCReactProvider in the browser", () => {
  it("renders its children", () => {
    renderProvider();
    expect(screen.getByText("the bridge")).toBeInTheDocument();
  });

  it("sends batches to /api/trpc on the page's own origin, marked as coming from the client", () => {
    renderProvider();
    const opts = built.batchOptions.at(-1)!;
    expect(opts.url).toBe(`${window.location.origin}/api/trpc`);
    expect(opts.headers().get("x-trpc-source")).toBe("nextjs-react");
    expect(opts.transformer).toBe(SuperJSON);
    expect(opts.fetch).toBe(rateLimitedFetch);
  });

  it("keeps one query client for every provider on the page", () => {
    renderProvider();
    renderProvider();
    expect(built.queryClients).toBe(1);
  });

  it("logs every call in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    renderProvider();
    const { enabled } = built.loggerOptions.at(-1)!;
    expect(enabled({ direction: "up" })).toBe(true);
  });

  it("logs only failed responses outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    renderProvider();
    const { enabled } = built.loggerOptions.at(-1)!;
    expect(enabled({ direction: "up" })).toBe(false);
    expect(enabled({ direction: "down", result: { data: 1 } })).toBe(false);
    expect(enabled({ direction: "down", result: new Error("boom") })).toBe(
      true,
    );
  });
});
