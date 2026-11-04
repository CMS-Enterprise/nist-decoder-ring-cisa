/**
 * The walk behind the server-side catalog boundary.
 *
 * Every string here is built from the shared term list at test time. A literal
 * would trip the source gate, and a literal is also a second list: if the term
 * list changes, a test that spelled the term out would keep proving the old one.
 */

import { describe, expect, it } from "vitest";
import { CATALOG_MARKERS } from "~/config/catalog-vocabulary";
import { findCatalogVocabulary, servesOwnIdentity } from "../catalog-boundary";

const host = CATALOG_MARKERS.find((m) => m.includes("."))!;
const word = CATALOG_MARKERS.find((m) => /^[A-Za-z]+$/.test(m))!;

describe("findCatalogVocabulary", () => {
  it("returns null for a payload with no catalog vocabulary", () => {
    expect(
      findCatalogVocabulary({
        version: "NIST SP 800-53 Rev 5",
        families: [{ id: "AC", controls: [{ name: "Policy", parts: [] }] }],
        checked: new Date("2026-09-30T00:00:00Z"),
        count: 3,
        flag: true,
        nothing: null,
      }),
    ).toBeNull();
  });

  it("finds every term on the list, wherever it sits", () => {
    for (const term of CATALOG_MARKERS) {
      const hit = findCatalogVocabulary({ a: [{ b: `see ${term} here` }] });
      expect(hit?.path).toBe("a[0].b");
      expect(hit?.excerpt).toContain(term);
    }
  });

  it("names the path of the first hit in key order, arrays by index", () => {
    const hit = findCatalogVocabulary({
      version: "clean",
      families: [
        { id: "AC", controls: [{ name: "clean" }, { name: `${word} policy` }] },
      ],
    });
    expect(hit?.path).toBe("families[0].controls[1].name");
  });

  it("shortens a long string around the match", () => {
    const long = `${"x".repeat(200)} https://${host}/policy ${"y".repeat(200)}`;
    const hit = findCatalogVocabulary({ url: long });
    expect(hit?.excerpt.length).toBeLessThan(80);
    expect(hit?.excerpt).toMatch(/^…/);
    expect(hit?.excerpt).toMatch(/…$/);
    expect(hit?.excerpt).toContain(host);
  });

  it("reads a URL's host as text", () => {
    expect(
      findCatalogVocabulary({ nistLinks: [{ url: `https://${host}/x` }] })
        ?.path,
    ).toBe("nistLinks[0].url");
  });

  it("does not read a Date", () => {
    // A Date is an object with no own enumerable keys; the walk must not descend
    // into it or stringify it.
    expect(findCatalogVocabulary({ at: new Date() })).toBeNull();
  });

  it("checks the Zero Trust guidance at every depth it is served", () => {
    // The guidance had an exemption while its seed still carried the vocabulary.
    // Each payload shape it used to let through is now refused at its own path.
    const text = `Configure ${word} tooling.`;
    for (const [payload, path] of [
      [{ ztMapping: { guidance: text } }, "ztMapping.guidance"],
      [
        { ztMapping: { affinities: [{ guidance: text }] } },
        "ztMapping.affinities[0].guidance",
      ],
      [
        { enhancements: [{ ztMapping: { guidance: text } }] },
        "enhancements[0].ztMapping.guidance",
      ],
      [
        { families: [{ controls: [{ ztMapping: { guidance: text } }] }] },
        "families[0].controls[0].ztMapping.guidance",
      ],
      [{ ztMapping: { ztmmGuidance: text } }, "ztMapping.ztmmGuidance"],
    ] as const) {
      expect(findCatalogVocabulary(payload)?.path).toBe(path);
    }
  });

  describe("the signed-in person's own details", () => {
    it("are exempt for auth.me only, by full procedure path", () => {
      expect(servesOwnIdentity("auth.me")).toBe(true);
      for (const path of ["me", "auth", "auth.me.x", "decoder.getBridgeData"]) {
        expect(servesOwnIdentity(path)).toBe(false);
      }
    });
  });
});
