/**
 * One request per distinct URL, every record still reported: the shape that
 * keeps a seed check from hammering a host and reading the rate limit as a block.
 */

import { describe, expect, it } from "vitest";
import { dedupeByUrl } from "../results.js";

describe("dedupeByUrl", () => {
  it("probes each URL once and hands every record its result", () => {
    const records = [
      { id: "ctrl_ac-01_r520", source: "s", url: "https://a.gov/1" },
      { id: "ctrl_ac-02_r520", source: "s", url: "https://a.gov/1" },
      { id: "ctrl_ac-03_r520", source: "s", url: "https://b.gov/2" },
    ];
    const { distinct, expand } = dedupeByUrl(records);
    expect(distinct.map((r) => r.id)).toEqual([
      "ctrl_ac-01_r520",
      "ctrl_ac-03_r520",
    ]);
    const expanded = expand(
      distinct.map((record) => ({
        record,
        status: record.url.endsWith("1") ? 206 : 404,
      })),
    );
    expect(expanded.map((r) => [r.record.id, r.status])).toEqual([
      ["ctrl_ac-01_r520", 206],
      ["ctrl_ac-02_r520", 206],
      ["ctrl_ac-03_r520", 404],
    ]);
  });

  it("drops a record whose URL produced no result", () => {
    const { expand } = dedupeByUrl([{ url: "https://a.gov/1" }]);
    expect(expand([])).toEqual([]);
  });
});
