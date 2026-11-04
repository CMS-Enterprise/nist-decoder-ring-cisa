import { type NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { env } = vi.hoisted(() => ({ env: { NODE_ENV: "test" } }));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: vi.fn() }));

// The handler runs against a two-procedure router built from the real procedure
// builders, so the request path, the context, the middleware and the error
// formatter are the app's own; only the procedures are the test's.
vi.mock("~/server/api/root", async () => {
  const { TRPCError } = await import("@trpc/server");
  const { z } = await import("zod");
  const { createTRPCRouter, publicProcedure } =
    await import("~/server/api/trpc");
  return {
    appRouter: createTRPCRouter({
      double: publicProcedure
        .input(z.object({ n: z.number() }))
        .query(({ input }) => input.n * 2),
      probe: publicProcedure.query(({ ctx }) => ctx.headers.get("x-probe")),
      missing: publicProcedure.query(() => {
        throw new TRPCError({ code: "NOT_FOUND", message: "no such control" });
      }),
    }),
  };
});

import { GET, POST } from "../route";

interface ErrorBody {
  error: {
    json: {
      message: string;
      data: { code: string; httpStatus: number; zodError: unknown };
    };
  };
}

const get = (procedure: string, input?: unknown, headers?: HeadersInit) => {
  const query =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  return GET(
    new Request(`http://localhost/api/trpc/${procedure}${query}`, {
      headers,
    }) as NextRequest,
  );
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  env.NODE_ENV = "test";
  vi.restoreAllMocks();
});

describe("the tRPC route handler", () => {
  it("answers a query with its result", async () => {
    const res = await get("double", { n: 21 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { data: { json: 42 } } });
  });

  it("builds the context from the request's own headers", async () => {
    const res = await get("probe", undefined, {
      "x-probe": "from the request",
    });
    expect(await res.json()).toEqual({
      result: { data: { json: "from the request" } },
    });
  });

  it("serves POST through the same handler", () => {
    expect(POST).toBe(GET);
  });

  it("returns invalid input as a 400 carrying the flattened Zod error", async () => {
    const res = await get("double", { n: "twenty-one" });
    expect(res.status).toBe(400);
    const { data } = ((await res.json()) as ErrorBody).error.json;
    expect(data.code).toBe("BAD_REQUEST");
    expect(data.zodError).toMatchObject({
      fieldErrors: { n: [expect.any(String)] },
    });
  });

  it("returns any other error with its own code and no Zod error", async () => {
    const res = await get("missing");
    expect(res.status).toBe(404);
    const body = ((await res.json()) as ErrorBody).error.json;
    expect(body.message).toBe("no such control");
    expect(body.data).toMatchObject({ code: "NOT_FOUND", zodError: null });
  });

  it("logs a failed call in development", async () => {
    env.NODE_ENV = "development";
    await get("missing");
    expect(console.error).toHaveBeenCalledWith(
      "❌ tRPC failed on missing: no such control",
    );
  });

  it("does not log a failed call outside development", async () => {
    env.NODE_ENV = "production";
    await get("missing");
    expect(console.error).not.toHaveBeenCalled();
  });
});
