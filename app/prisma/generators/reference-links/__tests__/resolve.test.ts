/**
 * The resolution rule is the whole point of this pipeline: which URL the seed
 * carries for a resource, and why. Each branch is pinned here, along with the
 * gates that stop a thin or stale result from becoming a seed.
 */

import { describe, expect, it } from "vitest";
import {
  assertExpectations,
  ExpectationError,
} from "../../catalog/expectations.js";
import type { ControlReference, ReferenceResource } from "../lib/catalog.js";
import type { LiveResultRow } from "../lib/live-results.js";
import {
  checkedOnOf,
  parseOverrides,
  redirectReport,
  referenceExpectations,
  registryCsv,
  resolveReferences,
  seedRows,
  urlDefect,
  type OverrideRow,
} from "../lib/resolve.js";

function res(uuid: string, url: string, title = uuid): ReferenceResource {
  return { uuid, title, citation: null, url };
}
function lr(
  url: string,
  linkClass: string,
  extra: Partial<LiveResultRow> = {},
): LiveResultRow {
  return {
    url,
    status: 206,
    finalUrl: url,
    contentType: "application/pdf",
    linkClass,
    error: null,
    checkedOn: "2026-09-29",
    ...extra,
  };
}
const cite = (uuid: string, n = 1): ControlReference => ({
  controlNumber: "AC-01",
  resourceUuid: uuid,
  order: n,
});

describe("parseOverrides", () => {
  it("reads the override table", () => {
    expect(
      parseOverrides(
        "source_url,replacement_url,reason,verified_on\nhttps://a.gov,https://a.gov/new,moved,2026-09-29\n",
      ),
    ).toEqual([
      {
        sourceUrl: "https://a.gov",
        replacementUrl: "https://a.gov/new",
        reason: "moved",
        verifiedOn: "2026-09-29",
      },
    ]);
  });
});

describe("resolveReferences", () => {
  const U = "https://example.gov/doc";

  it("seeds a verified catalog URL as the catalog has it, carrying where it lands and what it is", () => {
    const [r] = resolveReferences(
      [res("u", U)],
      [cite("u")],
      [lr(U, "reachable")],
      [],
    );
    expect(r).toMatchObject({
      seededUrl: U,
      resolvedUrl: U,
      contentType: "application/pdf",
      resolution: "catalog",
      reason: "verified live on 2026-09-29",
      citingControls: ["AC-01"],
    });
  });

  it("seeds the final URL when the catalog URL redirects", () => {
    const [r] = resolveReferences(
      [res("u", U)],
      [],
      [lr(U, "reachable", { finalUrl: "https://example.gov/new" })],
      [],
    );
    expect(r).toMatchObject({
      seededUrl: "https://example.gov/new",
      resolvedUrl: "https://example.gov/new",
      resolution: "redirect",
    });
    expect(r!.reason).toMatch(/redirects/);
  });

  it("does not call a different spelling of the same address a redirect", () => {
    // A server answers https://example.gov with https://example.gov/: the URL
    // parser writes an empty path as "/", and nothing moved.
    const bare = "https://example.gov";
    const [r] = resolveReferences(
      [res("u", bare)],
      [],
      [lr(bare, "reachable", { finalUrl: "https://example.gov/" })],
      [],
    );
    expect(r).toMatchObject({ seededUrl: bare, resolution: "catalog" });
    expect(r!.reason).toBe("verified live on 2026-09-29");
    const [upper] = resolveReferences(
      [res("u", "https://Example.gov:443/doc")],
      [],
      [lr("https://Example.gov:443/doc", "reachable", { finalUrl: U })],
      [],
    );
    expect(upper!.resolution).toBe("catalog");
  });

  it("carries the authored fragment onto a redirect's target", () => {
    // A fragment names a place inside the document; the server never sees it,
    // so the redirect's target arrives without it and the place would be lost.
    const anchored = `${U}#page=14`;
    const [r] = resolveReferences(
      [res("u", anchored)],
      [],
      [lr(anchored, "reachable", { finalUrl: "https://example.gov/new" })],
      [],
    );
    expect(r).toMatchObject({
      seededUrl: "https://example.gov/new#page=14",
      resolvedUrl: "https://example.gov/new",
      resolution: "redirect",
    });
    // A target that carries its own fragment keeps it.
    const [own] = resolveReferences(
      [res("u", anchored)],
      [],
      [lr(anchored, "reachable", { finalUrl: "https://example.gov/new#top" })],
      [],
    );
    expect(own!.seededUrl).toBe("https://example.gov/new#top");
  });

  it("keeps a DOI as the stable name and records where it resolves", () => {
    const doi = "https://doi.org/10.6028/NIST.SP.800-53r5";
    const pdf =
      "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf";
    const [r] = resolveReferences(
      [res("u", doi)],
      [],
      [lr(doi, "reachable", { finalUrl: pdf })],
      [],
    );
    expect(r).toMatchObject({
      seededUrl: doi,
      resolvedUrl: pdf,
      resolution: "catalog",
    });
    expect(r!.reason).toMatch(/DOI/);
  });

  it("does not call a dropped fragment a redirect", () => {
    const withFragment =
      "https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_5_1_1/home";
    const [r] = resolveReferences(
      [res("u", withFragment)],
      [],
      [
        lr(withFragment, "reachable", {
          finalUrl: "https://csrc.nist.gov/projects/cprt/catalog",
        }),
      ],
      [],
    );
    expect(r).toMatchObject({ seededUrl: withFragment, resolution: "catalog" });
  });

  it("applies an override before anything else, taking the destination from the replacement's own live row", () => {
    const o: OverrideRow = {
      sourceUrl: U,
      replacementUrl: "https://example.gov/moved.pdf",
      reason: "host moved its PDFs",
      verifiedOn: "2026-09-29",
    };
    const rows = [
      lr(U, "gone", { status: 404, finalUrl: null, contentType: "text/html" }),
      lr("https://example.gov/moved.pdf", "reachable", {
        finalUrl: "https://cdn.example.gov/moved.pdf",
        contentType: "application/pdf",
      }),
    ];
    const [r] = resolveReferences([res("u", U)], [], rows, [o]);
    expect(r).toMatchObject({
      seededUrl: "https://example.gov/moved.pdf",
      resolvedUrl: "https://cdn.example.gov/moved.pdf",
      contentType: "application/pdf",
      resolution: "override",
      reason: "host moved its PDFs",
      override: o,
    });
  });

  it("does not take a media type from a page that did not answer with success", () => {
    const o: OverrideRow = {
      sourceUrl: U,
      replacementUrl: "https://example.gov/moved.pdf",
      reason: "moved",
      verifiedOn: "2026-09-29",
    };
    const [unprobed] = resolveReferences(
      [res("u", U)],
      [],
      [
        lr(U, "gone", {
          status: 404,
          finalUrl: null,
          contentType: "text/html",
        }),
      ],
      [o],
    );
    expect(unprobed).toMatchObject({
      resolvedUrl: "https://example.gov/moved.pdf",
      contentType: null,
    });
    const [blocked] = resolveReferences(
      [res("u", U)],
      [],
      [lr(U, "script-blocked", { status: 403, contentType: "text/html" })],
      [],
    );
    expect(blocked!.contentType).toBeNull();
  });

  it("seeds a blocked or certificate-chain URL as published and says a person must check", () => {
    // The page that answered is a sign-in page, not the document: it is no
    // destination, and its media type says nothing about the document.
    const [b] = resolveReferences(
      [res("u", U)],
      [],
      [
        lr(U, "script-blocked", {
          status: 403,
          finalUrl: "https://example.gov/accounts/login/?next=/doc.pdf",
          contentType: "text/html",
        }),
      ],
      [],
    );
    expect(b).toMatchObject({
      seededUrl: U,
      resolvedUrl: null,
      contentType: null,
      resolution: "catalog",
    });
    expect(b!.reason).toMatch(
      /needs a manual check.*scripted clients.*HTTP 403/,
    );
    const [t] = resolveReferences(
      [res("u", U)],
      [],
      [
        lr(U, "tls-chain", {
          status: null,
          finalUrl: null,
          contentType: null,
          error: "fetch failed [UNABLE_TO_GET_ISSUER_CERT_LOCALLY]",
        }),
      ],
      [],
    );
    expect(t).toMatchObject({
      seededUrl: U,
      resolvedUrl: null,
      resolution: "catalog",
    });
    expect(t!.reason).toMatch(
      /certificate chain.*UNABLE_TO_GET_ISSUER_CERT_LOCALLY/,
    );
  });

  it("holds out a gone or unreachable URL with no replacement", () => {
    const [g] = resolveReferences(
      [res("u", U)],
      [],
      [lr(U, "gone", { status: 404 })],
      [],
    );
    expect(g).toMatchObject({ seededUrl: null, resolution: "not-seeded" });
    expect(g!.reason).toMatch(/gone \(HTTP 404\)/);
    const [x] = resolveReferences(
      [res("u", U)],
      [],
      [lr(U, "unreachable", { status: 503 })],
      [],
    );
    expect(x).toMatchObject({ seededUrl: null, resolution: "not-seeded" });
    expect(x!.reason).toMatch(/unreachable on 2026-09-29/);
  });

  it("holds out a URL with no live result and says what to run", () => {
    const [r] = resolveReferences([res("u", U)], [], [], []);
    expect(r).toMatchObject({
      seededUrl: null,
      resolution: "not-seeded",
      live: null,
    });
    expect(r!.reason).toMatch(/run the retrieval/);
  });
});

describe("seedRows", () => {
  it("emits one row per citation of a seeded resource, in citation order, with what the link leads to", () => {
    const resources = [
      res("a", "https://a.gov", "A"),
      { ...res("b", "https://b.gov", "B"), citation: "B, 2020." },
      res("c", "https://c.gov", "C"),
    ];
    const refs: ControlReference[] = [
      { controlNumber: "AC-01", resourceUuid: "a", order: 1 },
      { controlNumber: "AC-01", resourceUuid: "c", order: 2 },
      { controlNumber: "AC-02", resourceUuid: "b", order: 1 },
    ];
    const resolved = resolveReferences(
      resources,
      refs,
      [
        lr("https://a.gov", "reachable"),
        lr("https://b.gov", "reachable", {
          finalUrl: "https://b.gov/new",
          contentType: "text/html",
        }),
        lr("https://c.gov", "gone", { status: 404 }),
      ],
      [],
    );
    expect(seedRows(resolved, refs)).toEqual([
      {
        controlNumber: "AC-01",
        resourceUuid: "a",
        title: "A",
        url: "https://a.gov",
        description: null,
        resolvedUrl: "https://a.gov",
        contentType: "application/pdf",
        displayOrder: 1,
      },
      {
        controlNumber: "AC-02",
        resourceUuid: "b",
        title: "B",
        url: "https://b.gov/new",
        description: "B, 2020.",
        resolvedUrl: "https://b.gov/new",
        contentType: "text/html",
        displayOrder: 1,
      },
    ]);
  });
});

describe("urlDefect", () => {
  it.each([
    ["https://a.gov/x", null],
    ["", "empty"],
    ["https://a.gov/a b", "whitespace"],
    ["https://a.gov/it's", "single quote"],
    ["https://a.gov/https://b.gov", "double scheme"],
    ["ftp://a.gov", "not http(s)"],
    ["https://", "malformed"],
  ])("%s → %s", (url, defect) => {
    expect(urlDefect(url)).toBe(defect);
  });
});

describe("referenceExpectations", () => {
  function healthy() {
    const resources = Array.from({ length: 200 }, (_, i) =>
      res(`u${i}`, `https://a.gov/${i}`),
    );
    const references = Array.from({ length: 800 }, (_, i) => ({
      controlNumber: `AC-${String(i % 50).padStart(2, "0")}`,
      resourceUuid: `u${i % 200}`,
      order: 1,
    }));
    const liveRows = resources.map((r) => lr(r.url, "reachable"));
    const resolved = resolveReferences(resources, references, liveRows, []);
    const rows = seedRows(resolved, references);
    return {
      resources,
      withoutLink: [] as string[],
      references,
      unresolved: [] as { controlNumber: string; href: string }[],
      unlabeled: [] as string[],
      resolved,
      overrides: [] as OverrideRow[],
      liveRows,
      rows,
    };
  }

  it("passes on a healthy run at the pin's scale", () => {
    expect(() =>
      assertExpectations("t", referenceExpectations(healthy())),
    ).not.toThrow();
  });

  it("fails when a catalog URL has no live result, and says which", () => {
    const h = healthy();
    const resolved = resolveReferences(
      h.resources,
      h.references,
      h.resolved.slice(1).map((r) => r.live!),
      [],
    );
    const gates = referenceExpectations({
      ...h,
      resolved,
      rows: seedRows(resolved, h.references),
    });
    let caught: unknown;
    try {
      assertExpectations("t", gates);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExpectationError);
    expect((caught as ExpectationError).message).toMatch(
      /catalog URLs without a live result/,
    );
    expect((caught as ExpectationError).message).toMatch(/https:\/\/a\.gov\/0/);
  });

  it("fails on a stale override, an unlabeled control, a format defect and an unknown reference target", () => {
    const h = healthy();
    const stale: OverrideRow = {
      sourceUrl: "https://nowhere.gov",
      replacementUrl: "https://x.gov",
      reason: "r",
      verifiedOn: "d",
    };
    const gates = referenceExpectations({
      ...h,
      overrides: [stale],
      unlabeled: ["ac-99"],
      unresolved: [{ controlNumber: "AC-01", href: "#nope" }],
      rows: [
        ...h.rows,
        {
          controlNumber: "AC-01",
          resourceUuid: "u0",
          title: "t",
          url: "https://a.gov/bad path",
          description: null,
          resolvedUrl: null,
          contentType: null,
          displayOrder: 9,
        },
      ],
    });
    const failing = gates
      .filter(
        (g) =>
          (g.ceiling !== undefined && g.actual > g.ceiling) ||
          g.actual < g.floor,
      )
      .map((g) => g.name);
    expect(failing).toEqual(
      expect.arrayContaining([
        "overrides whose source is not a catalog URL",
        "citing controls without a label",
        "reference links to an unknown resource",
        "seeded URLs with a format defect",
      ]),
    );
    expect(() => assertExpectations("t", gates)).toThrow(ExpectationError);
  });

  it("fails when an override's replacement was never probed, and says to run the retrieval", () => {
    // An override added by hand and built without a retrieval would seed an
    // unchecked address under a date that claims every link was verified.
    const h = healthy();
    const o: OverrideRow = {
      sourceUrl: "https://a.gov/0",
      replacementUrl: "https://a.gov/moved",
      reason: "r",
      verifiedOn: "d",
    };
    const gates = referenceExpectations({ ...h, overrides: [o] });
    const unprobed = gates.find(
      (g) => g.name === "override replacements without a live result",
    )!;
    expect(unprobed.actual).toBe(1);
    expect(unprobed.because).toMatch(
      /run the retrieval.*https:\/\/a\.gov\/moved/,
    );
    expect(() => assertExpectations("t", gates)).toThrow(ExpectationError);
    // With the replacement probed, the gate passes.
    const probed = referenceExpectations({
      ...h,
      overrides: [o],
      liveRows: [...h.liveRows, lr("https://a.gov/moved", "reachable")],
    });
    expect(
      probed.find(
        (g) => g.name === "override replacements without a live result",
      )!.actual,
    ).toBe(0);
  });

  it("fails when an override's replacement has itself died", () => {
    const h = healthy();
    const o: OverrideRow = {
      sourceUrl: "https://a.gov/0",
      replacementUrl: "https://a.gov/moved",
      reason: "r",
      verifiedOn: "d",
    };
    const gates = referenceExpectations({
      ...h,
      overrides: [o],
      liveRows: [
        ...h.liveRows,
        lr("https://a.gov/moved", "gone", { status: 404 }),
      ],
    });
    const dead = gates.find(
      (g) => g.name === "override replacements that are gone or unreachable",
    )!;
    expect(dead.actual).toBe(1);
    expect(dead.because).toContain("https://a.gov/moved");
    expect(() => assertExpectations("t", gates)).toThrow(ExpectationError);
  });

  it("tolerates a few held-out resources but not many", () => {
    const held = referenceExpectations(healthy()).find(
      (g) => g.name === "resources not seeded",
    )!;
    expect(held.ceiling).toBe(10);
    expect(held.because).toMatch(/override table/);
  });
});

describe("registryCsv, redirectReport and checkedOnOf", () => {
  const resources = [
    {
      ...res("a", "https://gone.gov/old.pdf", "OMB A-130"),
      citation: "Circular A-130, 2016.",
    },
    res("b", "https://moved.gov/old", "Moved"),
    res("c", "https://dead.gov/x", "Dead"),
    res("d", "https://blocked.gov/x", "Blocked"),
    res("e", "https://fine.gov/x", "Fine"),
  ];
  const refs: ControlReference[] = [
    cite("a"),
    cite("b", 2),
    { controlNumber: "AC-02", resourceUuid: "a", order: 1 },
  ];
  const liveRows = [
    lr("https://gone.gov/old.pdf", "gone", {
      status: 404,
      finalUrl: null,
      contentType: null,
    }),
    lr("https://moved.gov/old", "reachable", {
      finalUrl: "https://moved.gov/new",
      contentType: "text/html",
    }),
    lr("https://dead.gov/x", "gone", {
      status: 404,
      finalUrl: null,
      contentType: null,
    }),
    lr("https://blocked.gov/x", "script-blocked", {
      status: 403,
      contentType: null,
    }),
    lr("https://fine.gov/x", "reachable"),
  ];
  const overrides: OverrideRow[] = [
    {
      sourceUrl: "https://gone.gov/old.pdf",
      replacementUrl: "https://gone.gov/new.pdf",
      reason: "host moved its PDFs",
      verifiedOn: "2026-09-29",
    },
  ];
  const resolved = resolveReferences(resources, refs, liveRows, overrides);

  it("writes one registry row per resource with the provenance columns", () => {
    const lines = registryCsv(resolved).trimEnd().split("\n");
    expect(lines[0]).toBe(
      "resource_uuid,title,citation,catalog_url,seeded_url,resolved_url,content_type,resolution,reason,live_status,live_class,checked_on,override_verified_on,citing_controls_count,citing_controls",
    );
    expect(lines).toHaveLength(6);
    expect(lines.find((l) => l.includes("OMB A-130"))).toContain(
      "https://gone.gov/old.pdf,https://gone.gov/new.pdf,https://gone.gov/new.pdf,,override,host moved its PDFs,404,gone,2026-09-29,2026-09-29,2,AC-01 AC-02",
    );
  });

  it("writes the registry under a corpus-specific header when given one", () => {
    const header = [
      "resource_id",
      "title",
      "citation",
      "source_url",
      "seeded_url",
      "resolved_url",
      "content_type",
      "resolution",
      "reason",
      "live_status",
      "live_class",
      "checked_on",
      "override_verified_on",
      "citing_controls_count",
      "citing_controls",
    ];
    const lines = registryCsv(resolved, header).trimEnd().split("\n");
    expect(lines[0]).toBe(header.join(","));
    expect(lines.slice(1)).toEqual(
      registryCsv(resolved).trimEnd().split("\n").slice(1),
    );
  });

  it("names the basis it was measured against", () => {
    const md = redirectReport(resolved, {
      title: "the authored references",
      basis: "the sources table",
    });
    expect(md).toContain(
      "# Reference URLs in the authored references that no longer resolve",
    );
    expect(md).toContain(
      "Measured against the sources table, with every published URL requested on 2026-09-29",
    );
  });

  it("dates the resolution from the live results", () => {
    expect(checkedOnOf(resolved)).toBe("2026-09-29");
    expect(checkedOnOf([])).toBe("unknown");
  });

  it("sorts every resource into the section the publisher needs", () => {
    const md = redirectReport(resolved, {
      title: "NIST SP 800-53 5.2.0",
      basis: "the OSCAL catalog at pin 78650f02",
    });
    expect(md).toContain(
      "# Reference URLs in NIST SP 800-53 5.2.0 that no longer resolve",
    );
    expect(md).toMatch(
      /5 resources carry a URL; 1 are gone at the published URL and have a verified replacement, 1 redirect to a new location, 1 are gone with no replacement known, and 1 could not be verified/,
    );
    const section = (title: string) =>
      md.split(`## ${title}`)[1]!.split("\n## ")[0]!;
    expect(
      section("Published URL is gone; a replacement is verified"),
    ).toContain(
      "**OMB A-130** (cited by 2 controls). Published: https://gone.gov/old.pdf. Replacement: https://gone.gov/new.pdf.",
    );
    expect(section("Published URL redirects to a new location")).toContain(
      "**Moved** (cited by AC-01). Published: https://moved.gov/old. Current: https://moved.gov/new.",
    );
    expect(section("Published URL is gone; no replacement known")).toContain(
      "**Dead** (cited by no live control)",
    );
    expect(section("Could not be verified by a script")).toContain(
      "**Blocked**",
    );
    expect(section("Could not be verified by a script")).not.toContain("Fine");
  });
});
