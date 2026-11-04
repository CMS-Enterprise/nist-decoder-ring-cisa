import { describe, expect, it } from "vitest";
import type { LiveResult } from "../../../../scripts/check-links/report.js";
import {
  parseLiveResults,
  todayUtc,
  toLiveResultsCsv,
} from "../lib/live-results.js";

function result(overrides: Partial<LiveResult> & { url: string }): LiveResult {
  return {
    record: { id: overrides.url, source: "test", url: overrides.url },
    status: overrides.status === undefined ? 200 : overrides.status,
    finalUrl: overrides.finalUrl ?? null,
    contentType: overrides.contentType ?? null,
    ok: overrides.ok ?? true,
    linkClass: overrides.linkClass ?? "reachable",
    error: overrides.error ?? null,
  };
}

describe("toLiveResultsCsv", () => {
  it("writes the header, one row per distinct URL, sorted by URL, first result winning", () => {
    const csv = toLiveResultsCsv(
      [
        result({
          url: "https://b.gov/2",
          status: 404,
          ok: false,
          linkClass: "gone",
        }),
        result({
          url: "https://a.gov/1",
          status: 206,
          finalUrl: "https://a.gov/1",
          contentType: "application/pdf",
        }),
        result({ url: "https://b.gov/2", status: 200 }),
      ],
      "2026-09-29",
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "url,status,final_url,content_type,class,error,checked_on",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      "https://a.gov/1,206,https://a.gov/1,application/pdf,reachable,,2026-09-29",
    );
    expect(lines[2]).toBe("https://b.gov/2,404,,,gone,,2026-09-29");
  });

  it("quotes fields that need it and keeps the error text", () => {
    const csv = toLiveResultsCsv(
      [
        result({
          url: "https://c.gov/x",
          status: null,
          ok: false,
          linkClass: "tls-chain",
          error: "fetch failed [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]",
        }),
        result({ url: "https://d.gov/y,z", status: 206 }),
      ],
      "2026-09-29",
    );
    expect(csv).toContain(
      "https://c.gov/x,,,,tls-chain,fetch failed [UNABLE_TO_GET_ISSUER_CERT_LOCALLY],2026-09-29",
    );
    expect(csv).toContain('"https://d.gov/y,z",206');
  });
});

describe("parseLiveResults", () => {
  it("round-trips the file and maps empty fields to null", () => {
    const rows = parseLiveResults(
      "url,status,final_url,content_type,class,error,checked_on\nhttps://a.gov,404,,,gone,,2026-09-29\nhttps://b.gov,206,https://b.gov/x.pdf,application/pdf,reachable,,2026-09-29\n",
    );
    expect(rows).toEqual([
      {
        url: "https://a.gov",
        status: 404,
        finalUrl: null,
        contentType: null,
        linkClass: "gone",
        error: null,
        checkedOn: "2026-09-29",
      },
      {
        url: "https://b.gov",
        status: 206,
        finalUrl: "https://b.gov/x.pdf",
        contentType: "application/pdf",
        linkClass: "reachable",
        error: null,
        checkedOn: "2026-09-29",
      },
    ]);
    expect(parseLiveResults("")).toEqual([]);
  });
});

describe("todayUtc", () => {
  it("is the UTC calendar date", () => {
    expect(todayUtc(new Date("2026-09-29T23:59:59Z"))).toBe("2026-09-29");
    expect(todayUtc(new Date("2026-09-30T00:00:01Z"))).toBe("2026-09-30");
  });
});
