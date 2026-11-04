// @vitest-environment node
import { TRPCError } from "@trpc/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportRecord } from "~/lib/export/record";

// The selection's parsers read the product config, which validates ~/env at import; nothing here connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});

const getExportRecord = vi.fn();
const getActiveVersion = vi.fn();
vi.mock("~/server/api/root", () => ({
  createCaller: () => ({ decoder: { getActiveVersion } }),
  createExportCaller: () => ({ export: { getExportRecord } }),
}));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: vi.fn() }));

const { GET } = await import("./route");
const { BuildTimeout, exportCache } = await import("~/server/export/cache");

const RECORD: ExportRecord = {
  catalog: "Example Catalog 1.0",
  versionId: "v1",
  datasets: ["statement"],
  fields: [],
  controls: [
    {
      id: "AC-02",
      oscalId: "ac-2",
      name: "Account Management",
      family: "AC",
      baseId: null,
      baselines: [],
      statement: { text: "Manage accounts.", discussion: null, parameters: [] },
    },
  ],
};

const get = (query: string, headers?: HeadersInit) =>
  GET(new NextRequest(`https://x.test/api/export${query}`, { headers }));

describe("GET /api/export", () => {
  beforeEach(() => {
    exportCache.clear();
    getExportRecord.mockReset().mockResolvedValue(RECORD);
    getActiveVersion.mockReset().mockResolvedValue({ id: "v1" });
  });

  it("passes the parsed selection to the procedure", async () => {
    await get("?pick=AC-02&enhancements=without&data=statement&family=AC");
    expect(getExportRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        pick: ["AC-02"],
        enhancements: "without",
        data: ["statement"],
        family: ["AC"],
      }),
    );
  });

  it("returns an XLSX attachment by default", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-catalog-1.0-export.xlsx"',
    );
  });

  it("returns a DOCX attachment when asked", async () => {
    const res = await get("?format=docx");
    expect(res.headers.get("Content-Type")).toContain("wordprocessingml");
  });

  it("answers a rejected selection with 400", async () => {
    getExportRecord.mockRejectedValue(
      new TRPCError({ code: "BAD_REQUEST", message: "bad selection" }),
    );
    const res = await get("?q=x");
    expect(res.status).toBe(400);
  });

  it.each([
    ["?enhancements=Without", "enhancements"],
    ["?format=pdf", "format"],
    ["?data=statment", "data"],
    ["?data=statement,bogus", "data"],
    ["?baseline=moderate", "baseline"],
    ["?fields=bogus", "fields"],
    ["?fields=baselines,bogus", "fields"],
    ["?pick=", "pick"],
  ])("refuses %s rather than exporting something else", async (query, key) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(key);
    expect(getExportRecord).not.toHaveBeenCalled();
  });

  it("accepts an empty dataset or field list, as the page writes one", async () => {
    expect((await get("?data=&fields=")).status).toBe(200);
    expect(getExportRecord).toHaveBeenCalledWith(
      expect.objectContaining({ data: [], fields: [] }),
    );
  });

  it("answers 503 when the build runs past the deadline", async () => {
    getExportRecord.mockRejectedValue(new BuildTimeout());
    const res = await get("");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("lets any other failure through to Next's error handling", async () => {
    getExportRecord.mockRejectedValue(
      new Error("No active catalog version found"),
    );
    await expect(get("")).rejects.toThrow("No active catalog version found");
  });

  it("serves a repeat from the cache, and a matching ETag with 304", async () => {
    const first = await get("?pick=AC-02");
    const etag = first.headers.get("ETag")!;
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300");

    // Same file however the URL spells it.
    const again = await get("?pick=ac-2");
    expect(again.status).toBe(200);
    expect(again.headers.get("ETag")).toBe(etag);
    expect(getExportRecord).toHaveBeenCalledTimes(1);

    const revalidated = await get("?pick=AC-02", { "If-None-Match": etag });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");

    for (const header of [`"other", W/${etag}`, "*"]) {
      const res = await get("?pick=AC-02", { "If-None-Match": header });
      expect(res.status).toBe(304);
    }
    const stale = await get("?pick=AC-02", { "If-None-Match": '"other"' });
    expect(stale.status).toBe(200);
  });

  it("builds again once the catalog version changes", async () => {
    await get("");
    getActiveVersion.mockResolvedValue({ id: "v2" });
    getExportRecord.mockResolvedValue({ ...RECORD, versionId: "v2" });
    await get("");
    expect(getExportRecord).toHaveBeenCalledTimes(2);
  });

  it("does not keep a file read from another version than its key's", async () => {
    getExportRecord.mockResolvedValue({ ...RECORD, versionId: "v2" });
    await get("");
    await get("");
    expect(getExportRecord).toHaveBeenCalledTimes(2);
  });

  it("keeps the ETag across a rebuild of the same record", async () => {
    const first = await get("?format=docx");
    exportCache.clear();
    const second = await get("?format=docx");
    expect(getExportRecord).toHaveBeenCalledTimes(2);
    expect(second.headers.get("ETag")).toBe(first.headers.get("ETag"));
  });

  it("answers 429 while every build slot is taken", async () => {
    let release!: () => void;
    getExportRecord.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(RECORD);
      }),
    );
    const slow = [get("?family=AC"), get("?family=SI")];
    // Let both builds start before the third request arrives.
    await vi.waitFor(() => expect(getExportRecord).toHaveBeenCalledTimes(2));
    const busy = await get("?family=PE");
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("5");

    release();
    expect((await Promise.all(slow)).map((r) => r.status)).toEqual([200, 200]);
  });
});
