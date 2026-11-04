// @vitest-environment node
import { renderToString } from "react-dom/server";
import type * as TrpcClient from "@trpc/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as QueryClientModule from "../query-client";

// The same provider rendered on the server, where there is no window: the base
// URL comes from the environment and every render gets its own query client.
// Recorded in plain arrays, since mock call history is cleared before each test.
const built = vi.hoisted(() => ({ urls: [] as string[], queryClients: 0 }));
vi.mock("@trpc/client", async (importOriginal) => ({
  ...(await importOriginal<typeof TrpcClient>()),
  httpBatchStreamLink: (opts: { url: string }) => {
    built.urls.push(opts.url);
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

import { TRPCReactProvider } from "../react";

const renderOnServer = () =>
  renderToString(
    <TRPCReactProvider>
      <p>the bridge</p>
    </TRPCReactProvider>,
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TRPCReactProvider on the server", () => {
  it("renders its children", () => {
    expect(renderOnServer()).toContain("the bridge");
  });

  it("builds a fresh query client for every render", () => {
    const before = built.queryClients;
    renderOnServer();
    renderOnServer();
    expect(built.queryClients - before).toBe(2);
  });

  it("uses the Vercel URL when one is set", () => {
    vi.stubEnv("VERCEL_URL", "preview.example.app");
    renderOnServer();
    expect(built.urls.at(-1)).toBe("https://preview.example.app/api/trpc");
  });

  it("falls back to localhost on PORT, or 3000", () => {
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("PORT", "4321");
    renderOnServer();
    expect(built.urls.at(-1)).toBe("http://localhost:4321/api/trpc");

    delete process.env.PORT;
    renderOnServer();
    expect(built.urls.at(-1)).toBe("http://localhost:3000/api/trpc");
  });
});
