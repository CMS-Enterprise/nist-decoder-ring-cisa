// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { LINE_DATASETS, LINE_FIELDS } from "~/lib/export/from-detail";
import { EXPORT_DATASETS, EXPORT_FIELDS } from "~/lib/export/record";
import {
  loadExportSelection,
  type ExportSelection,
} from "~/lib/export/selection";
import { BUSY, BuildTimeout, ExportCache, exportCacheKey } from "../cache";

// The selection's parsers read the product config, which validates ~/env at import; nothing here connects.
vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
});

// The URL's defaults, so the facets are whichever the filter bar has.
const selection = (over: Partial<ExportSelection> = {}): ExportSelection => ({
  ...loadExportSelection("https://x.test/api/export"),
  ...over,
});

const file = (bytes: number, cacheable = true) => ({
  file: Buffer.alloc(bytes),
  name: "x.xlsx",
  etag: '"e"',
  cacheable,
});

describe("exportCacheKey", () => {
  it("is the same for every spelling of one selection", () => {
    const a = exportCacheKey(
      "v1",
      "xlsx",
      selection({
        family: ["SI", "AC"],
        pick: ["AC-2", "ac-02(01)"],
        q: " Audit ",
      }),
    );
    const b = exportCacheKey(
      "v1",
      "xlsx",
      selection({
        family: ["AC", "SI", "AC"],
        pick: ["ac-2.1", "AC-02"],
        q: "audit",
      }),
    );
    expect(a).toBe(b);
  });

  it("ignores what the export ignores: facets beside picks, datasets and fields the app lacks", () => {
    const picked = exportCacheKey("v1", "xlsx", selection({ pick: ["AC-02"] }));
    expect(
      exportCacheKey(
        "v1",
        "xlsx",
        selection({ pick: ["AC-02"], pillar: ["DATA"], q: "x" }),
      ),
    ).toBe(picked);
    expect(
      exportCacheKey("v1", "xlsx", selection({ data: [...EXPORT_DATASETS] })),
    ).toBe(
      exportCacheKey("v1", "xlsx", selection({ data: [...LINE_DATASETS] })),
    );
    expect(
      exportCacheKey("v1", "xlsx", selection({ fields: [...EXPORT_FIELDS] })),
    ).toBe(
      exportCacheKey("v1", "xlsx", selection({ fields: [...LINE_FIELDS] })),
    );
  });

  it("differs by version, format and selection", () => {
    const base = exportCacheKey("v1", "xlsx", selection());
    expect(exportCacheKey("v2", "xlsx", selection())).not.toBe(base);
    expect(exportCacheKey("v1", "docx", selection())).not.toBe(base);
    expect(
      exportCacheKey("v1", "xlsx", selection({ enhancements: "without" })),
    ).not.toBe(base);
    expect(exportCacheKey("v1", "xlsx", selection({ fields: [] }))).not.toBe(
      base,
    );
  });
});

describe("ExportCache", () => {
  const make = (
    over: Partial<ConstructorParameters<typeof ExportCache>[0]> = {},
  ) => {
    let t = 0;
    const cache = new ExportCache({
      maxBytes: 100,
      ttlMs: 1000,
      maxBuilds: 2,
      timeoutMs: 1000,
      now: () => t,
      ...over,
    });
    return { cache, tick: (ms: number) => (t += ms) };
  };

  it("builds once and serves the rest from memory until the TTL passes", async () => {
    const { cache, tick } = make();
    const build = vi.fn().mockResolvedValue(file(10));
    const first = await cache.get("k", build);
    expect(await cache.get("k", build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
    tick(1001);
    await cache.get("k", build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("shares one build between requests that arrive while it runs", async () => {
    const { cache } = make();
    const build = vi.fn().mockResolvedValue(file(10));
    const [a, b] = await Promise.all([
      cache.get("k", build),
      cache.get("k", build),
    ]);
    expect(a).toBe(b);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("refuses a build beyond the cap, and frees the slot when one finishes", async () => {
    const { cache } = make({ maxBuilds: 1 });
    let release!: () => void;
    const slow = cache.get(
      "a",
      () => new Promise((r) => (release = () => r(file(10)))),
    );
    expect(await cache.get("b", () => Promise.resolve(file(10)))).toBe(BUSY);
    release();
    await slow;
    expect(await cache.get("b", () => Promise.resolve(file(10)))).not.toBe(
      BUSY,
    );
  });

  it("frees the slot of a build that runs past the deadline", async () => {
    vi.useFakeTimers();
    try {
      const { cache } = make({ maxBuilds: 1, timeoutMs: 50 });
      const stuck = cache.get("a", () => new Promise(() => undefined));
      const failed = expect(stuck).rejects.toBeInstanceOf(BuildTimeout);
      expect(await cache.get("b", () => Promise.resolve(file(10)))).toBe(BUSY);
      await vi.advanceTimersByTimeAsync(50);
      await failed;
      expect(await cache.get("b", () => Promise.resolve(file(10)))).not.toBe(
        BUSY,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep a failed build, so the next request tries again", async () => {
    const { cache } = make();
    await expect(
      cache.get("k", () => Promise.reject(new Error("db"))),
    ).rejects.toThrow("db");
    expect(await cache.get("k", () => Promise.resolve(file(10)))).not.toBe(
      BUSY,
    );
  });

  it("evicts the least recently used file past the byte budget, and skips one too large to keep", async () => {
    const { cache } = make();
    const build = (n: number) => vi.fn().mockResolvedValue(file(n));
    const a = build(40);
    const b = build(40);
    await cache.get("a", a);
    await cache.get("b", b);
    await cache.get("a", a); // a is now the more recent
    await cache.get("c", build(40)); // over 100: b goes
    await cache.get("a", a);
    await cache.get("b", b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    const huge = build(101);
    await cache.get("h", huge);
    await cache.get("h", huge);
    expect(huge).toHaveBeenCalledTimes(2);
  });

  it("does not keep a file its builder marks uncacheable", async () => {
    const { cache } = make();
    const build = vi.fn().mockResolvedValue(file(10, false));
    await cache.get("k", build);
    await cache.get("k", build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
