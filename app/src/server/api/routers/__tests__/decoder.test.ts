/**
 * Tests for the decoder tRPC router.
 *
 * We mock the Prisma client at the module level and build a tRPC caller
 * that uses the mocked DB, so every test exercises the real router logic
 * (filtering, grouping, mapping, mountain sort) without touching Postgres.
 */

import { vi } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma — vi.hoisted ensures mockDb is available when vi.mock runs
// ---------------------------------------------------------------------------

interface MockDb {
  nistVersion: { findFirst: Mock };
  nistControl: { findFirst: Mock; findMany: Mock };
  zTMMGuidance: { findMany: Mock };
  dataSource: { findFirst: Mock };
  controlLineage: { findFirst: Mock };
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    nistVersion: {
      findFirst: vi.fn(),
    },
    nistControl: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    zTMMGuidance: {
      findMany: vi.fn(),
    },
    dataSource: {
      findFirst: vi.fn(),
    },
    controlLineage: {
      findFirst: vi.fn(),
    },
  } satisfies MockDb,
}));

vi.mock("~/server/db", () => ({
  db: mockDb,
}));

// Stub next-auth so the context factory doesn't blow up
vi.mock("~/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Import router machinery *after* mocks are registered
// ---------------------------------------------------------------------------

import { appRouter, createExportCaller } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import { exportRouter, ZT_GUIDANCE_PENDING, type PartRow } from "../decoder";
import type { db } from "~/server/db";

// Build a caller whose context uses the mocked db
const createCaller = createCallerFactory(appRouter);
function caller() {
  return createCaller({
    db: mockDb as unknown as typeof db,
    session: null,
    headers: new Headers(),
  });
}
function exportCaller() {
  return createExportCaller({
    db: mockDb as unknown as typeof db,
    session: null,
    headers: new Headers(),
  });
}

// ---------------------------------------------------------------------------
// Fixtures — Prisma-row builders live in ~/test/fixtures/decoder-rows so a
// schema change is one edit, and a renamed column fails here at compile time.
// ---------------------------------------------------------------------------

import {
  ACTIVE_VERSION,
  makeControl,
  makeGuidance,
  makeParameter,
  makePart,
  makeZtMapping,
} from "~/test/fixtures/decoder-rows";

/** Look up the value a baseline resolves to in a mapped parameter's grouped values[]. */
function paramValueFor(
  param: { values: Array<{ baselines: string[]; value: string }> },
  baseline: string,
): string | null {
  return (
    param.values.find((v) => v.baselines.includes(baseline))?.value ?? null
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no ZTMM guidance rows → mappings fall back to the pending placeholder.
  // Individual tests override with mockResolvedValue to exercise base+fragment resolution.
  mockDb.zTMMGuidance.findMany.mockResolvedValue([]);
  mockDb.dataSource.findFirst.mockResolvedValue(null);
  // Default: the catalog records lineage, as the seeded one does.
  mockDb.controlLineage.findFirst.mockResolvedValue({ id: "lin_any" });
});

// ========================== getActiveVersion ===============================

describe("decoder.getActiveVersion", () => {
  it("returns the active catalog version", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);

    const result = await caller().decoder.getActiveVersion();

    expect(result).toEqual({
      id: ACTIVE_VERSION.id,
      version: ACTIVE_VERSION.version,
      releaseDate: ACTIVE_VERSION.releaseDate,
      description: ACTIVE_VERSION.description,
      catalogKey: ACTIVE_VERSION.catalogKey,
      displayLabel: ACTIVE_VERSION.displayLabel,
      upstreamRevision: ACTIVE_VERSION.upstreamRevision,
      tailoringNote: ACTIVE_VERSION.tailoringNote,
    });
    expect(mockDb.nistVersion.findFirst).toHaveBeenCalledWith({
      where: { isActive: true },
    });
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);

    await expect(caller().decoder.getActiveVersion()).rejects.toThrow(
      "No active catalog version found",
    );
  });
});

// ========================== searchControls =================================

describe("decoder.searchControls", () => {
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
    // searchControls always issues the guidance prefetch first; default to no hits.
    mockDb.zTMMGuidance.findMany.mockResolvedValue([]);
  });

  it("maps controlNumber/controlName and computes matchedIn for each hit", async () => {
    // The router computes matchedIn off the query string vs. the returned rows:
    // 'id' when controlNumber contains q, else 'name' when controlName contains q,
    // else 'text'. Three rows, one of each, prove the precedence ladder.
    mockDb.nistControl.findMany.mockResolvedValue([
      // controlNumber contains "ac-02" → 'id'
      { controlNumber: "AC-02", controlName: "Account Management" },
      // number misses, controlName contains "ac-02"? no — use a name-only hit below
    ]);

    const result = await caller().decoder.searchControls({ q: "AC-02" });

    expect(result.hits).toEqual([
      {
        controlNumber: "AC-02",
        controlName: "Account Management",
        matchedIn: "id",
        withdrawn: false,
      },
    ]);
  });

  it("classifies a name-only hit as 'name' and a text/guidance hit as 'text'", async () => {
    // q = "account": AC-02 matches on name (not number), and a row whose number/name
    // both miss "account" is a text/ZT-guidance hit (matchedIn 'text').
    mockDb.nistControl.findMany.mockResolvedValue([
      { controlNumber: "AC-02", controlName: "Account Management" }, // name hit
      { controlNumber: "AU-05", controlName: "Audit Failure Response" }, // neither → text
    ]);

    const result = await caller().decoder.searchControls({ q: "account" });

    expect(result.hits).toEqual([
      {
        controlNumber: "AC-02",
        controlName: "Account Management",
        matchedIn: "name",
        withdrawn: false,
      },
      {
        controlNumber: "AU-05",
        controlName: "Audit Failure Response",
        matchedIn: "text",
        withdrawn: false,
      },
    ]);
  });

  it("reads current controls only unless asked to include withdrawn ones", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      { controlNumber: "SA-11", controlName: "Developer Testing" },
    ]);
    await caller().decoder.searchControls({ q: "sa-1" });
    // One control query: the current controls. Withdrawn ones are never read by default.
    expect(mockDb.nistControl.findMany).toHaveBeenCalledTimes(1);
    const [args] = mockDb.nistControl.findMany.mock.calls[0] as [
      { where: { status: string } },
    ];
    expect(args.where.status).toBe("LIVE");
  });

  it("adds withdrawn controls when asked, marked, after the current ones and never on the diagram", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        { controlNumber: "SA-11", controlName: "Developer Testing" },
      ])
      .mockResolvedValueOnce([
        { controlNumber: "SA-12", controlName: "Supply Chain Protection" },
        { controlNumber: "SA-12(01)", controlName: "Acquisition Strategies" },
      ]);

    const result = await caller().decoder.searchControls({
      q: "sa-12",
      includeWithdrawn: true,
    });

    expect(mockDb.nistControl.findMany).toHaveBeenLastCalledWith({
      where: {
        nistVersionId: ACTIVE_VERSION.id,
        status: "WITHDRAWN",
        OR: [
          { controlNumber: { contains: "sa-12", mode: "insensitive" } },
          { controlName: { contains: "sa-12", mode: "insensitive" } },
        ],
      },
      select: { controlNumber: true, controlName: true },
      orderBy: { sortId: "asc" },
    });
    // The exact number surfaces first; the withdrawn hits are marked.
    expect(
      result.hits.map((h) => [h.controlNumber, h.withdrawn] as const),
    ).toEqual([
      ["SA-12", true],
      ["SA-11", false],
      ["SA-12(01)", true],
    ]);
    // The diagram shows current controls only, so only those narrow it.
    expect(result.matchingIds).toEqual(["SA-11"]);
  });

  it("is case-insensitive when computing matchedIn", async () => {
    // q lowercased before comparison; an uppercase query still classifies the name hit.
    mockDb.nistControl.findMany.mockResolvedValue([
      { controlNumber: "AC-02", controlName: "Account Management" },
    ]);

    const result = await caller().decoder.searchControls({ q: "ACCOUNT" });

    expect(result.hits[0]!.matchedIn).toBe("name");
  });

  it("orders an exact control-number match first", async () => {
    // q = "ac-02" exactly equals AC-02's number; even though the DB returns AC-02(01)
    // first (sortId order), the exact match must sort to the front.
    mockDb.nistControl.findMany.mockResolvedValue([
      {
        controlNumber: "AC-02(01)",
        controlName: "Automated Account Management",
      },
      { controlNumber: "AC-02", controlName: "Account Management" },
    ]);

    const result = await caller().decoder.searchControls({ q: "ac-02" });

    expect(result.hits.map((r) => r.controlNumber)).toEqual([
      "AC-02",
      "AC-02(01)",
    ]);
    expect(result.matchingIds).toEqual(["AC-02", "AC-02(01)"]);
    expect(result.hits[0]!.matchedIn).toBe("id");
  });

  it("preserves DB (sortId) order when there is no exact number match", async () => {
    // No row's number equals q exactly, so the stable sort is a no-op and the
    // DB-supplied order is preserved.
    mockDb.nistControl.findMany.mockResolvedValue([
      { controlNumber: "AC-02", controlName: "Account Management" },
      {
        controlNumber: "AC-02(01)",
        controlName: "Automated Account Management",
      },
    ]);

    const result = await caller().decoder.searchControls({ q: "account" });

    expect(result.hits.map((r) => r.controlNumber)).toEqual([
      "AC-02",
      "AC-02(01)",
    ]);
  });

  it("returns an empty array when no controls match", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.searchControls({ q: "zzz" });

    expect(result.hits).toEqual([]);
    expect(result.matchingIds).toEqual([]);
  });

  it("caps hits at 25 while matchingIds carries every match", async () => {
    // The diagram narrows on matchingIds, so a 40-match query must narrow to 40 — a
    // cake that showed only the dropdown's 25 would be under-reporting what matched.
    mockDb.nistControl.findMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({
        controlNumber: `AC-${String(i + 1).padStart(2, "0")}`,
        controlName: `Control ${i + 1}`,
      })),
    );

    const result = await caller().decoder.searchControls({ q: "control" });

    expect(result.hits).toHaveLength(25);
    expect(result.matchingIds).toHaveLength(40);
    expect(result.matchingIds.at(-1)).toBe("AC-40");
  });

  it("surfaces an exact number match that sortId order pushed past the cap", async () => {
    // The cap now applies after the exact-match sort rather than in the query, so a
    // control the database returned 30th still reaches the top of the dropdown.
    mockDb.nistControl.findMany.mockResolvedValue([
      ...Array.from({ length: 29 }, (_, i) => ({
        controlNumber: `AC-${String(i + 1).padStart(2, "0")}(01)`,
        controlName: `Enhancement ${i + 1}`,
      })),
      { controlNumber: "AC-99", controlName: "Exact Match" },
    ]);

    const result = await caller().decoder.searchControls({ q: "ac-99" });

    expect(result.hits[0]!.controlNumber).toBe("AC-99");
  });

  it("issues the ZTMM guidance prefetch before matching controls", async () => {
    // The ZT-section search resolves matching guidance rows first; this guards that the
    // guidance findMany participates in the query (its hits feed the control where-OR).
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      { pillar: "IDENTITY", functionGroup: "Identity Management" },
    ]);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.searchControls({ q: "identity" });

    expect(mockDb.zTMMGuidance.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.nistControl.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects a single-character query (zod min(2))", async () => {
    await expect(caller().decoder.searchControls({ q: "a" })).rejects.toThrow();
    // The query is rejected by input validation before any DB call.
    expect(mockDb.nistControl.findMany).not.toHaveBeenCalled();
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);

    await expect(
      caller().decoder.searchControls({ q: "account" }),
    ).rejects.toThrow("No active catalog version found");
  });
});

// ========================== getBridgeData ==================================

describe("decoder.getBridgeData", () => {
  // Shared setup: active version is always present for these tests
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  });

  it("returns version string and grouped families", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-01",
        controlFamilyId: "AC",
        familyName: "Access Control",
      }),
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        familyName: "Access Control",
      }),
      makeControl({
        controlNumber: "AU-01",
        controlFamilyId: "AU",
        familyName: "Audit and Accountability",
      }),
    ]);

    const result = await caller().decoder.getBridgeData();

    expect(result.version).toBe("NIST SP 800-53 Rev 5");
    // Two families total
    expect(result.families).toHaveLength(2);

    const acFamily = result.families.find((f) => f.id === "AC");
    expect(acFamily).toBeDefined();
    expect(acFamily!.name).toBe("Access Control");
    expect(acFamily!.controls).toHaveLength(2);

    const auFamily = result.families.find((f) => f.id === "AU");
    expect(auFamily).toBeDefined();
    expect(auFamily!.controls).toHaveLength(1);
  });

  it("orders families alphabetically by id (mountain layout is a client concern)", async () => {
    // Differing control counts prove the order is by id, not by count: were a mountain
    // sort applied here, AU (the largest family) would lead — alphabetical keeps AC first.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlNumber: "AU-01", controlFamilyId: "AU" }),
      makeControl({ controlNumber: "AU-02", controlFamilyId: "AU" }),
      makeControl({ controlNumber: "AU-03", controlFamilyId: "AU" }),
      makeControl({ controlNumber: "AC-01", controlFamilyId: "AC" }),
      makeControl({ controlNumber: "AT-01", controlFamilyId: "AT" }),
    ]);

    const result = await caller().decoder.getBridgeData();

    expect(result.families.map((f) => f.id)).toEqual(["AC", "AT", "AU"]);
  });

  it("maps control fields correctly for controls without ZT mapping", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-01",
        controlName: "Access Policy",
        controlFamilyId: "AC",
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    const ctrl = result.families[0]!.controls[0]!;

    expect(ctrl).toEqual({
      id: "AC-01",
      // Carried so selection can be held by a stable identifier rather than by this object.
      oscalId: "ac-1",
      name: "Access Policy",
      status: "compliance",
      family: "AC",
      pillars: [],
      maturities: [],
      functions: [],
      designations: [],
      baselines: [],
      enhancementBaselines: [],
      ztMapping: undefined,
    });
  });

  it("maps control fields correctly for controls WITH a ZT mapping (affinity-sourced dimensions)", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
          maturityLevel: "OPTIMAL",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "OPTIMAL",
            },
          ],
        }),
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    const ctrl = result.families[0]!.controls[0]!;

    expect(ctrl.status).toBe("zero-trust-aligned");
    expect(ctrl.family).toBe("AC");
    // Filter dimensions are sourced from the per-tuple affinity rows.
    expect(ctrl.pillars).toEqual(["IDENTITY"]);
    expect(ctrl.maturities).toEqual(["OPTIMAL"]);
    expect(ctrl.functions).toEqual(["Identity Management"]);
    // The representative ztMapping carries pillar/function/maturity + resolved guidance.
    expect(ctrl.ztMapping).toEqual({
      pillar: "IDENTITY",
      function: "Identity Management",
      maturity: "OPTIMAL",
      guidance: ZT_GUIDANCE_PENDING,
    });
  });

  it("deduplicates a pillar repeated across affinity rows", async () => {
    // The IDENTITY pillar has several functions in the seed; a control mapped to two
    // of them yields two affinity rows sharing the pillar. unique() must collapse it.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
          maturityLevel: "ADVANCED",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
            },
            {
              pillar: "IDENTITY",
              function: "Identity Stores",
              maturity: "OPTIMAL",
            },
          ],
        }),
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    const ctrl = result.families[0]!.controls[0]!;

    expect(ctrl.pillars).toEqual(["IDENTITY"]); // collapsed despite two rows
    expect(ctrl.maturities).toEqual(["ADVANCED", "OPTIMAL"]);
    expect(ctrl.functions).toEqual(["Identity Management", "Identity Stores"]);
  });

  it("surfaces ALL distinct pillars/maturities/functions for a multi-affinity control", async () => {
    // Multi-pillar guard: a control whose affinities span several distinct
    // (pillar, function, maturity) tuples must expose every distinct value so the
    // client filter never mis-buckets it on the representative mapping alone.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management", // representative
          maturityLevel: "ADVANCED",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "ADVANCED",
            },
            {
              pillar: "DATA",
              function: "Data Encryption",
              maturity: "OPTIMAL",
              designation: "SUPPORTING",
            },
            {
              pillar: "DATA",
              function: "Data Access",
              maturity: "OPTIMAL",
              designation: "SUPPORTING",
            },
          ],
        }),
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    const ctrl = result.families[0]!.controls[0]!;

    expect(ctrl.pillars).toEqual(["IDENTITY", "DATA"]);
    expect(ctrl.maturities).toEqual(["ADVANCED", "OPTIMAL"]);
    expect(ctrl.functions).toEqual([
      "Identity Management",
      "Data Encryption",
      "Data Access",
    ]);
    // Distinct designations; the undesignated tuple adds none.
    expect(ctrl.designations).toEqual(["SUPPORTING"]);
  });

  it("falls back to the representative mapping for dimensions when there are no affinity rows", async () => {
    // A ZT-mapped control whose ztMapping has an empty affinities array must still
    // populate pillars/maturities/functions from the representative mapping.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["NETWORKS"],
          function: "Network Segmentation",
          maturityLevel: "INITIAL",
          affinities: [],
        }),
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    const ctrl = result.families[0]!.controls[0]!;

    expect(ctrl.status).toBe("zero-trust-aligned");
    expect(ctrl.pillars).toEqual(["NETWORKS"]);
    expect(ctrl.maturities).toEqual(["INITIAL"]);
    expect(ctrl.functions).toEqual(["Network Segmentation"]);
  });

  it("assigns status 'zt-via-enhancements' when base has no ZT but children do", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-01",
        controlFamilyId: "AC",
        ztMapping: null,
        children: [{ baselineLabels: [], ztMapping: { id: "zt-AC-01-01" } }],
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families[0]!.controls[0]!.status).toBe("zt-via-enhancements");
    expect(result.families[0]!.controls[0]!.ztMapping).toBeUndefined();
  });

  it("assigns 'zt-aligned-with-enhancements' when the base AND an enhancement are ZT-mapped", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping(),
        children: [{ baselineLabels: [], ztMapping: { id: "zt-AC-02-01" } }],
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families[0]!.controls[0]!.status).toBe(
      "zt-aligned-with-enhancements",
    );
  });

  it("carries the baselines its enhancements are in, without counting a non-ZT enhancement as ZT", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: null,
        baselineLabels: ["Moderate", "High"],
        children: [
          { baselineLabels: ["Low", "Moderate"], ztMapping: null },
          { baselineLabels: ["Privacy"], ztMapping: null },
        ],
      }),
    ]);

    const ctrl = (await caller().decoder.getBridgeData()).families[0]!
      .controls[0]!;
    expect(ctrl.baselines).toEqual(["Moderate", "High"]);
    expect(ctrl.enhancementBaselines).toEqual(["Low", "Moderate", "Privacy"]);
    expect(ctrl.status).toBe("compliance");
  });

  it("assigns 'zero-trust-aligned' when the base is ZT-mapped with no ZT enhancements", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping(),
        children: [],
      }),
    ]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families[0]!.controls[0]!.status).toBe("zero-trust-aligned");
  });

  it("handles a single family gracefully", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlNumber: "AC-01", controlFamilyId: "AC" }),
    ]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families).toHaveLength(1);
    expect(result.families[0]!.id).toBe("AC");
  });

  it("treats a control row missing the children key as having no ZT enhancements", async () => {
    // Defensive `control.children ?? []` branch: a row without the children include.
    const rawControl = {
      ...makeControl({ controlNumber: "AC-01", controlFamilyId: "AC" }),
    };
    delete (rawControl as { children?: unknown }).children;

    mockDb.nistControl.findMany.mockResolvedValue([rawControl]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families[0]!.controls[0]!.status).toBe("compliance");
  });

  it("only emits families that contain at least one control", async () => {
    // A family is only created in the map when a control lands in it, so every
    // emitted family has a non-empty controls array.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlNumber: "AC-01", controlFamilyId: "AC" }),
      makeControl({ controlNumber: "AU-01", controlFamilyId: "AU" }),
    ]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families).toHaveLength(2);
    expect(result.families.every((f) => f.controls.length > 0)).toBe(true);
  });

  it("returns empty families array when no controls exist", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getBridgeData();
    expect(result.families).toEqual([]);
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);

    await expect(caller().decoder.getBridgeData()).rejects.toThrow(
      "No active catalog version found",
    );
  });

  it("queries only live top-level controls and includes every live enhancement for ZT detection and baselines", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getBridgeData();

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          parentControlId: null,
          nistVersionId: ACTIVE_VERSION.id,
          status: "LIVE",
        }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        include: expect.objectContaining({
          children: {
            where: { status: "LIVE" },
            select: {
              baselineLabels: true,
              ztMapping: { select: { id: true } },
            },
          },
        }),
      }),
    );
  });
});

// ========================== getControlById ================================

describe("decoder.getControlById", () => {
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);

    await expect(
      caller().decoder.getControlById({ controlId: "AC-01" }),
    ).rejects.toThrow("No active catalog version found");
  });

  it("throws when control is not found", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue(null);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await expect(
      caller().decoder.getControlById({ controlId: "ZZ-99" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Control ZZ-99 not found",
    });
  });

  it("serves catalog status and lineage: successors, what a control incorporates, and when it was added", async () => {
    const lineageRow = (
      controlNumber: string,
      kind: "INCORPORATED_INTO" | "MOVED_TO" | "ADDED",
      relatedControlNumber: string | null,
    ) => ({
      controlNumber,
      kind,
      relatedControlNumber,
      relatedPartOscalId: null,
      release: "5.2.0",
      sinceRelease: kind === "ADDED" ? "5.1.1+u4" : null,
    });
    mockDb.nistControl.findFirst.mockResolvedValue({
      ...makeControl({
        controlNumber: "SA-12",
        controlName: "Supply Chain Protection",
      }),
      status: "WITHDRAWN",
      lineage: [lineageRow("SA-12", "INCORPORATED_INTO", "SR")],
      lineageFrom: [],
    });
    mockDb.nistControl.findMany.mockResolvedValue([
      {
        ...makeControl({ controlNumber: "SA-12(01)" }),
        status: "WITHDRAWN",
        lineage: [lineageRow("SA-12(01)", "MOVED_TO", "SR-05")],
        lineageFrom: [],
      },
    ]);

    const sa12 = await caller().decoder.getControlById({ controlId: "SA-12" });
    expect(sa12.catalogStatus).toBe("withdrawn");
    expect(sa12.lineage).toEqual({
      successors: [
        {
          controlNumber: "SR",
          kind: "incorporated-into",
          family: true,
          part: null,
          ztPillars: null,
        },
      ],
      incorporates: [],
      addedIn: null,
    });
    expect(sa12.enhancements[0]!.lineage!.successors).toEqual([
      {
        controlNumber: "SR-05",
        kind: "moved-to",
        family: false,
        part: null,
        ztPillars: null,
      },
    ]);

    mockDb.nistControl.findFirst.mockResolvedValue({
      ...makeControl({ controlNumber: "SR-05" }),
      status: "LIVE",
      lineage: [lineageRow("SR-05", "ADDED", null)],
      lineageFrom: [lineageRow("SA-12(01)", "MOVED_TO", "SR-05")],
    });
    mockDb.nistControl.findMany.mockResolvedValue([]);
    const sr05 = await caller().decoder.getControlById({ controlId: "SR-05" });
    expect(sr05.catalogStatus).toBe("live");
    expect(sr05.lineage).toEqual({
      successors: [],
      incorporates: [
        { controlNumber: "SA-12(01)", kind: "moved-to", part: null },
      ],
      addedIn: { release: "5.2.0", sinceRelease: "5.1.1+u4" },
    });
  });

  it("serves a successor's item and its Zero Trust pillars", async () => {
    mockDb.nistControl.findFirst.mockResolvedValue({
      ...makeControl({ controlNumber: "AC-02(10)" }),
      status: "WITHDRAWN",
      lineage: [
        {
          controlNumber: "AC-02(10)",
          kind: "INCORPORATED_INTO",
          relatedControlNumber: "AC-02",
          relatedPartOscalId: "ac-2_smt.k",
          release: "5.2.0",
          sinceRelease: null,
          relatedControl: { ztMapping: { pillars: ["IDENTITY", "DATA"] } },
        },
      ],
      lineageFrom: [],
    });
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const ctrl = await caller().decoder.getControlById({
      controlId: "AC-02(10)",
    });
    expect(ctrl.lineage!.successors).toEqual([
      {
        controlNumber: "AC-02",
        kind: "incorporated-into",
        family: false,
        part: "ac-2_smt.k",
        ztPillars: ["IDENTITY", "DATA"],
      },
    ]);
  });

  it("sends no lineage for a catalog that records none, so a withdrawn control says its successors are not recorded", async () => {
    // A catalog can mark a control withdrawn without its data saying where the content
    // went. Empty lists would claim the catalog names no successor; null says the data
    // carries none, which is the honest reading when nothing was ingested.
    mockDb.controlLineage.findFirst.mockResolvedValue(null);
    mockDb.nistControl.findFirst.mockResolvedValue({
      ...makeControl({ controlNumber: "AC-13" }),
      status: "WITHDRAWN",
      lineage: [],
      lineageFrom: [],
    });
    mockDb.nistControl.findMany.mockResolvedValue([
      { ...makeControl({ controlNumber: "AC-13(01)" }), status: "WITHDRAWN" },
    ]);

    const ac13 = await caller().decoder.getControlById({ controlId: "AC-13" });
    expect(ac13.catalogStatus).toBe("withdrawn");
    expect(ac13.lineage).toBeNull();
    expect(ac13.enhancements[0]!.lineage).toBeNull();
    expect(mockDb.controlLineage.findFirst).toHaveBeenCalledWith({
      where: { nistVersionId: ACTIVE_VERSION.id },
      select: { id: true },
    });
  });

  it("returns a control without ZT mapping", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      controlName: "Access Policy",
      reviewFrequency: "Annually (365 Days)",
      assessmentFrequency: "Three (3) Years",
      priority: "P1",
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]); // no enhancements

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });

    expect(result.id).toBe("AC-01");
    expect(result.name).toBe("Access Policy");
    expect(result.description).toBe(""); // No parts provided → empty composed statement
    expect(result.reviewFrequency).toBe("Annually (365 Days)");
    expect(result.assessmentFrequency).toBe("Three (3) Years");
    expect(result.priority).toBe("P1");
    expect(result.status).toBe("compliance");
    expect(result.ztMapping).toBeUndefined();
    expect(result.enhancements).toEqual([]);
    // A catalog with no assessment procedures seeded still carries the field, so the client never has to test for its presence.
    expect(result.assessment).toEqual({ objectives: [], methods: [] });
  });

  it("maps SP 800-53A assessment procedures onto the control detail", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      assessmentObjectives: [
        {
          id: "obj_ac-02a.01_r520",
          cprtIdentifier: "DS-AC-02a.[01]",
          text: "account types allowed are defined;",
          sortOrder: 0,
          partId: "part_ac-2_smt.a_r520",
        },
        {
          id: "obj_ac-02_01__r520",
          cprtIdentifier: "DS-AC-02(01)",
          text: "management is supported;",
          sortOrder: 1,
          partId: null,
        },
      ],
      assessmentMethods: [
        { method: "EXAMINE", text: "[SELECT FROM: Access control policy]." },
        { method: "TEST", text: "[SELECT FROM: Account mechanisms]." },
      ],
    });
    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    // All three kinds, with a null where the publication provides none — the client must be able to say "NIST publishes no interview for this control" rather than infer it from a row that is not there.
    expect(result.assessment).toEqual({
      objectives: [
        {
          id: "obj_ac-02a.01_r520",
          identifier: "DS-AC-02a.[01]",
          text: "account types allowed are defined;",
          partId: "part_ac-2_smt.a_r520",
        },
        {
          id: "obj_ac-02_01__r520",
          identifier: "DS-AC-02(01)",
          text: "management is supported;",
          partId: null,
        },
      ],
      methods: [
        { method: "EXAMINE", text: "[SELECT FROM: Access control policy]." },
        { method: "INTERVIEW", text: null },
        { method: "TEST", text: "[SELECT FROM: Account mechanisms]." },
      ],
    });
  });

  it("returns an empty method list, not three nulls, for a catalog with no assessment content", async () => {
    // The distinction the shape exists for: absent at source is three entries with a null; never ingested is no entries at all. Asserting three nulls here would have the API claim NIST publishes no methods for a control it never assessed.
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({ controlNumber: "AC-02" }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.assessment).toEqual({ objectives: [], methods: [] });
  });

  it("returns a control with ZT mapping and control-level referenceLinks", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      controlName: "Account Management",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "ADVANCED",
      }),
      referenceLinks: [
        {
          displayOrder: 0,
          link: {
            title: "ZT Reference",
            url: "https://example.com/zt",
            domain: "NIST",
            description: null,
          },
        },
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.status).toBe("zero-trust-aligned");
    // ztMapping has no links; links live at control level (from referenceLinks → ztLinks)
    expect(result.ztMapping).toEqual({
      pillar: "IDENTITY",
      function: "Identity Management",
      maturity: "ADVANCED",
      guidance: ZT_GUIDANCE_PENDING,
      affinities: [],
    });
    expect(result.ztLinks).toEqual([
      {
        label: "ZT Reference",
        url: "https://example.com/zt",
        domain: "NIST",
        descriptor: "example.com",
        citation: null,
      },
    ]);
    // nistLinks sourced from ctrl.links (NistLink); default empty
    expect(result.nistLinks).toEqual([]);
  });

  it("describes each reference link and carries the citation and the retrieval provenance", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
    mockDb.nistControl.findFirst.mockResolvedValue(
      makeControl({
        links: [
          {
            title: "SP 800-39",
            url: "https://doi.org/10.6028/NIST.SP.800-39",
            description:
              "Joint Task Force (2011) Managing Information Security Risk.",
            resolvedUrl:
              "https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-39.pdf",
            contentType: "application/pdf",
            displayOrder: 1,
          },
          {
            title: "NIST CAVP",
            url: "https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program",
            description: null,
            resolvedUrl: null,
            contentType: null,
            displayOrder: 2,
          },
        ],
      }),
    );
    mockDb.nistControl.findMany.mockResolvedValue([]);
    // One provenance row per corpus, selected by its type.
    mockDb.dataSource.findFirst.mockImplementation(
      ({ where }: { where: { type: string } }) =>
        Promise.resolve(
          where.type === "reference-links"
            ? {
                name: "nist-800-53 reference links",
                lastCrawled: new Date("2026-09-30T00:00:00Z"),
                description:
                  "201 resources, 198 seeded; live check of 2026-09-30.",
              }
            : {
                name: "cisa zt reference links",
                lastCrawled: new Date("2026-10-01T00:00:00Z"),
                description: "3 documents, 16 links; live check of 2026-10-01.",
              },
        ),
    );

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.nistLinks).toEqual([
      {
        label: "SP 800-39",
        url: "https://doi.org/10.6028/NIST.SP.800-39",
        descriptor: "PDF · nvlpubs.nist.gov · via doi.org",
        citation: "Joint Task Force (2011) Managing Information Security Risk.",
      },
      {
        label: "NIST CAVP",
        url: "https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program",
        descriptor: "csrc.nist.gov",
        citation: null,
      },
    ]);
    expect(result.referenceProvenance).toEqual({
      name: "nist-800-53 reference links",
      checkedOn: new Date("2026-09-30T00:00:00Z"),
      description: "201 resources, 198 seeded; live check of 2026-09-30.",
    });
    expect(result.ztReferenceProvenance).toEqual({
      name: "cisa zt reference links",
      checkedOn: new Date("2026-10-01T00:00:00Z"),
      description: "3 documents, 16 links; live check of 2026-10-01.",
    });
    expect(mockDb.dataSource.findFirst).toHaveBeenCalledTimes(2);
    for (const type of ["reference-links", "zt-reference-links"]) {
      expect(mockDb.dataSource.findFirst).toHaveBeenCalledWith({
        where: { type, isActive: true },
        // The oldest check bounds the pane's claim; an unchecked file sorts first.
        orderBy: [
          { lastCrawled: { sort: "asc", nulls: "first" } },
          { name: "asc" },
        ],
        select: { name: true, lastCrawled: true, description: true },
      });
    }
  });

  it("resolves per-tuple guidance for a multi-affinity control (Option B)", async () => {
    // Two distinct tuples under different pillars/functions/maturities. Each must resolve to
    // ITS OWN function + maturity-specific guidance, rather than every tuple collapsing to a
    // single function/guidance string.
    const controlRow = makeControl({
      controlNumber: "AC-02",
      controlName: "Account Management",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY", "DATA"],
        function: "Identity Management", // representative
        maturityLevel: "ADVANCED",
        affinities: [
          {
            pillar: "IDENTITY",
            function: "Identity Management",
            maturity: "ADVANCED",
            designation: "KEY",
            ifApplicable: true,
          },
          { pillar: "DATA", function: "Data Encryption", maturity: "OPTIMAL" },
        ],
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Identity base.",
        advanced: "Identity advanced fragment.",
      }),
      makeGuidance({
        pillar: "DATA",
        function: "Data Encryption",
        base: "Data base.",
        optimal: "Data optimal fragment.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    // Each affinity carries its own function and its own (pillar, functionGroup, maturity)-resolved
    // guidance, with CISA's designation and If Applicable flag passed through as seeded.
    expect(result.ztMapping?.affinities).toEqual([
      {
        pillar: "IDENTITY",
        function: "Identity Management",
        maturity: "ADVANCED",
        designation: "KEY",
        ifApplicable: true,
        guidance: "Identity base.\nIdentity advanced fragment.",
      },
      {
        pillar: "DATA",
        function: "Data Encryption",
        maturity: "OPTIMAL",
        designation: null,
        ifApplicable: false,
        guidance: "Data base.\nData optimal fragment.",
      },
    ]);
    // Representative resolves against the first pillar — distinct from the DATA tuple's guidance.
    expect(result.ztMapping?.guidance).toBe(
      "Identity base.\nIdentity advanced fragment.",
    );
  });

  it("returns discussion on the control detail (the discussion section's source)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      discussion: "The catalog's interpretation of this control.",
    });
    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.discussion).toBe(
      "The catalog's interpretation of this control.",
    );
  });

  it("returns null discussion when the control has none", async () => {
    const controlRow = makeControl({ controlNumber: "AC-01" });
    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.discussion).toBeNull();
  });

  it("uses the pending placeholder (not discussion) for a tuple with no ZTMM match", async () => {
    // L4: discussion has its own modal section, so a non-resolving (pillar, function,
    // maturity) tuple must NOT fall back to it (that would duplicate it) — it shows the
    // neutral pending placeholder instead.
    const controlRow = makeControl({
      controlNumber: "AC-02",
      discussion: "Discussion that must NOT leak into ZT guidance.",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "ADVANCED",
        affinities: [
          {
            pillar: "IDENTITY",
            function: "Identity Management",
            maturity: "ADVANCED",
          },
          {
            pillar: "DATA",
            function: "Unmatched Function",
            maturity: "OPTIMAL",
          },
        ],
      }),
    });
    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Identity base.",
        advanced: "Identity advanced.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    const aff = result.ztMapping!.affinities;
    expect(aff[0]!.guidance).toBe("Identity base.\nIdentity advanced.");
    expect(aff[1]!.guidance).toBe(ZT_GUIDANCE_PENDING);
    expect(aff[1]!.guidance).not.toContain("must NOT leak");
  });

  it("propagates ZT part coverage (ztCovered) from _count.ztCoverages", async () => {
    // Drives the modal's teal subcontrol marker — a part is ZT-covered iff it has >=1
    // ZTPartCoverage row (Prisma _count). Guards the data contract behind that marker.
    const controlRow = makeControl({
      controlNumber: "AU-05",
      parts: [
        makePart({
          id: "part-root",
          name: "statement",
          prose: "The organization:",
          children: [
            makePart({
              id: "part-a",
              label: "a",
              name: "item",
              prose: "Covered subcontrol.",
              _count: { ztCoverages: 1 },
            }),
            makePart({
              id: "part-b",
              label: "b",
              name: "item",
              prose: "Uncovered subcontrol.",
              _count: { ztCoverages: 0 },
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AU-05",
    });
    const root = result.parts[0];
    expect(root?.children[0]?.ztCovered).toBe(true);
    expect(root?.children[1]?.ztCovered).toBe(false);
  });

  it("returns nested parts (recursive mapping)", async () => {
    const nestedParts = [
      makePart({
        id: "part-root",
        oscalPartId: "ac-2_smt",
        label: null,
        name: "statement",
        prose: "The organization:",
        sortOrder: 0,
        children: [
          makePart({
            id: "part-a",
            oscalPartId: "ac-2_smt.a",
            label: "a",
            name: "item",
            prose: "Identifies and selects account types.",
            sortOrder: 1,
            children: [
              makePart({
                id: "part-a1",
                oscalPartId: "ac-2_smt.a.1",
                label: "1",
                name: "item",
                prose: "Individual accounts.",
                sortOrder: 0,
                children: [],
              }),
            ],
          }),
          makePart({
            id: "part-b",
            oscalPartId: "ac-2_smt.b",
            label: "b",
            name: "item",
            prose: "Assigns account managers.",
            sortOrder: 2,
            children: [],
          }),
        ],
      }),
    ];

    const controlRow = makeControl({
      controlNumber: "AC-02",
      parts: nestedParts,
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.parts).toHaveLength(1);
    const root = result.parts[0]!;
    expect(root.id).toBe("part-root");
    expect(root.prose).toBe("The organization:");
    expect(root.children).toHaveLength(2);

    const partA = root.children[0]!;
    expect(partA.label).toBe("a");
    expect(partA.children).toHaveLength(1);
    expect(partA.children[0]!.label).toBe("1");
    expect(partA.children[0]!.prose).toBe("Individual accounts.");

    const partB = root.children[1]!;
    expect(partB.label).toBe("b");
    expect(partB.children).toEqual([]);
  });

  it("returns enhancements mapped through mapControl", async () => {
    const parentControl = makeControl({
      controlNumber: "AC-02",
      controlName: "Account Management",
    });

    const enhancement1 = makeControl({
      controlNumber: "AC-02(01)",
      controlName: "Automated Account Management",
      parentControlId: parentControl.id,
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Automation",
        maturityLevel: "OPTIMAL",
      }),
      parts: [
        makePart({
          id: "enh-part-1",
          oscalPartId: "ac-2.1_smt",
          prose: "Automated management.",
        }),
      ],
    });

    const enhancement2 = makeControl({
      controlNumber: "AC-02(02)",
      controlName: "Temporary Accounts",
      parentControlId: parentControl.id,
      priority: "P2",
    });

    mockDb.nistControl.findFirst.mockResolvedValue(parentControl);
    mockDb.nistControl.findMany.mockResolvedValue([enhancement1, enhancement2]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.enhancements).toHaveLength(2);

    const enh1 = result.enhancements[0]!;
    expect(enh1.id).toBe("AC-02(01)");
    expect(enh1.status).toBe("zero-trust-aligned");
    expect(enh1.ztMapping).toBeDefined();
    expect(enh1.parts).toHaveLength(1);

    const enh2 = result.enhancements[1]!;
    expect(enh2.id).toBe("AC-02(02)");
    expect(enh2.status).toBe("compliance");
    expect(enh2.ztMapping).toBeUndefined();
    expect(enh2.priority).toBe("P2");
  });

  it("queries enhancements using the parent control's DB id", async () => {
    const parentControl = makeControl({ controlNumber: "AC-02" });
    mockDb.nistControl.findFirst.mockResolvedValue(parentControl);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getControlById({ controlId: "AC-02" });

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          parentControlId: parentControl.id,
          nistVersionId: ACTIVE_VERSION.id,
        }),
      }),
    );
  });

  it("handles null optional fields gracefully", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      reviewFrequency: null,
      assessmentFrequency: null,
      priority: null,
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });

    expect(result.reviewFrequency).toBeNull();
    expect(result.assessmentFrequency).toBeNull();
    expect(result.priority).toBeNull();
  });

  it("handles control with empty parts array", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      parts: [],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.parts).toEqual([]);
  });

  it("returns empty description when control has no parts (no statement available)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      parts: [],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.description).toBe("");
    expect(result.parts).toEqual([]);
  });

  // --- Parameter tests ---

  it("returns parameters nested under their parts", async () => {
    const params = [
      makeParameter({ id: "p1", label: "approval personnel", position: 0 }),
      makeParameter({
        id: "p2",
        label: "time period",
        position: 1,
        low: "30 days",
        moderate: "7 days",
        high: "72 hours",
        privacy: "72 hours",
      }),
    ];

    const controlRow = makeControl({
      controlNumber: "AC-02",
      parts: [
        makePart({
          id: "part-root",
          name: "statement",
          prose: "The organization:",
          children: [
            makePart({
              id: "part-e",
              oscalPartId: "ac-2_smt.e",
              label: "e",
              name: "item",
              prose: "Require approvals by ...",
              parameters: params,
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    const partE = result.parts[0]!.children[0]!;
    expect(partE.parameters).toHaveLength(2);
    expect(partE.parameters[0]!.id).toBe("p1");
    expect(partE.parameters[0]!.label).toBe("approval personnel");
    expect(paramValueFor(partE.parameters[1]!, "LOW")).toBe("30 days");
    expect(paramValueFor(partE.parameters[1]!, "PRIVACY")).toBe("72 hours");
  });

  it("returns empty parameters array for parts without parameters", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      parts: [
        makePart({
          id: "part-root",
          name: "statement",
          parameters: [],
          children: [],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.parts[0]!.parameters).toEqual([]);
  });

  it("handles null baseline values in parameters", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-05",
      parts: [
        makePart({
          name: "statement",
          children: [
            makePart({
              id: "part-a",
              label: "a",
              name: "item",
              prose: "Identify and document:",
              parameters: [
                makeParameter({
                  low: null,
                  moderate: "duties of individuals",
                  high: "duties of individuals",
                  privacy: "duties of individuals",
                }),
              ],
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-05",
    });

    const param = result.parts[0]!.children[0]!.parameters[0]!;
    expect(paramValueFor(param, "LOW")).toBeNull();
    expect(paramValueFor(param, "MODERATE")).toBe("duties of individuals");
  });

  it("includes parameters on enhancement parts", async () => {
    const parentControl = makeControl({ controlNumber: "AC-02" });

    const enhancement = makeControl({
      controlNumber: "AC-02(02)",
      parentControlId: parentControl.id,
      parts: [
        makePart({
          id: "enh-root",
          name: "statement",
          prose: "Automatically disable temporary accounts",
          parameters: [
            makeParameter({
              id: "ep1",
              low: null,
              moderate: "60 days",
              high: "30 days",
              privacy: "12 hours",
            }),
          ],
          children: [],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(parentControl);
    mockDb.nistControl.findMany.mockResolvedValue([enhancement]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    const enhRoot = result.enhancements[0]!.parts[0]!;
    expect(enhRoot.parameters).toHaveLength(1);
    expect(paramValueFor(enhRoot.parameters[0]!, "MODERATE")).toBe("60 days");
  });

  // --- description tests ---

  it("composes statement text from parts with labels", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      parts: [
        makePart({
          id: "part-root",
          name: "statement",
          prose: "The organization:",
          children: [
            makePart({
              id: "part-a",
              label: "a",
              name: "item",
              prose: "Identifies and selects account types.",
              sortOrder: 0,
              children: [
                makePart({
                  id: "part-a1",
                  label: "1",
                  name: "item",
                  prose: "Individual accounts.",
                  sortOrder: 0,
                  children: [],
                }),
              ],
            }),
            makePart({
              id: "part-b",
              label: "b",
              name: "item",
              prose: "Assigns account managers.",
              sortOrder: 1,
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.description).toBe(
      "The organization:\na. Identifies and selects account types.\n  1. Individual accounts.\nb. Assigns account managers.",
    );
  });

  it("returns empty description when no parts exist", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-01",
      parts: [],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-01",
    });
    expect(result.description).toBe("");
  });

  it("returns simple prose for statement with no children", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02(01)",
      parts: [
        makePart({
          name: "statement",
          prose: "Support management using automated mechanisms.",
          children: [],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02(01)",
    });
    expect(result.description).toBe(
      "Support management using automated mechanisms.",
    );
  });

  it("includes description on enhancements", async () => {
    const parentControl = makeControl({ controlNumber: "AC-02" });

    const enhancement = makeControl({
      controlNumber: "AC-02(03)",
      parentControlId: parentControl.id,
      parts: [
        makePart({
          name: "statement",
          prose: "Disable accounts when:",
          children: [
            makePart({
              label: "a",
              name: "item",
              prose: "Have expired;",
              children: [],
            }),
            makePart({
              label: "b",
              name: "item",
              prose: "No longer associated.",
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(parentControl);
    mockDb.nistControl.findMany.mockResolvedValue([enhancement]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });

    expect(result.enhancements[0]!.description).toBe(
      "Disable accounts when:\na. Have expired;\nb. No longer associated.",
    );
  });

  // --- ztCovered tests ---

  it("sets ztCovered true for parts with _count.ztCoverages > 0", async () => {
    const controlRow = makeControl({
      controlNumber: "AU-05",
      parts: [
        makePart({
          name: "statement",
          prose: "The organization:",
          children: [
            makePart({
              id: "part-a",
              label: "a",
              name: "item",
              prose: "Alerts personnel.",
              _count: { ztCoverages: 1 },
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AU-05",
    });
    expect(result.parts[0]!.children[0]!.ztCovered).toBe(true);
  });

  it("sets ztCovered false for parts with _count.ztCoverages === 0", async () => {
    const controlRow = makeControl({
      controlNumber: "AU-05",
      parts: [
        makePart({
          name: "statement",
          prose: "The organization:",
          children: [
            makePart({
              id: "part-b",
              label: "b",
              name: "item",
              prose: "No coverage here.",
              _count: { ztCoverages: 0 },
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AU-05",
    });
    expect(result.parts[0]!.children[0]!.ztCovered).toBe(false);
  });

  // --- ZTMM guidance resolution (natural key, base + maturity fragment) ---

  it("resolves guidance as base + maturity fragment when a ZTMMGuidance row matches", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "ADVANCED",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "How identities are governed.",
        advanced: "Centralized identity with automated response.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe(
      "How identities are governed.\nCentralized identity with automated response.",
    );
  });

  it("renders base only when the matching maturity fragment is null", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "OPTIMAL", // no `optimal` fragment provided below
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Base only.",
        advanced: "advanced fragment present but not selected",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe("Base only.");
  });

  it("falls back to the pending placeholder when no ZTMMGuidance row matches (pillar, function)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Unmatched Function",
        maturityLevel: "ADVANCED",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({ pillar: "IDENTITY", function: "Identity Management" }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe(ZT_GUIDANCE_PENDING);
  });

  it("resolves a multi-pillar mapping using the first pillar", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["DATA", "APPLICATIONS"],
        function: "Access Management",
        maturityLevel: "TRADITIONAL",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "DATA",
        function: "Access Management",
        base: "Data access governance.",
        traditional: "Static rules.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe(
      "Data access governance.\nStatic rules.",
    );
  });

  it("aggregates a multi-part function: concatenates all group members (function order, blank line)", async () => {
    const controlRow = makeControl({
      controlNumber: "IA-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Stores", // the group key
        maturityLevel: "TRADITIONAL",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    // Three member rows sharing functionGroup 'Identity Stores' — supplied out of order
    // to prove the resolver sorts by function name (APIs, Developers, Users).
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Stores-Users",
        functionGroup: "Identity Stores",
        base: "Users base.",
        traditional: "users trad.",
      }),
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Stores-APIs",
        functionGroup: "Identity Stores",
        base: "APIs base.",
        traditional: "apis trad.",
      }),
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Stores-Developers",
        functionGroup: "Identity Stores",
        base: "Devs base.",
        traditional: "devs trad.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "IA-02",
    });
    expect(result.ztMapping!.guidance).toBe(
      "APIs base.\napis trad.\n\nDevs base.\ndevs trad.\n\nUsers base.\nusers trad.",
    );
  });

  it("multi-part group falls back when the mapping function matches no group", async () => {
    const controlRow = makeControl({
      controlNumber: "IA-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Stores",
        maturityLevel: "TRADITIONAL",
      }),
    });
    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    // Member rows exist but under a different pillar — first-pillar lookup misses.
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "NETWORKS",
        function: "Identity Stores-Users",
        functionGroup: "Identity Stores",
        base: "x",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "IA-02",
    });
    expect(result.ztMapping!.guidance).toBe(ZT_GUIDANCE_PENDING);
  });

  it("propagates ztCovered through enhancement parts", async () => {
    const parentControl = makeControl({ controlNumber: "AC-02" });

    const enhancement = makeControl({
      controlNumber: "AC-02(01)",
      parentControlId: parentControl.id,
      ztMapping: makeZtMapping(),
      parts: [
        makePart({
          name: "statement",
          prose: "Support automated management:",
          children: [
            makePart({
              id: "enh-a",
              label: "a",
              name: "item",
              prose: "Automated provisioning.",
              _count: { ztCoverages: 2 },
              children: [],
            }),
            makePart({
              id: "enh-b",
              label: "b",
              name: "item",
              prose: "Manual fallback.",
              _count: { ztCoverages: 0 },
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(parentControl);
    mockDb.nistControl.findMany.mockResolvedValue([enhancement]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    const enhParts = result.enhancements[0]!.parts[0]!.children;
    expect(enhParts[0]!.ztCovered).toBe(true);
    expect(enhParts[1]!.ztCovered).toBe(false);
  });
});

// ========================== getCombinedView ================================

describe("decoder.getCombinedView", () => {
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);

    await expect(caller().decoder.getCombinedView()).rejects.toThrow(
      "No active catalog version found",
    );
  });

  it("resolves ztmmGuidance as base + maturity fragment when a row matches", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      {
        ...makeControl({
          controlNumber: "AC-01",
          controlFamilyId: "AC",
          familyName: "Access Control",
          ztMapping: makeZtMapping({
            pillars: ["IDENTITY"],
            function: "Governance Capability",
            maturityLevel: "TRADITIONAL",
          }),
        }),
        discussion: "OSCAL implementation notes.",
      },
    ]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Governance Capability",
        base: "Identity governance.",
        traditional: "Manual periodic audits.",
      }),
    ]);

    const result = await caller().decoder.getCombinedView();
    expect(result).toHaveLength(1);
    expect(result[0]!.guidance).toBe("OSCAL implementation notes.");
    expect(result[0]!.ztMapping!.ztmmGuidance).toBe(
      "Identity governance.\nManual periodic audits.",
    );
  });

  it("returns null ztmmGuidance when no row matches (no placeholder leak)", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-01",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Unmatched Function",
          maturityLevel: "ADVANCED",
        }),
      }),
    ]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getCombinedView();
    expect(result[0]!.ztMapping!.ztmmGuidance).toBeNull();
  });

  it("returns null ztMapping for controls without one", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({ controlNumber: "AC-01", controlFamilyId: "AC" }),
    ]);

    const result = await caller().decoder.getCombinedView();
    expect(result[0]!.ztMapping).toBeNull();
  });

  // ---- Input filter branches: family / pillar / maturityLevel `where` clauses ----

  it("filters by family: passes controlFamilyId into the where clause", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getCombinedView({ family: "AC" });

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          controlFamilyId: "AC",
          parentControlId: null,
          nistVersionId: ACTIVE_VERSION.id,
        }),
      }),
    );
    // No pillar/maturity supplied → no ztMapping constraint added.
    const callArg = mockDb.nistControl.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(callArg.where.ztMapping).toBeUndefined();
  });

  it("filters by pillar: adds a ztMapping.pillars.has constraint", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getCombinedView({ pillar: "IDENTITY" });

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          ztMapping: { pillars: { has: "IDENTITY" } },
        }),
      }),
    );
  });

  it("filters by maturityLevel: resolves via the affinity relation (matches all maturities)", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getCombinedView({ maturityLevel: "OPTIMAL" });

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          // Via the affinity relation, not the single representative maturityLevel — so a
          // multi-maturity control matches the filter on ANY of its maturities.
          ztMapping: { affinities: { some: { maturity: "OPTIMAL" } } },
        }),
      }),
    );
  });

  it("filters by pillar AND maturityLevel together: merges both into one ztMapping clause", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);

    await caller().decoder.getCombinedView({
      family: "IA",
      pillar: "IDENTITY",
      maturityLevel: "ADVANCED",
    });

    expect(mockDb.nistControl.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest expect.objectContaining returns any
        where: expect.objectContaining({
          controlFamilyId: "IA",
          ztMapping: {
            pillars: { has: "IDENTITY" },
            affinities: { some: { maturity: "ADVANCED" } },
          },
        }),
      }),
    );
  });

  // ---- ztmmGuidance truthy path: `|| null` short-circuit (line 604) and links ----

  it("returns composed ztmmGuidance and maps links on the matched path", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
          maturityLevel: "OPTIMAL",
        }),
      }),
    ]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Identity base.",
        optimal: "Fully automated.",
      }),
    ]);

    const result = await caller().decoder.getCombinedView({
      pillar: "IDENTITY",
    });
    expect(result[0]!.ztMapping!.ztmmGuidance).toBe(
      "Identity base.\nFully automated.",
    );
    expect(result[0]!.ztMapping!.maturityLevel).toBe("OPTIMAL");
    // links moved to control-level (getCombinedView.ztMapping has no links field)
  });

  // ---- Filtered maturity: display the MATCHED tuple, not the representative ----

  it("displays the matched affinity's maturity + guidance when filtering by maturityLevel", async () => {
    // Representative is OPTIMAL, but the control also carries an INITIAL affinity. Filtering by
    // INITIAL must surface INITIAL (and its guidance), not the OPTIMAL representative.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
          maturityLevel: "OPTIMAL",
          affinities: [
            {
              pillar: "IDENTITY",
              function: "Identity Management",
              maturity: "OPTIMAL",
            },
            {
              pillar: "DATA",
              function: "Data Encryption",
              maturity: "INITIAL",
            },
          ],
        }),
      }),
    ]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Identity base.",
        optimal: "Fully automated.",
      }),
      makeGuidance({
        pillar: "DATA",
        function: "Data Encryption",
        base: "Data base.",
        initial: "Initial data encryption.",
      }),
    ]);

    const result = await caller().decoder.getCombinedView({
      maturityLevel: "INITIAL",
    });
    // Displays the INITIAL tuple, not the OPTIMAL representative.
    expect(result[0]!.ztMapping!.maturityLevel).toBe("INITIAL");
    expect(result[0]!.ztMapping!.pillar).toBe("DATA");
    expect(result[0]!.ztMapping!.function).toBe("Data Encryption");
    // Guidance is resolved for the matched (DATA, Data Encryption, INITIAL) tuple.
    expect(result[0]!.ztMapping!.ztmmGuidance).toBe(
      "Data base.\nInitial data encryption.",
    );
  });

  it("falls back to the representative tuple when no maturity filter is given", async () => {
    // Without a maturity filter, the representative (pillars/function/maturityLevel) is shown
    // even though affinities are present.
    mockDb.nistControl.findMany.mockResolvedValue([
      makeControl({
        controlNumber: "AC-02",
        controlFamilyId: "AC",
        ztMapping: makeZtMapping({
          pillars: ["IDENTITY"],
          function: "Identity Management",
          maturityLevel: "OPTIMAL",
          affinities: [
            {
              pillar: "DATA",
              function: "Data Encryption",
              maturity: "INITIAL",
            },
          ],
        }),
      }),
    ]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getCombinedView();
    expect(result[0]!.ztMapping!.maturityLevel).toBe("OPTIMAL");
    expect(result[0]!.ztMapping!.pillar).toBe("IDENTITY");
  });
});

// ===================== resolveGuidance edge cases ==========================
// Exercised via getControlById since resolveGuidance is internal.

describe("decoder resolveGuidance edge cases", () => {
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  });

  it("falls back when the mapping has an empty pillars array (no first pillar)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: [],
        function: "Identity Management",
        maturityLevel: "ADVANCED",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "x",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    // pillar.join(", ") of [] is "" but guidance must fall back to the pending placeholder.
    expect(result.ztMapping!.guidance).toBe(ZT_GUIDANCE_PENDING);
  });

  it("treats an unknown maturity (TBD) as no fragment: renders base only", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "TBD", // MATURITY_COLUMN["TBD"] is undefined → col guard false
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "Base text only.",
        advanced: "should not appear",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe("Base text only.");
  });

  it("falls back when a matched group's members all compose to empty (base empty, no fragment)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "TBD", // no fragment selected
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    // Row exists for the key but base is empty and the selected maturity has no fragment,
    // so composeRow yields "" for every member → composed is "" → fall back.
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    expect(result.ztMapping!.guidance).toBe(ZT_GUIDANCE_PENDING);
  });

  it("composes a statement whose root has no prose but has labelled children", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-06",
      parts: [
        {
          // Raw root part with prose explicitly null (makePart coalesces null → default).
          id: "p-root",
          oscalPartId: "ac-6_smt",
          label: null,
          name: "statement",
          prose: null,
          sortOrder: 0,
          parameters: [],
          _count: { ztCoverages: 0 },
          children: [
            makePart({
              id: "p-a",
              label: "a",
              name: "item",
              prose: "First requirement.",
              sortOrder: 0,
              children: [],
            }),
            makePart({
              id: "p-b",
              label: "b",
              name: "item",
              prose: "Second requirement.",
              sortOrder: 1,
              children: [],
            }),
          ],
        },
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-06",
    });
    // No leading prose line; children compose directly with their labels.
    expect(result.description).toBe(
      "a. First requirement.\nb. Second requirement.",
    );
  });

  it("returns empty description when parts exist but none is the statement root", async () => {
    // composeFromParts `if (!statementPart) return ""` branch: no part named "statement".
    const controlRow = makeControl({
      controlNumber: "AC-11",
      parts: [
        makePart({
          id: "p-orphan",
          label: "a",
          name: "item",
          prose: "Orphan item with no statement parent.",
          children: [],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-11",
    });
    expect(result.description).toBe("");
    // The orphan part is still returned in the parts tree (only the composed text is empty).
    expect(result.parts).toHaveLength(1);
  });

  it("returns empty description for a childless statement whose prose is null", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-10",
      parts: [
        {
          // Childless statement root with null prose → composeFromParts returns "".
          id: "p-empty",
          oscalPartId: "ac-10_smt",
          label: null,
          name: "statement",
          prose: null,
          sortOrder: 0,
          parameters: [],
          _count: { ztCoverages: 0 },
          children: [],
        },
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-10",
    });
    expect(result.description).toBe("");
  });

  it("composes children with no label and null prose without throwing", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-07",
      parts: [
        makePart({
          name: "statement",
          prose: "Root prose.",
          children: [
            // label null and prose null → label segment empty, prose coalesces to ""
            {
              id: "p-nolabel",
              oscalPartId: "ac-7_smt.x",
              label: null,
              name: "item",
              prose: null,
              sortOrder: 0,
              parameters: [],
              _count: { ztCoverages: 0 },
              children: [],
            },
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-07",
    });
    expect(result.description).toBe("Root prose.\n ");
  });

  it("defaults ztCovered to false when a part row has no _count and no children key", async () => {
    // Simulate a raw part row missing _count/children (defensive `??` branches in mapPart).
    const rawRoot = {
      id: "part-raw",
      oscalPartId: "ac-8_smt",
      label: null,
      name: "statement",
      prose: "Single statement, no sub-items.",
      sortOrder: 0,
      parameters: [],
      // _count and children intentionally omitted
    };
    const controlRow = makeControl({
      controlNumber: "AC-08",
      // The omission IS the test: mapPart's `?? 0` / `?? []` branches only run
      // when Prisma returns a row without these keys. The typed builder cannot
      // express that shape — a builder that could would let this omission
      // happen by accident everywhere else — so the raw row is cast through.
      parts: [rawRoot as unknown as PartRow],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-08",
    });
    expect(result.parts[0]!.ztCovered).toBe(false);
    expect(result.parts[0]!.children).toEqual([]);
    expect(result.description).toBe("Single statement, no sub-items.");
  });

  it("coalesces null baseline parameter values to null (mapParameter ?? branches)", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-09",
      parts: [
        makePart({
          name: "statement",
          prose: "Statement.",
          children: [
            makePart({
              id: "p-a",
              label: "a",
              name: "item",
              prose: "With params.",
              parameters: [
                // All baselines null → no value rows at all (no "(Not defined)" placeholders).
                makeParameter({
                  id: "p-null",
                  low: null,
                  moderate: null,
                  high: null,
                  privacy: null,
                }),
              ],
              children: [],
            }),
          ],
        }),
      ],
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-09",
    });
    const param = result.parts[0]!.children[0]!.parameters[0]!;
    expect(param.values).toEqual([]);
  });

  it("composes fragment only when base is empty but the maturity fragment is present", async () => {
    const controlRow = makeControl({
      controlNumber: "AC-02",
      ztMapping: makeZtMapping({
        pillars: ["IDENTITY"],
        function: "Identity Management",
        maturityLevel: "INITIAL",
      }),
    });

    mockDb.nistControl.findFirst.mockResolvedValue(controlRow);
    mockDb.nistControl.findMany.mockResolvedValue([]);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([
      makeGuidance({
        pillar: "IDENTITY",
        function: "Identity Management",
        base: "",
        initial: "Initial-stage fragment.",
      }),
    ]);

    const result = await caller().decoder.getControlById({
      controlId: "AC-02",
    });
    // base empty + fragment present → filter(Boolean) drops the empty base.
    expect(result.ztMapping!.guidance).toBe("Initial-stage fragment.");
  });
});

describe("the export page's queries", () => {
  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
  });

  it("listControls lists each control and enhancement, and marks a withdrawn one", async () => {
    mockDb.nistControl.findMany.mockResolvedValueOnce([
      {
        controlNumber: "AC-02",
        controlName: "Account Management",
        status: "LIVE",
      },
      {
        controlNumber: "AC-02(10)",
        controlName: "Shared and Group Account Credential Change",
        status: "WITHDRAWN",
      },
    ]);
    expect(await caller().decoder.listControls()).toEqual([
      { id: "AC-02", name: "Account Management", withdrawn: false },
      {
        id: "AC-02(10)",
        name: "Shared and Group Account Credential Change",
        withdrawn: true,
      },
    ]);
  });

  it("countExport counts the selection's rows without loading their detail", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        { controlNumber: "AC-02", parentControlId: null },
      ])
      .mockResolvedValueOnce([
        { ...makeControl({ controlNumber: "AC-02" }), parentControl: null },
        {
          ...makeControl({ controlNumber: "AC-02(01)" }),
          parentControl: { controlNumber: "AC-02" },
        },
      ]);
    const r = await caller().decoder.countExport({
      pillar: [],
      maturity: [],
      baseline: [],
      designation: [],
      family: [],
      status: [],
      q: "",
      pick: ["AC-02"],
      enhancements: "with",
      data: [],
      fields: [],
    });
    expect(r).toEqual({ count: 2 });
    const args = mockDb.nistControl.findMany.mock.calls.at(-1)![0] as {
      select: Record<string, unknown>;
      include?: unknown;
    };
    // Only what the filter reads; picks are not filtered, so not the Zero Trust mapping either.
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select).sort()).toEqual([
      "baselineLabels",
      "controlName",
      "controlNumber",
      "parentControl",
    ]);
  });

  it("listControls fails plainly without an active version", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);
    await expect(caller().decoder.listControls()).rejects.toThrow(
      "No active catalog version found",
    );
  });
});

describe("exportRouter: export.getExportRecord", () => {
  it("is not served over HTTP: no export procedure is on the app router", () => {
    const served = Object.keys(appRouter._def.procedures);
    const exported = Object.keys(exportRouter._def.procedures);
    expect(exported).toEqual(["export.getExportRecord"]);
    // By name, wherever it might be mounted: the last segment is the procedure.
    const last = (path: string) => path.split(".").pop();
    for (const path of exported) {
      expect(served.filter((p) => last(p) === last(path))).toEqual([]);
    }
  });

  const ALL = {
    pillar: [],
    maturity: [],
    designation: [],
    baseline: [],
    family: [],
    status: [],
    q: "",
    pick: [],
    enhancements: "with" as const,
    data: ["statement", "assessment", "zeroTrust", "references"] as const,
    fields: ["baselines", "frequency", "priority", "lineage"] as const,
  };
  type Input = Parameters<
    ReturnType<typeof exportCaller>["export"]["getExportRecord"]
  >[0];
  const run = (over: Partial<Input> = {}) =>
    exportCaller().export.getExportRecord({
      ...ALL,
      data: [...ALL.data],
      fields: [...ALL.fields],
      ...over,
    });
  // The details query is always the last nistControl.findMany; its where says what was selected.
  const detailsWhere = () =>
    (mockDb.nistControl.findMany.mock.calls.at(-1)![0] as { where: unknown })
      .where;

  beforeEach(() => {
    mockDb.nistVersion.findFirst.mockResolvedValue(ACTIVE_VERSION);
    mockDb.zTMMGuidance.findMany.mockResolvedValue([]);
  });

  it("throws when no active version exists", async () => {
    mockDb.nistVersion.findFirst.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("No active catalog version found");
  });

  it("splits picks into bases and enhancements, matching any spelling", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        { controlNumber: "AC-02", parentControlId: null },
        { controlNumber: "AC-02(01)", parentControlId: "ctrl-AC-02" },
        { controlNumber: "AC-03", parentControlId: null },
      ])
      .mockResolvedValueOnce([
        { ...makeControl({ controlNumber: "AC-02" }), parentControl: null },
        {
          ...makeControl({ controlNumber: "AC-02(01)" }),
          parentControl: {
            controlNumber: "AC-02",
            links: [],
            referenceLinks: [],
          },
        },
      ]);

    const r = await run({ pick: ["ac-2", "AC-2.1"], enhancements: "without" });

    expect(detailsWhere()).toEqual({
      nistVersionId: ACTIVE_VERSION.id,
      OR: [
        { controlNumber: { in: ["AC-02"] } },
        { controlNumber: { in: ["AC-02(01)"] } },
      ],
    });
    expect(r.controls.map((c) => [c.id, c.baseId])).toEqual([
      ["AC-02", null],
      ["AC-02(01)", "AC-02"],
    ]);
  });

  it("carries lineage and an enhancement's inherited frequencies, and drops priority", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        { controlNumber: "AC-13", parentControlId: null },
        { controlNumber: "AC-02(01)", parentControlId: "ctrl-AC-02" },
      ])
      .mockResolvedValueOnce([
        {
          ...makeControl({ controlNumber: "AC-13", priority: "P1" }),
          status: "WITHDRAWN",
          lineage: [
            {
              kind: "INCORPORATED_INTO",
              relatedControlNumber: "AC-02",
              relatedPartOscalId: null,
              release: "5.0.0",
              sinceRelease: null,
              relatedControl: null,
            },
          ],
          lineageFrom: [],
          parentControl: null,
        },
        {
          ...makeControl({ controlNumber: "AC-02(01)" }),
          lineage: [],
          lineageFrom: [],
          parentControl: {
            controlNumber: "AC-02",
            links: [],
            referenceLinks: [],
            parts: [
              makePart({
                prose:
                  "Review accounts [Assignment: organization-defined frequency].",
              }),
            ],
          },
        },
      ]);

    const r = await run({ pick: ["AC-13", "AC-02(01)"] });

    const include = (
      mockDb.nistControl.findMany.mock.calls.at(-1)![0] as {
        include: Record<string, unknown>;
      }
    ).include;
    expect(include).toHaveProperty("lineage");
    expect(r.fields).toEqual(["baselines", "frequency", "lineage"]);
    const [withdrawn, enh] = r.controls;
    expect(withdrawn!.lineage).toEqual([
      "Status: Withdrawn, incorporated into AC-02",
    ]);
    expect(withdrawn!.priority).toBeUndefined();
    expect(enh!.lineage).toEqual([]);
    expect(enh!.frequency).toEqual([
      {
        pane: "catalog",
        label: "AC-02 statement",
        value: "Review accounts [organization-defined frequency]",
      },
    ]);
  });

  it("loads neither lineage nor the base's statement when those fields are unticked", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        { controlNumber: "AC-02", parentControlId: null },
      ])
      .mockResolvedValueOnce([]);

    await run({ pick: ["AC-02"], fields: ["baselines"] });

    const include = (
      mockDb.nistControl.findMany.mock.calls.at(-1)![0] as {
        include: {
          lineage?: unknown;
          parentControl: { select: { parts: unknown } };
        };
      }
    ).include;
    expect(include.lineage).toBeUndefined();
    expect(include.parentControl.select.parts).toBe(false);
  });

  it("starts from the bases the facets pass, expanded to their enhancements", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        makeControl({ controlNumber: "AC-02" }),
        makeControl({ controlNumber: "SI-04", controlFamilyId: "SI" }),
      ])
      .mockResolvedValueOnce([]);

    await run({ family: ["SI"], enhancements: "only" });

    expect(detailsWhere()).toEqual({
      nistVersionId: ACTIVE_VERSION.id,
      OR: [
        {
          status: "LIVE",
          parentControl: { controlNumber: { in: ["SI-04"] } },
        },
        { controlNumber: { in: [] } },
      ],
    });
  });

  it("consults the prose search only from two characters, as the diagram does", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await run({ q: " a " });
    expect(mockDb.nistControl.findMany).toHaveBeenCalledTimes(2);

    mockDb.nistControl.findMany.mockClear();
    await run({ q: "audit" });
    expect(mockDb.nistControl.findMany).toHaveBeenCalledTimes(3);
  });

  it("skips the prose search for an identifier query, which the predicate answers alone", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);
    await run({ q: "AC-2" });
    // bridge + details only: no searchCatalog
    expect(mockDb.nistControl.findMany).toHaveBeenCalledTimes(2);
    expect(mockDb.zTMMGuidance.findMany).toHaveBeenCalledTimes(1);
  });

  it("takes every base control without the bridge query when nothing narrows the view", async () => {
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([{ controlNumber: "AC-01" }])
      .mockResolvedValueOnce([]);
    await run();
    expect(mockDb.nistControl.findMany.mock.calls[0]![0]).toEqual({
      where: {
        nistVersionId: ACTIVE_VERSION.id,
        parentControlId: null,
        status: "LIVE",
      },
      select: { controlNumber: true },
    });
    expect((detailsWhere() as { OR: unknown[] }).OR.slice(0, 1)).toEqual([
      { controlNumber: { in: ["AC-01"] } },
    ]);
  });

  it("keeps an expanded enhancement only when it passes the facets it carries", async () => {
    const enh = (n: string, baselineLabels: string[]) => ({
      ...makeControl({ controlNumber: n, baselineLabels }),
      parentControl: { controlNumber: "AC-02", links: [], referenceLinks: [] },
    });
    mockDb.nistControl.findMany
      .mockResolvedValueOnce([
        makeControl({
          controlNumber: "AC-02",
          children: [{ baselineLabels: ["Low"], ztMapping: null }],
        }),
      ])
      .mockResolvedValueOnce([
        { ...makeControl({ controlNumber: "AC-02" }), parentControl: null },
        enh("AC-02(01)", ["Low", "Moderate"]),
        enh("AC-02(02)", ["High"]),
      ]);

    const r = await run({ baseline: ["LOW"] });

    expect(r.controls.map((c) => c.id)).toEqual(["AC-02", "AC-02(01)"]);
  });

  it("carries every dataset asked for, SP 800-53A included", async () => {
    mockDb.nistControl.findMany.mockResolvedValue([]);
    const r = await run({ data: ["assessment", "references"] });
    expect(r.datasets).toEqual(["assessment", "references"]);
  });
});
