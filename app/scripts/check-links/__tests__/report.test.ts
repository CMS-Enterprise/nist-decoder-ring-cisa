/**
 * Behavioral tests for the live probe.
 *
 * `report.ts` stays coverage-excluded (network + stdout), but the probe's
 * request shape is a correctness gate regardless: it used to send HEAD first,
 * and nvlpubs.nist.gov answers HEAD with 404 on every PDF it serves, so the whole
 * NIST DOI corpus read as dead. These pin the GET-with-range request, one call
 * per URL, and the class each outcome lands in.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SOFT_404_TITLE,
  mediaTypeOf,
  probe,
  reportLive,
  type LiveResult,
} from "../report.js";
import type { UrlRecord } from "../validate.js";

const rec = (url: string): UrlRecord => ({
  id: "test-id",
  source: "test",
  url,
});

/** A Response whose `url` reports where the redirect chain ended. */
function responseAt(
  status: number,
  url: string,
  body = "",
  contentType?: string,
): Response {
  const res = new Response(body, {
    status,
    headers: contentType ? { "content-type": contentType } : {},
  });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function stubFetch(
  impl: (input: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("probe", () => {
  it("sends one GET asking for the first byte, never a HEAD", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        responseAt(
          206,
          "https://nvlpubs.nist.gov/x.pdf",
          "",
          "application/pdf; charset=binary",
        ),
      ),
    );
    const out = await probe(rec("https://nvlpubs.nist.gov/x.pdf"));
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ range: "bytes=0-0" });
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
      /decoder-ring-link-check/,
    );
    expect(init.redirect).toBe("follow");
    expect(out).toMatchObject({
      status: 206,
      ok: true,
      linkClass: "reachable",
      error: null,
      contentType: "application/pdf",
    });
  });

  it("in content mode still asks for one byte, and fetches a body only for a host with a soft-404 signature", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        responseAt(
          200,
          "https://a.gov/p",
          "<html><title>Real page</title></html>",
        ),
      ),
    );
    const out = await probe(rec("https://a.gov/p"), true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({
      range: "bytes=0-0",
    });
    expect(out.linkClass).toBe("reachable");
  });

  it("retries once after a timeout and reports the outcome of the retry", async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error("The operation was aborted due to timeout"), {
            name: "TimeoutError",
          }),
        );
      }
      return Promise.resolve(responseAt(206, "https://slow.gov/p"));
    });
    const out = await probe(rec("https://slow.gov/p"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      status: 206,
      ok: true,
      linkClass: "reachable",
    });
  }, 10000);

  it("does not retry a certificate-chain failure", async () => {
    const fetchMock = stubFetch(() =>
      Promise.reject(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("bad chain"), {
            code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          }),
        }),
      ),
    );
    await probe(rec("https://www.cnss.gov/x"));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("records the final URL after redirects", async () => {
    stubFetch(() =>
      Promise.resolve(
        responseAt(200, "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final"),
      ),
    );
    const out = await probe(
      rec("https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final"),
    );
    expect(out.finalUrl).toBe(
      "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
    );
    expect(out.linkClass).toBe("reachable");
  });

  it.each([
    { status: 404, cls: "gone", ok: false },
    { status: 403, cls: "script-blocked", ok: false },
    { status: 202, cls: "script-blocked", ok: false },
    { status: 418, cls: "script-blocked", ok: false },
    { status: 503, cls: "unreachable", ok: false },
  ])("classifies HTTP $status as $cls", async ({ status, cls, ok }) => {
    stubFetch(() => Promise.resolve(responseAt(status, "https://a.gov/p")));
    const out = await probe(rec("https://a.gov/p"));
    expect(out).toMatchObject({ status, ok, linkClass: cls });
  });

  it("treats a 200 that landed on an access-request host as blocked", async () => {
    stubFetch(() =>
      Promise.resolve(responseAt(200, "https://unblock.federalregister.gov/")),
    );
    const out = await probe(
      rec("https://www.federalregister.gov/d/2020-18939"),
    );
    expect(out.linkClass).toBe("script-blocked");
    expect(out.ok).toBe(false);
    expect(out.finalUrl).toBe("https://unblock.federalregister.gov/");
  });

  it("classifies a certificate-chain failure and keeps the code in the error", async () => {
    stubFetch(() =>
      Promise.reject(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(
            new Error("unable to get local issuer certificate"),
            {
              code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            },
          ),
        }),
      ),
    );
    const out = await probe(
      rec("https://www.cnss.gov/CNSS/issuances/Policies.cfm"),
    );
    expect(out).toMatchObject({
      status: null,
      finalUrl: null,
      ok: false,
      linkClass: "tls-chain",
      error: "fetch failed [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]",
    });
  });

  it("classifies a repeated timeout as unreachable without a code", async () => {
    const fetchMock = stubFetch(() =>
      Promise.reject(
        Object.assign(new Error("The operation was aborted due to timeout"), {
          name: "TimeoutError",
        }),
      ),
    );
    const out = await probe(rec("https://slow.gov/p"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      ok: false,
      linkClass: "unreachable",
      error: "The operation was aborted due to timeout",
    });
  }, 10000);

  it("lists no soft-404 host until one has been measured", () => {
    // Every host the NIST corpus links to answers a missing page with a real 404.
    // A host enters this table from a measured soft-200, with the title it serves.
    expect(SOFT_404_TITLE).toEqual({});
  });

  it("flags a content-mode 200 whose title is the host's generic page as gone, fetching the body second", async () => {
    SOFT_404_TITLE["soft.example.gov"] = "Page not found";
    try {
      const fetchMock = stubFetch(() =>
        Promise.resolve(
          responseAt(
            200,
            "https://soft.example.gov/posts/missing",
            "<html><title>Page not found</title></html>",
          ),
        ),
      );
      const out = await probe(
        rec("https://soft.example.gov/posts/missing"),
        true,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![1]!.headers).not.toHaveProperty("range");
      expect(out.linkClass).toBe("gone");
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/soft-404/);
    } finally {
      delete SOFT_404_TITLE["soft.example.gov"];
    }
  });

  it("flags a content-mode redirect to the host root as gone", async () => {
    stubFetch(() =>
      Promise.resolve(responseAt(200, "https://a.gov/", "<html></html>")),
    );
    const out = await probe(rec("https://a.gov/deep/path"), true);
    expect(out.linkClass).toBe("gone");
    expect(out.error).toMatch(/homepage/);
  });
});

describe("reportLive", () => {
  function silence(): string[] {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  }
  const mk = (
    url: string,
    linkClass: LiveResult["linkClass"],
    status: number | null,
    error: string | null = null,
  ): LiveResult => ({
    record: rec(url),
    status,
    finalUrl: null,
    contentType: null,
    ok: linkClass === "reachable",
    linkClass,
    error,
  });

  it("counts only dead and unreachable links as failures", () => {
    const lines = silence();
    const out = reportLive([
      mk("https://a.gov/1", "reachable", 206),
      mk("https://b.gov/2", "script-blocked", 403),
      mk(
        "https://c.gov/3",
        "tls-chain",
        null,
        "fetch failed [CERT_HAS_EXPIRED]",
      ),
      mk("https://d.gov/4", "gone", 404),
      mk("https://e.gov/5", "unreachable", 503),
    ]);
    expect(out).toEqual({ failures: 2, manual: 2 });
    const text = lines.join("");
    expect(text).toContain(
      "by class: reachable 1, script-blocked 1, tls-chain 1, gone 1, unreachable 1",
    );
    expect(text).toContain("2 URL(s) need a manual check");
    expect(text).toContain("2 URL(s) not reachable");
  });

  it("passes when everything is reachable or merely needs a person", () => {
    const lines = silence();
    const out = reportLive([
      mk("https://a.gov/1", "reachable", 200),
      mk("https://b.gov/2", "script-blocked", 403),
    ]);
    expect(out).toEqual({ failures: 0, manual: 1 });
    expect(lines.join("")).toContain("PASS");
  });
});

describe("mediaTypeOf", () => {
  it("keeps the media type and drops parameters and case", () => {
    expect(mediaTypeOf("application/pdf; charset=binary")).toBe(
      "application/pdf",
    );
    expect(mediaTypeOf("Text/HTML;charset=utf-8")).toBe("text/html");
    expect(mediaTypeOf(null)).toBeNull();
    expect(mediaTypeOf("")).toBeNull();
  });
});
