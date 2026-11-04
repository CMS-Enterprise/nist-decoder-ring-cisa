/**
 * Unit tests for the FORMAT validators (the deterministic, side-effect-free
 * core of the link-checker). The db/seed-sql/api collectors and the live HTTP
 * prober are side-effectful and coverage-excluded; this file keeps validate.ts
 * fully covered.
 *
 * Table-driven, and pins the two real seed-data defects this gate must catch:
 *   - double-scheme: https://a.gov/https://b.gov/...
 *   - unencoded whitespace: https://a.gov/Audit and Accountability ...
 */

import { describe, it, expect } from "vitest";
import {
  validateFormat,
  validateAll,
  FORMAT_FAILURE_LABEL,
} from "../validate.js";
import type { FormatFailureCode, UrlRecord } from "../validate.js";

function rec(url: string): UrlRecord {
  return { id: "test-id", source: "test", url };
}

describe("validateFormat — well-formed URLs (pass)", () => {
  const valid: string[] = [
    "https://example.gov/monitoring-tools-best-practices/",
    "https://docs.example.gov/learn/zero-trust",
    "http://example.com",
    "https://example.com/path?query=1&two=2#frag",
    "https://example.com/percent%20encoded/space",
    "https://sub.domain.example.gov/a/b/c.pdf",
    "https://example.com:8443/with-port",
  ];

  it.each(valid)("accepts %s", (url) => {
    expect(validateFormat(rec(url))).toBeNull();
  });
});

describe("validateFormat — malformed URLs (fail)", () => {
  const cases: Array<{ name: string; url: string; code: FormatFailureCode }> = [
    {
      name: "double-scheme (real seed defect)",
      url: "https://example.gov/https://docs.example.gov/posts/what-the-transition-means-for-you",
      code: "double-scheme",
    },
    {
      name: "double-scheme http inside https",
      url: "https://host.gov/http://other.gov/x",
      code: "double-scheme",
    },
    {
      name: "unencoded whitespace (real seed defect)",
      url: "https://example.gov/Audit and Accountability (AU) | Example Security Program",
      code: "whitespace",
    },
    {
      name: "unencoded whitespace with colon/ampersand (RMH Chapter 4 seed defect)",
      url: "https://example.gov/Chapter 4: Security Assessment & Authorization | Example Security Program",
      code: "whitespace",
    },
    {
      name: "single leading space",
      url: " https://example.com",
      code: "whitespace",
    },
    {
      name: "tab inside path",
      url: "https://example.com/a\tb",
      code: "whitespace",
    },
    {
      name: "empty string",
      url: "",
      code: "empty",
    },
    {
      name: "whitespace-only",
      url: "   ",
      code: "empty",
    },
    {
      name: "relative / scheme-less",
      url: "example.gov/pcig/cig.html",
      code: "non-http-scheme",
    },
    {
      name: "mailto scheme",
      url: "mailto:security@example.gov",
      code: "non-http-scheme",
    },
    {
      name: "ftp scheme",
      url: "ftp://files.example.gov/doc.pdf",
      code: "non-http-scheme",
    },
    {
      name: "javascript scheme",
      url: "javascript:alert(1)",
      code: "non-http-scheme",
    },
    {
      name: "scheme with no host",
      url: "https://",
      code: "malformed",
    },
  ];

  it.each(cases)("flags $name as $code", ({ url, code }) => {
    const failure = validateFormat(rec(url));
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe(code);
  });

  it("attaches the originating record to the failure", () => {
    const record: UrlRecord = {
      id: "cms_au-06_01__02",
      source: "ReferenceLink.url",
      url: "https://example.gov/Audit and Accountability (AU)",
    };
    const failure = validateFormat(record);
    expect(failure?.record).toBe(record);
    expect(failure?.detail).toMatch(/whitespace/i);
  });
});

describe("validateFormat — carries no host rule", () => {
  // Which paths a site answers with 404 is a fact about that site. It is recorded
  // in its corpus's override table and redirect report, not in the format gate
  // every corpus shares, so a well-formed URL passes whatever its host or path.
  const wellFormedAnywhere: string[] = [
    "https://example.gov/some-bare-path",
    "https://example.gov/section/slug/",
    "https://docs.example.gov/",
    "https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final",
  ];
  it.each(wellFormedAnywhere)("accepts %s", (url) => {
    expect(validateFormat(rec(url))).toBeNull();
  });

  it("has no failure code or label that names a host", () => {
    const codes = Object.keys(FORMAT_FAILURE_LABEL).sort();
    expect(codes).toEqual([
      "double-scheme",
      "empty",
      "malformed",
      "non-http-scheme",
      "whitespace",
    ]);
    for (const label of Object.values(FORMAT_FAILURE_LABEL)) {
      expect(label).not.toMatch(/\.(gov|com|org)\b/);
    }
  });
});

describe("validateFormat — check ordering", () => {
  it("reports whitespace before double-scheme when both present", () => {
    // A URL that is both whitespace-bearing and double-scheme: whitespace wins
    // because it is the more actionable, human-fixable signal.
    const failure = validateFormat(
      rec("https://host.gov/A B https://other.gov/x"),
    );
    expect(failure?.code).toBe("whitespace");
  });

  it("treats a null url (cast) as empty without throwing", () => {
    const failure = validateFormat({
      id: "x",
      source: "y",
      url: null as unknown as string,
    });
    expect(failure?.code).toBe("empty");
  });
});

describe("validateAll", () => {
  it("returns only the failures, preserving order", () => {
    const records = [
      rec("https://good.example.gov/a"),
      rec("https://host.gov/https://nested.gov/x"), // double-scheme
      rec("https://good.example.gov/b"),
      rec("https://host.gov/has space"), // whitespace
    ];
    const failures = validateAll(records);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.code).toBe("double-scheme");
    expect(failures[1]?.code).toBe("whitespace");
  });

  it("returns an empty array when every URL is well-formed", () => {
    const records = [
      rec("https://a.example.gov"),
      rec("https://b.example.gov/x"),
    ];
    expect(validateAll(records)).toEqual([]);
  });

  it("handles an empty input list", () => {
    expect(validateAll([])).toEqual([]);
  });
});

describe("FORMAT_FAILURE_LABEL", () => {
  it("has a human-readable label for every failure code", () => {
    const codes: FormatFailureCode[] = [
      "empty",
      "double-scheme",
      "whitespace",
      "non-http-scheme",
      "malformed",
    ];
    for (const code of codes) {
      expect(FORMAT_FAILURE_LABEL[code]).toBeTruthy();
    }
  });
});
