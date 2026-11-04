import { describe, it, expect } from "vitest";

import {
  normalizeControlId,
  passesFacets,
  matchesText,
  matchesQuery,
  isQueryActive,
  FAMILY_CODES,
  type FilterableControl,
  type FilterQuery,
} from "../filterPredicate";

const EMPTY: FilterQuery = {
  pillar: [],
  maturity: [],
  designation: [],
  baseline: [],
  family: [],
  status: [],
  q: "",
};

function control(
  overrides: Partial<FilterableControl> = {},
): FilterableControl {
  return {
    id: "AC-02",
    name: "Account Management",
    status: "zero-trust-aligned",
    family: "AC",
    pillars: ["IDENTITY"],
    maturities: ["ADVANCED"],
    ...overrides,
  };
}

describe("normalizeControlId", () => {
  it("canonicalizes the common number variants to one key", () => {
    expect(normalizeControlId("AC-02")).toBe("ac2");
    expect(normalizeControlId("AC-2")).toBe("ac2");
    expect(normalizeControlId("ac2")).toBe("ac2");
  });

  it("unifies the enhancement forms (01) and .1", () => {
    expect(normalizeControlId("AC-02(01)")).toBe("ac2.1");
    expect(normalizeControlId("ac-2.1")).toBe("ac2.1");
  });

  it("drops a trailing sub-control letter (letters are a server concern)", () => {
    expect(normalizeControlId("AU-05a")).toBe("au5");
  });

  it("returns lowercased/trimmed text unchanged for non-identifier input", () => {
    expect(normalizeControlId("  Least Privilege ")).toBe("least privilege");
  });
});

describe("passesFacets", () => {
  it("passes everything when no facet is active", () => {
    expect(passesFacets(control(), EMPTY)).toBe(true);
  });

  it("OR within a dimension — matches any selected pillar", () => {
    const q: FilterQuery = { ...EMPTY, pillar: ["IDENTITY", "DATA"] };
    expect(passesFacets(control({ pillars: ["DATA"] }), q)).toBe(true);
    expect(passesFacets(control({ pillars: ["DEVICES"] }), q)).toBe(false);
  });

  it("AND across dimensions — pillar AND maturity must both pass", () => {
    const q: FilterQuery = {
      ...EMPTY,
      pillar: ["IDENTITY"],
      maturity: ["ADVANCED"],
    };
    expect(
      passesFacets(
        control({ pillars: ["IDENTITY"], maturities: ["ADVANCED"] }),
        q,
      ),
    ).toBe(true);
    expect(
      passesFacets(
        control({ pillars: ["IDENTITY"], maturities: ["TRADITIONAL"] }),
        q,
      ),
    ).toBe(false);
  });

  it("matches a multi-pillar control on any one of its pillars", () => {
    expect(
      passesFacets(control({ pillars: ["IDENTITY", "DATA"] }), {
        ...EMPTY,
        pillar: ["DATA"],
      }),
    ).toBe(true);
  });

  it("matches the family facet against the control's family code", () => {
    expect(
      passesFacets(control({ family: "AC" }), {
        ...EMPTY,
        family: ["AC", "AU"],
      }),
    ).toBe(true);
    expect(
      passesFacets(control({ family: "SC" }), { ...EMPTY, family: ["AC"] }),
    ).toBe(false);
  });

  it("distinguishes the three ZT statuses (incl. via-enhancements)", () => {
    expect(
      passesFacets(control({ status: "zt-via-enhancements" }), {
        ...EMPTY,
        status: ["zt-via-enhancements"],
      }),
    ).toBe(true);
    expect(
      passesFacets(control({ status: "compliance" }), {
        ...EMPTY,
        status: ["zero-trust-aligned"],
      }),
    ).toBe(false);
  });

  it("hides a compliance-only control under an active pillar facet, shows it under its status", () => {
    const compliance = control({
      status: "compliance",
      pillars: [],
      maturities: [],
    });
    expect(passesFacets(compliance, { ...EMPTY, pillar: ["IDENTITY"] })).toBe(
      false,
    );
    expect(passesFacets(compliance, { ...EMPTY, status: ["compliance"] })).toBe(
      true,
    );
  });
});

describe("matchesText", () => {
  it("matches everything for an empty or whitespace-only query", () => {
    expect(matchesText(control(), "")).toBe(true);
    expect(matchesText(control(), "   ")).toBe(true);
  });

  it("matches by control number across the typed variants", () => {
    expect(matchesText(control({ id: "AC-02" }), "ac-2")).toBe(true);
    expect(matchesText(control({ id: "AC-02" }), "AC2")).toBe(true);
  });

  it("matches by name substring, case-insensitive", () => {
    expect(matchesText(control({ name: "Account Management" }), "manage")).toBe(
      true,
    );
  });

  it("does not match unrelated text", () => {
    expect(
      matchesText(
        control({ id: "AC-02", name: "Account Management" }),
        "encryption",
      ),
    ).toBe(false);
  });

  it("an identifier query matches by control-number prefix, not name substring", () => {
    // "AC" / "ac" — the Access Control family — match AC-* by number.
    expect(matchesText(control({ id: "AC-02" }), "AC")).toBe(true);
    expect(matchesText(control({ id: "AC-17" }), "ac")).toBe(true);
    // A different family whose NAME merely contains the letters "ac" must NOT match —
    // the SC-21 "…Caching Resolver" / SA-04 "Acquisition" bug the prefix split fixes.
    expect(
      matchesText(
        control({
          id: "SC-21",
          name: "Secure Name Resolution (Caching Resolver)",
          family: "SC",
        }),
        "AC",
      ),
    ).toBe(false);
    expect(
      matchesText(
        control({ id: "SA-04", name: "Acquisition Process", family: "SA" }),
        "AC",
      ),
    ).toBe(false);
  });

  it("a full word is free text and matches the name substring", () => {
    expect(
      matchesText(control({ name: "Secure Caching Resolver" }), "caching"),
    ).toBe(true);
    // Each family code still matches its own family by number.
    expect(matchesText(control({ id: "SC-21", family: "SC" }), "SC")).toBe(
      true,
    );
  });

  it("a two-letter NON-family word is free text, not an identifier query", () => {
    // A real family code routes to the control-number path.
    expect(matchesText(control({ id: "IR-04", family: "IR" }), "ir")).toBe(
      true,
    );
    expect(matchesText(control({ id: "AC-02", family: "AC" }), "ir")).toBe(
      false,
    );
    // "in"/"io" are not family codes → free text (name substring). They must NOT route to
    // the number path and blank the whole diagram.
    expect(
      matchesText(control({ name: "Information Flow Enforcement" }), "in"),
    ).toBe(true);
    expect(
      matchesText(control({ id: "AC-02", name: "Account Management" }), "io"),
    ).toBe(false);
  });
});

describe("matchesQuery — composition of facets and text", () => {
  it("search narrows within an active filter (and vice-versa)", () => {
    const q: FilterQuery = { ...EMPTY, pillar: ["IDENTITY"], q: "account" };
    // right pillar + matching name → shown
    expect(
      matchesQuery(
        control({ pillars: ["IDENTITY"], name: "Account Management" }),
        q,
      ),
    ).toBe(true);
    // right pillar, name does not match the text → excluded
    expect(
      matchesQuery(
        control({ pillars: ["IDENTITY"], name: "Audit Records" }),
        q,
      ),
    ).toBe(false);
    // matches the text but wrong pillar → excluded
    expect(
      matchesQuery(
        control({ pillars: ["DATA"], name: "Account Management" }),
        q,
      ),
    ).toBe(false);
  });
});

describe("matchesText with server matches", () => {
  // The server searches statement prose, discussion and ZT-guidance text, none of which
  // the diagram's dataset carries. Its verdict arrives as a set of control numbers.

  it("matches on a term that appears nowhere in the number or name", () => {
    // The reported case: "phishing" lives only in ZT guidance, so the client rules
    // alone find nothing and the diagram looked broken while the dropdown listed hits.
    const c = control({
      id: "IA-02",
      name: "Identification and Authentication",
    });
    expect(matchesText(c, "phishing")).toBe(false);
    expect(matchesText(c, "phishing", new Set(["IA-02"]))).toBe(true);
  });

  it("still applies the identifier rules the server does not implement", () => {
    // The server compares control numbers as raw substrings, so "AC-2" never reaches
    // AC-02 through it. The prefix rule is what makes that work.
    const c = control({ id: "AC-02" });
    expect(matchesText(c, "AC-2", new Set(["ZZ-99"]))).toBe(true);
    expect(matchesText(c, "ac02", new Set())).toBe(true);
  });

  it("never withdraws a free-text match the client had already made", () => {
    // The set arrives a beat after the keystroke. A control matching on name must not
    // disappear from the diagram just because the server's answer omits it.
    const c = control({ name: "Account Management" });
    expect(matchesText(c, "account", new Set())).toBe(true);
  });

  // Every two-letter family code is also an ordinary substring of catalog prose — "ac" is
  // inside "access" and "each", "si" inside "consistent", "ca" inside "critical" — so each
  // one reproduces this independently. Measured on the seeded catalog, "AC" alone returns
  // 286 of 300 base controls from the server. A family code must therefore stay on the
  // prefix rule, or the diagram stops narrowing and reports an inflated count.
  //
  // Driven off the exported FAMILY_CODES rather than a copied list, so a family added to
  // the predicate is covered here the same day rather than whenever someone remembers.
  // Each code is paired with the next one cyclically to supply a foreign control: the
  // codes are distinct and all two characters, so no code is ever a prefix of another.
  const CODES = [...FAMILY_CODES].sort();
  const foreignFor = (code: string) =>
    CODES[(CODES.indexOf(code) + 1) % CODES.length]!;

  it("covers every family the predicate recognises", () => {
    // Guards the tables below: if this drops to a partial list, the coverage claim in
    // their names stops being true and nothing else would say so.
    expect(CODES).toHaveLength(20);
  });

  it.for(CODES.map((code) => ({ code, foreign: foreignFor(code) })))(
    "bare code $code matches its own family and ignores a server match on $foreign",
    ({ code, foreign }) => {
      const own = control({ id: `${code}-02`, name: "Some Control" });
      const other = control({ id: `${foreign}-02`, name: "Another Control" });
      // The server returned BOTH. Only the prefix rule may decide an identifier query.
      const served = new Set([`${code}-02`, `${foreign}-02`]);
      expect(matchesText(own, code, served)).toBe(true);
      expect(matchesText(other, code, served)).toBe(false);
      // And the verdict does not depend on the server having answered at all.
      expect(matchesText(other, code, undefined)).toBe(false);
    },
  );

  it.for(CODES.map((code) => ({ code, foreign: foreignFor(code) })))(
    "number query $code-2 resolves within $code and not into $foreign",
    ({ code, foreign }) => {
      const served = new Set([`${code}-02`, `${foreign}-02`]);
      expect(
        matchesText(control({ id: `${code}-02` }), `${code}-2`, served),
      ).toBe(true);
      expect(
        matchesText(control({ id: `${foreign}-02` }), `${code}-2`, served),
      ).toBe(false);
    },
  );

  it.for(
    CODES.flatMap((code) =>
      [`${code}-02`, `${code}-2`, `${code}02`, `${code.toLowerCase()}-2`].map(
        (query) => ({ code, query }),
      ),
    ),
  )("$query reaches $code-02 whatever the server says", ({ code, query }) => {
    // Case and zero-padding variants must all land on the same control, and a server set
    // that omits it must not change that — the identifier path never consults the set.
    expect(matchesText(control({ id: `${code}-02` }), query, new Set())).toBe(
      true,
    );
  });

  it("does not let a server match answer a control-number query", () => {
    // "ac-3" is the sharper case. The server returns the controls whose prose cites
    // AC-3 — AU-02, CM-05, PE-22 among them — and misses AC-03 itself, because the
    // number is stored zero-padded. Deferring to it both admits the wrong controls and
    // drops the right one.
    const au02 = control({ id: "AU-02", name: "Event Logging" });
    expect(matchesText(au02, "ac-3", new Set(["AU-02"]))).toBe(false);
    // AC-03 is what the query means, and the prefix rule finds it without the server.
    expect(matchesText(control({ id: "AC-03" }), "ac-3", new Set())).toBe(true);
  });

  it("a two-letter word that is not a family code stays free text", () => {
    // "in" is not a family code, so it is not an identifier query and the server's
    // verdict still applies — the guard is scoped to real codes, not any short string.
    const c = control({ id: "SC-21", name: "Secure Name Caching Resolver" });
    expect(matchesText(c, "in", new Set(["SC-21"]))).toBe(true);
  });

  it("behaves exactly as before when the server has no answer yet", () => {
    const c = control({
      id: "IA-02",
      name: "Identification and Authentication",
    });
    expect(matchesText(c, "phishing", undefined)).toBe(
      matchesText(c, "phishing"),
    );
  });

  it("an empty query is still everything, server set or not", () => {
    expect(matchesText(control(), "", new Set())).toBe(true);
  });
});

describe("matchesQuery with server matches", () => {
  it("narrows server prose matches by the active facets", () => {
    // A prose match is not an escape hatch past the facet filter — the two still AND.
    const q: FilterQuery = { ...EMPTY, q: "phishing", pillar: ["IDENTITY"] };
    const matches = new Set(["AC-02"]);
    expect(matchesQuery(control({ pillars: ["IDENTITY"] }), q, matches)).toBe(
      true,
    );
    expect(matchesQuery(control({ pillars: ["DATA"] }), q, matches)).toBe(
      false,
    );
  });
});

describe("isQueryActive", () => {
  it("is false for the empty query", () => {
    expect(isQueryActive(EMPTY)).toBe(false);
  });

  it("is true when any facet or the search box is set", () => {
    expect(isQueryActive({ ...EMPTY, pillar: ["IDENTITY"] })).toBe(true);
    expect(isQueryActive({ ...EMPTY, q: "ac" })).toBe(true);
  });

  it("treats a whitespace-only search box as inactive", () => {
    expect(isQueryActive({ ...EMPTY, q: "   " })).toBe(false);
  });
});

describe("passesFacets — designation", () => {
  const ctl = (designations?: string[]): FilterableControl => ({
    id: "AC-06",
    name: "Least Privilege",
    status: "zero-trust-aligned",
    family: "AC",
    pillars: ["IDENTITY"],
    maturities: ["TRADITIONAL"],
    designations,
  });

  it("matches a control with any selected designation on one of its tuples", () => {
    const keyOrSupporting: FilterQuery = {
      ...EMPTY,
      designation: ["KEY", "SUPPORTING"],
    };
    expect(
      passesFacets(ctl(["SUPPORTING", "INFORMATIVE"]), keyOrSupporting),
    ).toBe(true);
    expect(passesFacets(ctl(["INFORMATIVE"]), keyOrSupporting)).toBe(false);
  });

  it("hides a control with no designated tuple once the facet is active", () => {
    expect(passesFacets(ctl([]), { ...EMPTY, designation: ["KEY"] })).toBe(
      false,
    );
    expect(
      passesFacets(ctl(undefined), { ...EMPTY, designation: ["KEY"] }),
    ).toBe(false);
    expect(passesFacets(ctl(undefined), EMPTY)).toBe(true);
  });

  it("combines with the other facets by AND", () => {
    const q: FilterQuery = { ...EMPTY, designation: ["KEY"], pillar: ["DATA"] };
    expect(passesFacets(ctl(["KEY"]), q)).toBe(false);
  });

  it("counts as an active query", () => {
    expect(isQueryActive({ ...EMPTY, designation: ["INFORMATIVE"] })).toBe(
      true,
    );
  });
});

describe("passesFacets — baseline", () => {
  const ctl = (baselines?: string[]): FilterableControl => ({
    id: "AC-02",
    name: "Account Management",
    status: "compliance",
    family: "AC",
    pillars: [],
    maturities: [],
    baselines,
  });

  it("matches a control in any selected baseline", () => {
    const q: FilterQuery = { ...EMPTY, baseline: ["HIGH", "PRIVACY"] };
    expect(passesFacets(ctl(["Low", "Moderate", "High"]), q)).toBe(true);
    expect(passesFacets(ctl(["Low"]), q)).toBe(false);
  });

  it("matches a control in no baseline only through 'In no baseline'", () => {
    expect(passesFacets(ctl([]), { ...EMPTY, baseline: ["NONE"] })).toBe(true);
    expect(passesFacets(ctl(undefined), { ...EMPTY, baseline: ["NONE"] })).toBe(
      true,
    );
    expect(passesFacets(ctl(["Low"]), { ...EMPTY, baseline: ["NONE"] })).toBe(
      false,
    );
    expect(passesFacets(ctl([]), { ...EMPTY, baseline: ["LOW"] })).toBe(false);
  });

  it("matches a base control through any of its enhancements", () => {
    const q: FilterQuery = { ...EMPTY, baseline: ["PRIVACY"] };
    const auNine = {
      ...ctl(["Low", "Moderate", "High"]),
      enhancementBaselines: ["High", "Privacy"],
    };
    expect(passesFacets(auNine, q)).toBe(true);
    expect(passesFacets(ctl(["Low", "Moderate", "High"]), q)).toBe(false);
  });

  it("puts a control in no baseline only when no enhancement is in one either", () => {
    const none: FilterQuery = { ...EMPTY, baseline: ["NONE"] };
    expect(
      passesFacets({ ...ctl([]), enhancementBaselines: ["Low"] }, none),
    ).toBe(false);
    expect(passesFacets({ ...ctl([]), enhancementBaselines: [] }, none)).toBe(
      true,
    );
  });

  it("combines with the other facets, and counts as an active query", () => {
    const q: FilterQuery = { ...EMPTY, baseline: ["MODERATE"], family: ["AU"] };
    expect(passesFacets(ctl(["Moderate"]), q)).toBe(false);
    expect(isQueryActive({ ...EMPTY, baseline: ["LOW"] })).toBe(true);
  });
});
