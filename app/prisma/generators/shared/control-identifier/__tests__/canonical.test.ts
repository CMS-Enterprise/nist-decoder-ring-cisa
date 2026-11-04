/**
 * The identifier rule against its contract.
 *
 * Every case comes from fixtures.json, so a change to the rule has to change a
 * fixture, and the diff shows what an identifier now means.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalize,
  ControlIdentifierError,
  loadOverrides,
  resetOverridesCache,
  setOverridesForTest,
  seedControlId,
  assertNoCollisions,
  controlIdentity,
} from "../canonical.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Fixtures {
  canonical: {
    raw: string;
    controlNumber: string;
    family: string;
    base: number;
    enhancement: number | null;
    letter: string | null;
  }[];
  rejected: { raw: string; why: string }[];
  seedIds: { controlNumber: string; token: string; seedId: string }[];
}

const fixtures = JSON.parse(
  readFileSync(join(HERE, "..", "fixtures.json"), "utf8"),
) as Fixtures;

beforeEach(() => {
  resetOverridesCache();
  // The declared-malformed path writes to stderr by design; silence it so a
  // passing run is quiet and a real warning elsewhere still stands out.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("the fixture contract is real", () => {
  it("carries cases in all three groups", () => {
    // A fixture file that silently emptied would make every loop below vacuous.
    expect(fixtures.canonical.length).toBeGreaterThan(10);
    expect(fixtures.rejected.length).toBeGreaterThan(5);
    expect(fixtures.seedIds.length).toBeGreaterThan(3);
  });
});

describe("canonicalize", () => {
  it.each(fixtures.canonical)(
    "$raw -> $controlNumber",
    ({ raw, controlNumber, family, base, enhancement, letter }) => {
      const got = canonicalize(raw);
      expect(got.controlNumber).toBe(controlNumber);
      expect(got.family).toBe(family);
      expect(got.base).toBe(base);
      expect(got.enhancement).toBe(enhancement);
      expect(got.letter).toBe(letter);
      expect(got.declaredMalformed).toBe(false);
    },
  );

  it.each(fixtures.rejected)("rejects $raw ($why)", ({ raw }) => {
    expect(() => canonicalize(raw)).toThrow(ControlIdentifierError);
  });

  it("names the offending value in the message rather than failing generically", () => {
    // The generator runs over hundreds of rows; a message without the value
    // sends you looking through the catalog by hand.
    expect(() => canonicalize("AC 01")).toThrow(/"AC 01"/);
  });

  it("pads unpadded and padded spellings to the same control", () => {
    // This is the property the join depends on.
    expect(canonicalize("AC-2(3)").controlNumber).toBe(
      canonicalize("AC-02(03)").controlNumber,
    );
  });
});

describe("the declared-exception registry", () => {
  const SYNTHETIC = {
    malformed: [
      {
        raw: "XY01(01)",
        catalog: "test",
        reason:
          "A synthetic entry. The live registry is empty by design, so the mechanism is exercised here rather than against real data.",
      },
    ],
    collisions: [],
  };

  it("is empty, because every known defect is fixed at source", () => {
    // Not a formality. An entry here means a malformed identifier is being
    // tolerated rather than corrected, and the reason field has to say why.
    expect(loadOverrides().malformed).toEqual([]);
    expect(loadOverrides().collisions).toEqual([]);
  });

  it("returns a declared identifier verbatim instead of throwing", () => {
    setOverridesForTest(SYNTHETIC);
    const got = canonicalize("XY01(01)");
    expect(got.declaredMalformed).toBe(true);
    expect(got.controlNumber).toBe("XY01(01)");
    expect(got.family).toBeNull();
  });

  it("does not repair it into the control it would duplicate", () => {
    // Repairing would merge two rows on the generator's authority. That is a
    // catalog decision, and doing it here would also create a real collision.
    setOverridesForTest(SYNTHETIC);
    expect(canonicalize("XY01(01)").controlNumber).not.toBe("XY-01(01)");
  });

  it("leaves the derived seed id spelled the way the source spells it", () => {
    setOverridesForTest(SYNTHETIC);
    expect(seedControlId(canonicalize("XY01(01)").controlNumber, "v52")).toBe(
      "ctrl_xy01_01__v52",
    );
  });

  it("rejects the same shape when it is not declared", () => {
    // Proves the pass comes from the registry, not from a lenient regex. Both
    // identifiers that were once declared are corrected at source and now fail.
    expect(() => canonicalize("XY01(01)")).toThrow(ControlIdentifierError);
    expect(() => canonicalize("MA04(04)")).toThrow(ControlIdentifierError);
    expect(() => canonicalize("SR04(04)")).toThrow(ControlIdentifierError);
  });

  it("requires a catalog and a stated reason on any entry", () => {
    for (const entry of [
      ...loadOverrides().malformed,
      ...SYNTHETIC.malformed,
    ]) {
      expect(entry.catalog).toBeTruthy();
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("seedControlId", () => {
  it.each(fixtures.seedIds)(
    "$controlNumber @ $token -> $seedId",
    ({ controlNumber, token, seedId }) => {
      expect(seedControlId(controlNumber, token)).toBe(seedId);
    },
  );

  it("keeps two catalogs' ids apart for the same control", () => {
    expect(seedControlId("AC-01", "v52")).not.toBe(
      seedControlId("AC-01", "r520"),
    );
  });
});

describe("assertNoCollisions", () => {
  it("passes when every identifier means a different control", () => {
    expect(() =>
      assertNoCollisions(["AC-01", "AC-02", "AC-02(01)"]),
    ).not.toThrow();
  });

  it("fails when two spellings collapse onto one control", () => {
    // AC-2(1) and AC-02(01) are the same control written two ways. Accepting
    // both would seed one row and silently drop the other.
    expect(() => assertNoCollisions(["AC-2(1)", "AC-02(01)"])).toThrow(
      ControlIdentifierError,
    );
  });

  it("names the colliding control and both spellings", () => {
    expect(() => assertNoCollisions(["AC-2(1)", "AC-02(01)"])).toThrow(
      /AC-02\(01\).*AC-02\(01\), AC-2\(1\)/s,
    );
  });

  it("ignores identifiers it cannot parse, which canonicalize already refuses", () => {
    expect(() => assertNoCollisions(["AC-01", "nonsense"])).not.toThrow();
  });

  it("treats a repeated identical spelling as one control, not a collision", () => {
    expect(() => assertNoCollisions(["AC-01", "AC-01"])).not.toThrow();
  });
});

describe("collision identity", () => {
  it("does not treat a control and its own lettered parts as a collision", () => {
    // Keying on controlNumber alone groups a control with its statement items,
    // reporting every control that has lettered items as a false collision.
    expect(() =>
      assertNoCollisions(["AC-01", "AC-01a", "AC-01b", "AC-01c"]),
    ).not.toThrow();
    expect(() => assertNoCollisions(["AC-02(03)", "AC-02(03)a"])).not.toThrow();
  });

  it("still catches two spellings of the same lettered item", () => {
    expect(() => assertNoCollisions(["AC-1a", "AC-01a"])).toThrow(
      ControlIdentifierError,
    );
  });

  it("keys on the display identity, so a report can be pasted into overrides", () => {
    expect(controlIdentity(canonicalize("AC-01"))).toBe("AC-01");
    expect(controlIdentity(canonicalize("AC-1a"))).toBe("AC-01a");
    expect(controlIdentity(canonicalize("AC-2(3)a"))).toBe("AC-02(03)a");
  });
});
