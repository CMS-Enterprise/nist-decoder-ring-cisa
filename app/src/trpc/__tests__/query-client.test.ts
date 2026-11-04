import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "../query-client";

const options = () => createQueryClient().getDefaultOptions();

// shouldDehydrateQuery reads only the query's state.
const queryIn = (status: "pending" | "success" | "error") =>
  ({ state: { status } }) as never;

describe("createQueryClient", () => {
  it("builds a fresh client each call", () => {
    const a = createQueryClient();
    expect(a).toBeInstanceOf(QueryClient);
    expect(createQueryClient()).not.toBe(a);
  });

  it("keeps results fresh for 30 seconds, so the client does not refetch what the server sent", () => {
    expect(options().queries?.staleTime).toBe(30_000);
  });

  it("dehydrates finished and still-pending queries, but not failed ones", () => {
    const should = options().dehydrate!.shouldDehydrateQuery!;
    expect(should(queryIn("success"))).toBe(true);
    expect(should(queryIn("pending"))).toBe(true);
    expect(should(queryIn("error"))).toBe(false);
  });

  it("carries data across the server-to-client boundary with SuperJSON", () => {
    const { dehydrate, hydrate } = options();
    const data = {
      at: new Date("2026-10-29T12:00:00Z"),
      ids: new Set(["ac-2"]),
    };
    const wire = JSON.parse(
      JSON.stringify(dehydrate!.serializeData!(data)),
    ) as unknown;
    expect(hydrate!.deserializeData!(wire)).toEqual(data);
  });
});
