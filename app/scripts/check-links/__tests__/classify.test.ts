/**
 * The classifier decides what a person does with a live result, so each class
 * boundary is pinned here: a dead link and a blocked client must never collapse
 * into the same bucket again.
 */

import { describe, expect, it } from "vitest";
import {
  classifyError,
  classifyResponse,
  hostOf,
  isLiveFailure,
  isTransient,
  needsManualCheck,
  stripFragment,
} from "../classify.js";

describe("classifyResponse", () => {
  it.each([
    { status: 200, cls: "reachable" },
    { status: 206, cls: "reachable" },
    { status: 304, cls: "reachable" },
    { status: 401, cls: "script-blocked" },
    { status: 403, cls: "script-blocked" },
    { status: 429, cls: "script-blocked" },
    { status: 202, cls: "script-blocked" },
    { status: 418, cls: "script-blocked" },
    { status: 404, cls: "gone" },
    { status: 410, cls: "gone" },
    { status: 500, cls: "unreachable" },
    { status: 503, cls: "unreachable" },
    { status: 400, cls: "unreachable" },
  ])("$status → $cls", ({ status, cls }) => {
    expect(classifyResponse(status, "https://example.gov/x")).toBe(cls);
  });

  it("treats a 200 that landed on a known access-request host as blocked", () => {
    expect(classifyResponse(200, "https://unblock.federalregister.gov/")).toBe(
      "script-blocked",
    );
  });

  it("copes with no final URL", () => {
    expect(classifyResponse(200, null)).toBe("reachable");
  });

  it("treats a 404 from a host that fingerprints the client as blocked, not gone", () => {
    expect(
      classifyResponse(404, "https://www.nsa.gov/resources/everyone/csfc"),
    ).toBe("script-blocked");
    expect(
      classifyResponse(
        404,
        null,
        "https://www.dni.gov/index.php/cyber-threat-framework",
      ),
    ).toBe("script-blocked");
    expect(classifyResponse(404, "https://www.whitehouse.gov/x")).toBe("gone");
    // Only a 404 is reinterpreted; a 410 or a 5xx from such a host keeps its meaning.
    expect(classifyResponse(410, "https://www.nsa.gov/x")).toBe("gone");
    expect(classifyResponse(503, "https://www.nsa.gov/x")).toBe("unreachable");
  });
});

describe("classifyError", () => {
  it("finds a TLS code on the cause chain and names it", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(
        new Error("unable to get local issuer certificate"),
        {
          code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        },
      ),
    });
    expect(classifyError(err)).toEqual({
      linkClass: "tls-chain",
      code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    });
  });

  it.each([
    "CERT_HAS_EXPIRED",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ])("%s is a certificate-chain failure", (code) => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("tls"), { code }),
    });
    expect(classifyError(err).linkClass).toBe("tls-chain");
  });

  it("classifies DNS, timeout and refused connections as unreachable", () => {
    const dns = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      }),
    });
    expect(classifyError(dns)).toEqual({
      linkClass: "unreachable",
      code: "ENOTFOUND",
    });
    const timeout = Object.assign(
      new Error("The operation was aborted due to timeout"),
      {
        name: "TimeoutError",
      },
    );
    expect(classifyError(timeout)).toEqual({
      linkClass: "unreachable",
      code: null,
    });
    expect(classifyError("string error")).toEqual({
      linkClass: "unreachable",
      code: null,
    });
  });

  it("stops walking a cause chain after a few hops", () => {
    // A self-referential cause must not loop forever.
    const err: { cause?: unknown } = new Error("loop");
    err.cause = err;
    expect(classifyError(err).linkClass).toBe("unreachable");
  });
});

describe("isTransient", () => {
  it("retries timeouts and dropped sockets, not certificate or DNS failures", () => {
    expect(
      isTransient(
        Object.assign(new Error("t"), { name: "TimeoutError" }),
        null,
      ),
    ).toBe(true);
    expect(isTransient(new Error("x"), "UND_ERR_SOCKET")).toBe(true);
    expect(isTransient(new Error("x"), "ECONNRESET")).toBe(true);
    expect(
      isTransient(new Error("x"), "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
    ).toBe(false);
    expect(isTransient(new Error("x"), "ENOTFOUND")).toBe(false);
    expect(isTransient("not an error", null)).toBe(false);
  });
});

describe("class predicates", () => {
  it("only blocked clients and certificate chains need a person", () => {
    expect(needsManualCheck("script-blocked")).toBe(true);
    expect(needsManualCheck("tls-chain")).toBe(true);
    expect(needsManualCheck("reachable")).toBe(false);
    expect(needsManualCheck("gone")).toBe(false);
    expect(needsManualCheck("unreachable")).toBe(false);
  });

  it("only dead and unreachable links are failures", () => {
    expect(isLiveFailure("gone")).toBe(true);
    expect(isLiveFailure("unreachable")).toBe(true);
    expect(isLiveFailure("reachable")).toBe(false);
    expect(isLiveFailure("script-blocked")).toBe(false);
    expect(isLiveFailure("tls-chain")).toBe(false);
  });
});

describe("url helpers", () => {
  it("strips a fragment and nothing else", () => {
    expect(stripFragment("https://a.gov/p#/x/y")).toBe("https://a.gov/p");
    expect(stripFragment("https://a.gov/p?q=1")).toBe("https://a.gov/p?q=1");
  });

  it("lower-cases the host and returns null for junk", () => {
    expect(hostOf("https://WWW.Example.GOV/x")).toBe("www.example.gov");
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});
