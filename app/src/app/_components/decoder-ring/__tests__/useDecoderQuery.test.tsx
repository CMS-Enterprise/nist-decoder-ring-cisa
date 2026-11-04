import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  withNuqsTestingAdapter,
  type UrlUpdateEvent,
} from "nuqs/adapters/testing";

import { useDecoderQuery } from "../useDecoderQuery";

describe("useDecoderQuery", () => {
  it("defaults to empty facets and search", () => {
    const { result } = renderHook(() => useDecoderQuery(), {
      wrapper: withNuqsTestingAdapter({ searchParams: "" }),
    });
    expect(result.current.query.pillar).toEqual([]);
    expect(result.current.query.maturity).toEqual([]);
    expect(result.current.query.family).toEqual([]);
    expect(result.current.query.status).toEqual([]);
    expect(result.current.query.q).toBe("");
    expect(result.current.isActive).toBe(false);
  });

  it("parses multi-select facets and the search term from the URL", () => {
    const { result } = renderHook(() => useDecoderQuery(), {
      wrapper: withNuqsTestingAdapter({
        searchParams:
          "?pillar=IDENTITY,DATA&maturity=ADVANCED&family=AC&status=zero-trust-aligned&q=account",
      }),
    });
    expect(result.current.query.pillar).toEqual(["IDENTITY", "DATA"]);
    expect(result.current.query.maturity).toEqual(["ADVANCED"]);
    expect(result.current.query.family).toEqual(["AC"]);
    expect(result.current.query.status).toEqual(["zero-trust-aligned"]);
    expect(result.current.query.q).toBe("account");
    expect(result.current.isActive).toBe(true);
  });

  it("ignores an invalid enum value in the URL", () => {
    const { result } = renderHook(() => useDecoderQuery(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?pillar=BOGUS,IDENTITY",
      }),
    });
    expect(result.current.query.pillar).not.toContain("BOGUS");
  });

  it("clear() drops every facet and the search term from the URL", async () => {
    const onUrlUpdate = vi.fn();
    const { result } = renderHook(() => useDecoderQuery(), {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?pillar=IDENTITY&q=account",
        onUrlUpdate,
      }),
    });
    await act(async () => {
      await result.current.clear();
    });
    expect(onUrlUpdate).toHaveBeenCalled();
    const event = onUrlUpdate.mock.calls.at(-1)?.[0] as
      UrlUpdateEvent | undefined;
    expect(event?.queryString ?? "").not.toContain("pillar");
    expect(event?.queryString ?? "").not.toContain("account");
  });
});
