import { describe, expect, it } from "vitest";

import { uniqueByUrl, urlKey } from "../link-identity";

describe("urlKey", () => {
  it("treats a trailing slash, host case and surrounding space as the same link", () => {
    const a = urlKey("https://Example.gov/guide/");
    expect(urlKey("https://example.gov/guide")).toBe(a);
    expect(urlKey("  https://EXAMPLE.GOV/guide  ")).toBe(a);
  });

  it("keeps paths, queries and fragments distinct", () => {
    expect(urlKey("https://example.gov/a")).not.toBe(
      urlKey("https://example.gov/b"),
    );
    expect(urlKey("https://example.gov/a?x=1")).not.toBe(
      urlKey("https://example.gov/a"),
    );
    expect(urlKey("https://example.gov/doc.pdf#page=5")).not.toBe(
      urlKey("https://example.gov/doc.pdf#page=6"),
    );
  });

  it("keeps links that differ only in their user part apart", () => {
    expect(urlKey("https://a@example.gov/ref")).not.toBe(
      urlKey("https://b@example.gov/ref"),
    );
  });

  it("compares a value that is not a URL by its trimmed text", () => {
    expect(urlKey("not a url/")).toBe(urlKey("not a url"));
  });
});

describe("uniqueByUrl", () => {
  it("keeps the first of each link, in order, including repeats within one list", () => {
    const links = [
      { url: "https://example.gov/a", label: "first" },
      { url: "https://example.gov/b", label: "b" },
      { url: "https://EXAMPLE.gov/a/", label: "repeat" },
    ];
    expect(uniqueByUrl(links).map((l) => l.label)).toEqual(["first", "b"]);
  });
});
