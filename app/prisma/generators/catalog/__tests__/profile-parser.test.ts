/**
 * Tests for baseline membership.
 *
 * The refusal paths are the point of this module, so most of these prove a
 * failure fires. A reader that skipped a selector it did not implement would be
 * correct against the four pinned profiles and silently wrong the moment the pin
 * moved — and wrong in the worst way, because an ignored selector contributes no
 * ids, so "listed equals resolved" still balances while membership under-counts.
 */

import { describe, expect, it } from "vitest";

import {
  BASELINE_NAMES,
  baselineNameFor,
  baselinesFromProfiles,
  profileControlIds,
  type BaselineProfile,
} from "../profile-parser.js";
import type { OscalImport, OscalProfile } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(
  overrides: { title?: string; imports?: OscalImport[] } = {},
): OscalProfile {
  return {
    profile: {
      uuid: "00000000-0000-0000-0000-000000000000",
      metadata: {
        title: overrides.title ?? "Test Baseline",
        version: "5.2.0",
        "oscal-version": "1.2.2",
        "last-modified": "2026-05-11T00:00:00.000Z",
      },
      imports: overrides.imports ?? [
        { href: "#catalog", "include-controls": [{ "with-ids": ["ac-1"] }] },
      ],
    },
  };
}

function source(name: string, profile: OscalProfile): BaselineProfile {
  return { name: baselineNameFor(name, profile), profile, source: name };
}

// ---------------------------------------------------------------------------
// profileControlIds — the selectors it implements, and the ones it refuses
// ---------------------------------------------------------------------------

describe("profileControlIds", () => {
  it("flattens with-ids across every include block and every import", () => {
    const profile = makeProfile({
      imports: [
        {
          href: "#a",
          "include-controls": [
            { "with-ids": ["ac-1", "ac-2"] },
            { "with-ids": ["au-1"] },
          ],
        },
        { href: "#b", "include-controls": [{ "with-ids": ["sc-7"] }] },
      ],
    });
    expect(profileControlIds("test.json", profile)).toEqual([
      "ac-1",
      "ac-2",
      "au-1",
      "sc-7",
    ]);
  });

  // Each of these is valid OSCAL that this reader does not implement. Silently
  // ignoring any one of them under-counts baselines while every count reconciles.
  it.each([
    ["include-all", { href: "#a", "include-all": {} }],
    [
      "exclude-controls",
      {
        href: "#a",
        "include-controls": [{ "with-ids": ["ac-1"] }],
        "exclude-controls": [{ "with-ids": ["ac-2"] }],
      },
    ],
  ])("refuses an import using %s", (key, imp) => {
    const profile = makeProfile({ imports: [imp] });
    expect(() => profileControlIds("low.json", profile)).toThrow(
      new RegExp(`"${key}"`),
    );
  });

  it.each([
    ["matching", { matching: [{ pattern: "ac-*" }] }],
    [
      "with-child-controls",
      { "with-ids": ["ac-1"], "with-child-controls": "yes" },
    ],
  ])("refuses a selector using %s", (key, selector) => {
    const profile = makeProfile({
      imports: [{ href: "#a", "include-controls": [selector] }],
    });
    expect(() => profileControlIds("low.json", profile)).toThrow(
      new RegExp(`"${key}"`),
    );
  });

  it("names the file and the import index, so the offender is findable", () => {
    const profile = makeProfile({
      imports: [
        { href: "#a", "include-controls": [{ "with-ids": ["ac-1"] }] },
        { href: "#b", "include-all": {} },
      ],
    });
    expect(() => profileControlIds("HIGH.json", profile)).toThrow(
      /HIGH\.json: import\[1\]/,
    );
  });

  it("refuses an import that selects nothing", () => {
    // A baseline that includes no controls is not a baseline; it is a parse that
    // went wrong somewhere upstream and produced a plausible-looking empty.
    const profile = makeProfile({ imports: [{ href: "#a" }] });
    expect(() => profileControlIds("low.json", profile)).toThrow(
      /selects no controls/,
    );
  });

  it("refuses an empty with-ids list", () => {
    const profile = makeProfile({
      imports: [{ href: "#a", "include-controls": [{ "with-ids": [] }] }],
    });
    expect(() => profileControlIds("low.json", profile)).toThrow(
      /empty with-ids/,
    );
  });

  it("refuses a profile with no imports at all", () => {
    const profile = makeProfile();
    profile.profile.imports = [];
    expect(() => profileControlIds("low.json", profile)).toThrow(/no imports/);
  });
});

// ---------------------------------------------------------------------------
// baselineNameFor
// ---------------------------------------------------------------------------

describe("baselineNameFor", () => {
  it.each(BASELINE_NAMES.map((n) => [n]))(
    "reads %s from the file name",
    (name) => {
      const file = `NIST_SP-800-53_rev5_${name.toUpperCase()}-baseline_profile.json`;
      expect(baselineNameFor(file, makeProfile())).toBe(name);
    },
  );

  it("falls back to the metadata title when the file name says nothing", () => {
    expect(
      baselineNameFor("profile.json", makeProfile({ title: "High Baseline" })),
    ).toBe("High");
  });

  it("refuses a name that matches none", () => {
    expect(() => baselineNameFor("profile.json", makeProfile())).toThrow(
      /matched: none/,
    );
  });

  it("refuses a name that matches more than one, rather than picking", () => {
    // "LOW-to-MODERATE" is ambiguous. Guessing here would silently file a whole
    // baseline's membership under the wrong name.
    expect(() =>
      baselineNameFor("LOW-to-MODERATE.json", makeProfile()),
    ).toThrow(/matched: Low, Moderate/);
  });
});

// ---------------------------------------------------------------------------
// baselinesFromProfiles
// ---------------------------------------------------------------------------

describe("baselinesFromProfiles", () => {
  const known = new Set(["ac-1", "ac-2", "au-1"]);

  function withIds(name: string, ids: string[]): BaselineProfile {
    return source(
      name,
      makeProfile({
        imports: [{ href: "#c", "include-controls": [{ "with-ids": ids }] }],
      }),
    );
  }

  it("collects a control's baselines in published order, not load order", () => {
    // Passed High-first; the result must still read Low, Moderate, High so the
    // emitted array is deterministic whatever order the files were read in.
    const membership = baselinesFromProfiles(
      [
        withIds("HIGH.json", ["ac-1"]),
        withIds("LOW.json", ["ac-1"]),
        withIds("MODERATE.json", ["ac-1"]),
      ],
      known,
    );
    expect(membership.byControl.get("ac-1")).toEqual([
      "Low",
      "Moderate",
      "High",
    ]);
  });

  it("counts every id listed, including ones listed twice", () => {
    const membership = baselinesFromProfiles(
      [withIds("LOW.json", ["ac-1", "ac-2"]), withIds("HIGH.json", ["ac-1"])],
      known,
    );
    expect(membership.listed).toBe(3);
  });

  it("does not repeat a baseline a control is listed under twice", () => {
    const profile = source(
      "LOW.json",
      makeProfile({
        imports: [
          {
            href: "#c",
            "include-controls": [
              { "with-ids": ["ac-1"] },
              { "with-ids": ["ac-1"] },
            ],
          },
        ],
      }),
    );
    expect(
      baselinesFromProfiles([profile], known).byControl.get("ac-1"),
    ).toEqual(["Low"]);
  });

  it("surfaces an id the catalog does not define instead of dropping it", () => {
    // A profile pointing at a control that is not there means catalog and
    // profiles are out of step, which the run gates on.
    const membership = baselinesFromProfiles(
      [withIds("LOW.json", ["ac-1", "does-not-exist"])],
      known,
    );
    expect(membership.unresolved).toEqual([
      { baseline: "Low", id: "does-not-exist" },
    ]);
    expect(membership.byControl.has("does-not-exist")).toBe(false);
    // Still counted as listed, so listed-minus-unresolved is the resolved count.
    expect(membership.listed).toBe(2);
  });

  it("leaves a control in no baseline absent from the map", () => {
    const membership = baselinesFromProfiles(
      [withIds("LOW.json", ["ac-1"])],
      known,
    );
    expect(membership.byControl.has("au-1")).toBe(false);
  });
});
