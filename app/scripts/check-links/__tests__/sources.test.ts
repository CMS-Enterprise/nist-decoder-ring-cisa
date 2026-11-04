/**
 * Behavioral tests for the API collector.
 *
 * `sources.ts` stays coverage-excluded (db/fs/network side effects), but the API
 * walk needs a correctness gate regardless: it called a procedure that had been
 * renamed out from under it, so every `--source=api` run 404'd, collected zero
 * URLs, and still exited 0 — a green gate over nothing. The compile-time guard
 * in sources.ts stops a rename from recurring; these pin the runtime behavior
 * that made it invisible, so a future silent-zero fails loudly here.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { collectFromApi } from "../sources.js";

const BASE = "https://dev.example.gov";

/** Wrap a payload in the tRPC v11 batch-GET response envelope. */
function trpcOk(payload: unknown): Response {
  return new Response(
    JSON.stringify([{ result: { data: { json: payload } } }]),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

const BRIDGE_PAYLOAD = {
  version: "NIST SP 800-53 Rev 5",
  families: [{ id: "AC", name: "Access Control", controls: [{ id: "AC-02" }] }],
};

const CONTROL_PAYLOAD = {
  id: "AC-02",
  // `domain` is part of the served link shape (NIST / FEDERAL / EXTERNAL).
  // It is here for fidelity to the real payload, not because a type requires
  // it: the collector narrows links to { url }, so omitting it would still
  // compile. Keeping it means the fixture matches what the API actually sends.
  ztLinks: [
    {
      label: "ZT",
      url: "https://docs.example.gov/learn/zero-trust",
      domain: "NIST",
    },
  ],
  nistLinks: [
    { label: "Policy", url: "https://example.gov/policy", domain: "FEDERAL" },
  ],
  enhancements: [
    {
      id: "AC-02(01)",
      ztLinks: [
        {
          label: "ZT enh",
          url: "https://docs.example.gov/enh",
          domain: "NIST",
        },
      ],
    },
  ],
};

/** Route by procedure name so a wrong name is a miss, not a lucky pass. */
function mockApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string | URL) => {
    const url = String(input);
    if (url.includes("decoder.getBridgeData")) {
      return Promise.resolve(trpcOk(BRIDGE_PAYLOAD));
    }
    if (url.includes("decoder.getControlById")) {
      return Promise.resolve(trpcOk(CONTROL_PAYLOAD));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collectFromApi", () => {
  it("walks getBridgeData for the control list, not the renamed getAllFamilies", async () => {
    const fetchMock = mockApi();
    await collectFromApi(BASE);

    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called[0]).toContain("/api/trpc/decoder.getBridgeData");
    expect(called.join(" ")).not.toContain("getAllFamilies");
  });

  it("sends json:null for getBridgeData, which takes no input", async () => {
    const fetchMock = mockApi();
    await collectFromApi(BASE);

    const first = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(first.searchParams.get("batch")).toBe("1");
    expect(JSON.parse(first.searchParams.get("input")!)).toEqual({
      0: { json: null },
    });
  });

  it("collects base and enhancement links from both panes", async () => {
    mockApi();
    const records = await collectFromApi(BASE);

    expect(records.map((r) => r.url)).toEqual([
      "https://docs.example.gov/learn/zero-trust",
      "https://example.gov/policy",
      "https://docs.example.gov/enh",
    ]);
    expect(records[2]).toMatchObject({
      id: "AC-02(01)",
      source: "api:getControlById.enhancement.ztLinks",
    });
  });

  it("throws on a 404 instead of returning zero records", async () => {
    // The exact shape of the shipped bug: the procedure is not there, so the
    // walk must fail rather than report a clean run over an empty list.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not found", { status: 404 }))),
    );

    await expect(collectFromApi(BASE)).rejects.toThrow(/404/);
  });

  it("throws when the envelope carries a tRPC error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                error: { json: { message: "No active catalog version found" } },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );

    await expect(collectFromApi(BASE)).rejects.toThrow(
      /No active catalog version found/,
    );
  });
});
